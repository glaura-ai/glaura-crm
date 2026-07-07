/**
 * Firestore/Auth WRITE layer for headless salon onboarding (Step P3b).
 *
 * This module performs LIVE writes against the `beauty-984c8` prod Firebase
 * project (via src/lib/firebase-admin.ts's lazy singleton). It is import-safe
 * — no write happens until `createDisabledSalonAccount()` is actually called
 * — but calling it for real requires valid ADC credentials
 * (`GOOGLE_APPLICATION_CREDENTIALS`), which are NOT available in local dev.
 * Integration testing happens on the VPS.
 *
 * All the deterministic transforms (slugify, password generation,
 * searchNameList, spLocation shape, userProfile shape, hours→timing,
 * services payload shape) are P3a's pure helpers from ./account-model and
 * ./hours — this file only adds the Firestore/Auth I/O around them, per
 * onboard-headless.md §2/§3/§7/§8.
 *
 * --- Services upload path (step g) -----------------------------------------
 * `goglow-firebase/functions/uploadServicesFromJSON` is an OPEN Cloud Function
 * (functions.https.onRequest wrapped only in `cors({origin:true})` — it never
 * calls `verifyIdToken`/`verifySessionCookie`, unlike `createServiceProvider`).
 * So the cleanest correct path is a plain unauthenticated POST to the deployed
 * HTTPS endpoint — no custom-token minting / Identity Toolkit exchange needed.
 * The endpoint's own `processServiceRows` (serviceUploadHelpers.js) already
 * owns the `subcategory_name` → `subcategory_id` resolution (case-insensitive
 * match against the `subcategories` collection scoped by
 * `service_provider_id`==ownerId (+ `category_id` when known), auto-creating
 * a new subcategory doc when no match is found) — reusing the HTTP endpoint
 * means we don't have to reimplement that logic here.
 *
 * Category classification: `processServiceRows` requires a per-row
 * `category_id` (one of Glaura's 7 fixed taxonomy categories). Haiku classifies
 * each service into one of those categories during extraction (extract.ts's
 * `category` enum); `buildServicesPayload` maps that name → the Firestore id via
 * `categoryIdForName` (categories.ts), falling back to the app's "uncategorized"
 * bucket only when a service can't be classified. The subcategory (the page's
 * own heading) is still auto-created per-owner.
 */

import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAuth, getDb } from "@/lib/firebase-admin";
import {
  buildAgentDocs,
  buildReviewDocs,
  buildSearchNameList,
  buildServicesPayload,
  buildUserProfile,
  generatePassword,
  slugify,
  variantKeyForServiceName,
  type AgentDoc,
  type CreatedServiceRef,
  type ServiceVariantPatch,
} from "./account-model";
import type { SalonExtract } from "./extract";
import { geocode } from "./geocode";
import { hoursToTiming } from "./hours";
import type { OnboardingHints, OnboardingOverrides, OnboardingResult } from "@/lib/onboarding";

const EMAIL_DOMAIN = "glaura.fr";
const FUNCTIONS_BASE_URL =
  process.env.GLAURA_FUNCTIONS_BASE_URL?.trim() || "https://us-central1-beauty-984c8.cloudfunctions.net";
const SERVICES_UPLOAD_URL = FUNCTIONS_BASE_URL;
const CREATE_AGENT_URL = `${FUNCTIONS_BASE_URL}/createAgent`;
const MAX_SUFFIX_ATTEMPTS = 500;

/** Context the caller already has from earlier pipeline steps (P1/P2) that isn't part of `extract` or `hints`. */
export interface AccountSourceContext {
  /** The salon booking-page URL that was scraped. */
  url: string;
  /** Detected booking-platform source, e.g. "planity" | "treatwell" | "acuity" | "generic". */
  sourceType: string;
}

/**
 * Richer, required-field version of `OnboardingResult` (src/lib/onboarding.ts)
 * that this function always returns fully populated. Structurally compatible
 * with `OnboardingResult` (all shared fields are subtypes) plus `url`, which
 * `OnboardingResult` also declares (optionally) for exactly this purpose.
 */
export interface CreateAccountResult extends OnboardingResult {
  status: "success" | "already_onboarded" | "failed";
  ownerId: string | null;
  email: string | null;
  password: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  serviceCount: number;
  agentCount: number;
  reviewCount: number;
  sourceType: string;
  url: string;
  warnings: string[];
  error: string | null;
}

type UploadServicesResponse = {
  success?: boolean;
  message?: string;
  results?: {
    totalCreatedServices?: number;
    totalCreatedSubcategories?: number;
    totalSkipped?: number;
    errors?: Array<{ row: number; service_name: string; error: string }>;
  };
};

function failure(partial: Omit<CreateAccountResult, "status" | "agentCount" | "reviewCount">): CreateAccountResult {
  return { status: "failed", agentCount: 0, reviewCount: 0, ...partial };
}

/**
 * Checks whether a headless-onboarded (disabled) staging profile already
 * exists for this CRM salon, per onboard-headless.md §3. Never throws — a
 * lookup failure just means "not found", so the caller falls through to
 * normal creation instead of hard-failing on a query error.
 */
async function findExistingHeadlessProfile(crmSalonId: string) {
  const db = getDb();
  const snapshot = await db
    .collection("userProfile")
    .where("crmSalonId", "==", crmSalonId)
    .where("crmOnboardingMode", "==", "headless")
    .where("enable", "==", false)
    .limit(1)
    .get();
  return snapshot.empty ? null : snapshot.docs[0];
}

/**
 * Reserves the first free `{slug, email}` pair starting at `base`, trying
 * `base`, `base-1`, `base-2`, … A candidate is "free" only when BOTH no
 * `userProfile.companyUserName` matches it AND no Auth user owns the derived
 * `<candidate>@glaura.fr` email (per onboard-headless.md §3 — existing
 * active/non-CRM profiles are not blockers, they just consume a slug/email).
 */
async function reserveSlugAndEmail(base: string): Promise<{ slug: string; email: string }> {
  const auth = getAuth();
  const db = getDb();

  for (let attempt = 0; attempt <= MAX_SUFFIX_ATTEMPTS; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt}`;
    const email = `${candidate}@${EMAIL_DOMAIN}`;

    const [profileSnapshot, emailTaken] = await Promise.all([
      db.collection("userProfile").where("companyUserName", "==", candidate).limit(1).get(),
      auth
        .getUserByEmail(email)
        .then(() => true)
        .catch((error: unknown) => {
          const code = (error as { code?: string } | undefined)?.code;
          if (code === "auth/user-not-found") return false;
          throw error;
        }),
    ]);

    if (profileSnapshot.empty && !emailTaken) {
      return { slug: candidate, email };
    }
  }

  throw new Error(`Unable to reserve a unique companyUserName/email after ${MAX_SUFFIX_ATTEMPTS} attempts (base "${base}")`);
}

/** Resolves the salon address + coordinates from the extract, falling back to CRM hints, then geocoding. */
async function resolveLocation(
  extract: SalonExtract,
  hints: OnboardingHints | undefined,
  warnings: string[],
): Promise<{ address: string | null; lat: number | null; lng: number | null }> {
  const address = extract.salon.address?.trim() || hints?.address?.trim() || null;

  const hintLat = typeof hints?.lat === "number" ? hints.lat : typeof hints?.latitude === "number" ? hints.latitude : null;
  const hintLng = typeof hints?.lng === "number" ? hints.lng : typeof hints?.longitude === "number" ? hints.longitude : null;

  if (hintLat != null && hintLng != null) {
    return { address, lat: hintLat, lng: hintLng };
  }

  if (!address) {
    warnings.push("No address found on the extract or CRM hints; spLocation will be null.");
    return { address: null, lat: null, lng: null };
  }

  // geocode() never throws (see geocode.ts) — a failed/empty lookup just
  // resolves to null, which we record as a non-fatal warning.
  const geocoded = await geocode(address);
  if (!geocoded) {
    warnings.push(`Geocoding returned no result for address: ${address}`);
    return { address, lat: null, lng: null };
  }
  return { address, lat: geocoded.lat, lng: geocoded.lng };
}

/** Uploads a prebuilt services payload via the (open, unauthenticated) `uploadServicesFromJSON` Cloud Function. */
async function uploadServices(
  payload: { ownerId: string; services: unknown[] },
  warnings: string[],
): Promise<number> {
  if (payload.services.length === 0) return 0;

  try {
    const response = await fetch(`${SERVICES_UPLOAD_URL}/uploadServicesFromJSON`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const body = (await response.json().catch(() => null)) as UploadServicesResponse | null;

    if (!response.ok || !body?.success) {
      warnings.push(`Service upload failed (HTTP ${response.status}): ${body?.message ?? response.statusText}`);
      return 0;
    }

    const created = body.results?.totalCreatedServices ?? 0;
    const skipped = body.results?.totalSkipped ?? 0;
    if (skipped > 0) {
      warnings.push(`${skipped} service row(s) skipped by uploadServicesFromJSON: ${JSON.stringify(body.results?.errors ?? [])}`);
    }
    return created;
  } catch (error) {
    warnings.push(`Service upload request failed: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Enrichment writes (P6 full onboarding) — all non-fatal (push warnings).
// ---------------------------------------------------------------------------

type CreatedService = CreatedServiceRef & { service_name: string };

/** Reads back the salon's just-created service docs (id + category/subcategory + name). */
async function readBackServices(ownerId: string): Promise<CreatedService[]> {
  const snap = await getDb().collection("services").where("ownerId", "==", ownerId).get();
  return snap.docs.map((d) => {
    const data = d.data() as { category_id?: string; subcategory_id?: string; service_name?: string };
    return {
      id: d.id,
      category_id: data.category_id ?? "",
      subcategory_id: data.subcategory_id ?? "",
      service_name: data.service_name ?? "",
    };
  });
}

/** Patches `variants` + `base_option_label` onto the created service docs that carry options. */
async function patchServiceVariants(
  services: readonly CreatedService[],
  variantsByServiceName: Record<string, ServiceVariantPatch>,
  warnings: string[],
): Promise<number> {
  const db = getDb();
  let patched = 0;
  for (const svc of services) {
    const patch = variantsByServiceName[variantKeyForServiceName(svc.service_name)];
    if (!patch) continue;
    try {
      await db.collection("services").doc(svc.id).update({
        variants: patch.variants,
        base_option_label: patch.base_option_label,
        updated_at: FieldValue.serverTimestamp(),
      });
      patched += 1;
    } catch (error) {
      warnings.push(`Variant patch failed for service ${svc.id} (${svc.service_name}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return patched;
}

/** Sets each subcategory doc's `order` to its page index (the public site reads this). */
async function applySubcategoryOrder(
  ownerId: string,
  orderBySubcategoryName: Map<string, number>,
  warnings: string[],
): Promise<void> {
  try {
    const db = getDb();
    const snap = await db.collection("subcategories").where("service_provider_id", "==", ownerId).get();
    const batch = db.batch();
    let updates = 0;
    for (const doc of snap.docs) {
      const name = normalizeName((doc.data() as { name?: string }).name ?? "");
      const order = orderBySubcategoryName.get(name);
      if (order == null) continue;
      batch.update(doc.ref, { order });
      updates += 1;
    }
    if (updates > 0) await batch.commit();
  } catch (error) {
    warnings.push(`Subcategory ordering failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** POSTs each synthesized agent to the open `createAgent` Cloud Function. Returns the count created. */
async function createAgents(agents: readonly AgentDoc[], warnings: string[]): Promise<number> {
  let created = 0;
  for (const agent of agents) {
    try {
      const response = await fetch(CREATE_AGENT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(agent),
      });
      if (response.status === 201) {
        created += 1;
      } else {
        const body = (await response.json().catch(() => null)) as { message?: string } | null;
        warnings.push(`Agent "${agent.name}" not created (HTTP ${response.status}): ${body?.message ?? response.statusText}`);
      }
    } catch (error) {
      warnings.push(`Agent "${agent.name}" request failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return created;
}

/** Writes the review subcollection and denormalizes the aggregate onto the profile. */
async function writeReviews(
  ownerId: string,
  reviews: ReturnType<typeof buildReviewDocs>,
  warnings: string[],
): Promise<number> {
  if (reviews.reviews.length === 0) return 0;
  try {
    const db = getDb();
    const col = db.collection("userProfile").doc(ownerId).collection("reviews");
    let batch = db.batch();
    let inBatch = 0;
    let written = 0;
    for (const r of reviews.reviews) {
      const ref = col.doc();
      batch.set(ref, {
        id: ref.id,
        userName: r.userName,
        userImage: r.userImage,
        userid: r.userid,
        ratting: r.ratting,
        review: r.review,
        serviceId: r.serviceId,
        serviceName: r.serviceName,
        jobId: r.jobId,
        createdAt: Timestamp.fromDate(r.createdAt),
      });
      inBatch += 1;
      written += 1;
      if (inBatch >= 400) {
        await batch.commit();
        batch = db.batch();
        inBatch = 0;
      }
    }
    if (inBatch > 0) await batch.commit();

    await db.collection("userProfile").doc(ownerId).update({
      avg_ratting: reviews.avg_ratting,
      total_review: reviews.total_review,
    });
    return written;
  } catch (error) {
    warnings.push(`Review write failed: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

/** Shared name normalizer for matching created docs back to extract rows. */
function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Creates a DISABLED Glaura salon account (Auth user + `userProfile` +
 * services) from a validated `SalonExtract`, or returns the existing
 * headless-staging profile if one was already created for this CRM salon.
 * NEVER enables the account. See onboard-headless.md §2/§3 for the invariants
 * this must uphold.
 */
export async function createDisabledSalonAccount(
  extract: SalonExtract,
  hints: OnboardingHints | undefined,
  source: AccountSourceContext,
  overrides?: OnboardingOverrides,
): Promise<CreateAccountResult> {
  const warnings: string[] = [];

  // (a) Idempotency — never double-create for the same CRM salon.
  if (hints?.crmSalonId) {
    try {
      const existing = await findExistingHeadlessProfile(hints.crmSalonId);
      if (existing) {
        const data = existing.data() as { email?: string; address?: string; spLocation?: { latitude?: number; longitude?: number } };
        return {
          status: "already_onboarded",
          ownerId: existing.id,
          email: data.email ?? null,
          password: null,
          address: data.address ?? null,
          lat: data.spLocation?.latitude ?? null,
          lng: data.spLocation?.longitude ?? null,
          serviceCount: 0,
          agentCount: 0,
          reviewCount: 0,
          sourceType: source.sourceType,
          url: source.url,
          warnings: [],
          error: null,
        };
      }
    } catch (error) {
      // A failed idempotency check must not silently create a duplicate
      // account without a trace — abort with a clear error instead.
      return failure({
        ownerId: null,
        email: null,
        password: null,
        address: null,
        lat: null,
        lng: null,
        serviceCount: 0,
        sourceType: source.sourceType,
        url: source.url,
        warnings,
        error: `Idempotency check failed: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const name = extract.salon.name?.trim();
  if (!name) {
    return failure({
      ownerId: null,
      email: null,
      password: null,
      address: null,
      lat: null,
      lng: null,
      serviceCount: 0,
      sourceType: source.sourceType,
      url: source.url,
      warnings,
      error: "No usable salon name on the extract; cannot create an account.",
    });
  }

  // (b) Suffix reservation.
  const base = slugify(name);
  let slug: string;
  let email: string;
  try {
    ({ slug, email } = await reserveSlugAndEmail(base));
  } catch (error) {
    return failure({
      ownerId: null,
      email: null,
      password: null,
      address: null,
      lat: null,
      lng: null,
      serviceCount: 0,
      sourceType: source.sourceType,
      url: source.url,
      warnings,
      error: `Slug/email reservation failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // (b.1) Credential overrides (P6): use the job's external login when provided,
  // otherwise fall back to the reserved `<slug>@glaura.fr` + a generated password.
  // The reserved slug is still the `companyUserName`; only the Auth email changes.
  const overrideEmail = overrides?.loginEmail?.trim();
  if (overrideEmail) email = overrideEmail;

  // (c) Location.
  const { address, lat, lng } = await resolveLocation(extract, hints, warnings);

  // (d) Opening hours.
  const { timing, days } = hoursToTiming(extract.salon.hours);

  // (e) Auth user.
  const password = overrides?.loginPassword?.trim() || generatePassword();
  let uid: string;
  try {
    const userRecord = await getAuth().createUser({
      email,
      password,
      displayName: name,
      disabled: false,
      emailVerified: true,
    });
    uid = userRecord.uid;
  } catch (error) {
    return failure({
      ownerId: null,
      email,
      password: null,
      address,
      lat,
      lng,
      serviceCount: 0,
      sourceType: source.sourceType,
      url: source.url,
      warnings,
      error: `Auth user creation failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // (f) userProfile write.
  try {
    const searchNameList = buildSearchNameList(name, slug, base);
    const profile = buildUserProfile(extract, {
      uid,
      email,
      companyUserName: slug,
      timing,
      days,
      searchNameList,
      lat,
      lng,
      hints: { crmSalonId: hints?.crmSalonId ?? null },
      crmSourceUrl: source.url,
      enable: overrides?.enable ?? false,
      deposit: overrides?.deposit ?? null,
    });

    // P3a's `now` stand-in must be replaced with the real server timestamp
    // at write time (see account-model.ts's BuildUserProfileContext doc).
    const serverNow = FieldValue.serverTimestamp();
    await getDb()
      .collection("userProfile")
      .doc(uid)
      .set({ ...profile, createdAt: serverNow, updatedAt: serverNow });
  } catch (error) {
    // Hard failure — the account exists in Auth but has no profile. Report
    // it as failed; a teammate can clean up or retry idempotently (the next
    // attempt will find no headless profile yet and reserve a new slug,
    // since the crmSalonId check only matches existing *profiles*, not
    // orphaned Auth users). This is a known edge case worth a warning.
    warnings.push(`Auth user ${uid} (${email}) was created but the userProfile write failed; may be orphaned.`);
    return failure({
      ownerId: uid,
      email,
      password: null,
      address,
      lat,
      lng,
      serviceCount: 0,
      sourceType: source.sourceType,
      url: source.url,
      warnings,
      error: `userProfile write failed: ${error instanceof Error ? error.message : String(error)}`,
    });
  }

  // (g) Services — non-fatal on failure (see module doc comment).
  const { payload, variantsByServiceName } = buildServicesPayload(extract, uid);
  const serviceCount = await uploadServices(payload, warnings);

  // (h) Enrichment (P6 full onboarding) — options, subcategory order, agents,
  // reviews, deposit. All non-fatal; the base account already exists.
  const created = serviceCount > 0 ? await readBackServices(uid) : [];

  if (Object.keys(variantsByServiceName).length > 0) {
    await patchServiceVariants(created, variantsByServiceName, warnings);
  }

  // Subcategory page order: subcategory_name → its 0-based order from the extract.
  const orderBySubcategoryName = new Map<string, number>();
  for (const svc of extract.services) {
    if (svc.subcategory_order == null) continue;
    const key = normalizeName(svc.subcategory_name);
    if (!orderBySubcategoryName.has(key)) orderBySubcategoryName.set(key, svc.subcategory_order);
  }
  if (orderBySubcategoryName.size > 0) {
    await applySubcategoryOrder(uid, orderBySubcategoryName, warnings);
  }

  // Agents — synthesized (the page carries no real staff), each doing all services.
  let agentCount = 0;
  const agentTarget = overrides?.agentCount ?? 0;
  if (agentTarget > 0 && created.length > 0) {
    const agents = buildAgentDocs(agentTarget, uid, timing, days, created);
    agentCount = await createAgents(agents, warnings);
  }

  // Reviews — real Planity reviews first (forced 5★), filled to the target.
  let reviewCount = 0;
  const reviewTarget = overrides?.reviewTarget ?? 0;
  if (reviewTarget > 0) {
    const reviewDocs = buildReviewDocs(extract.reviews ?? [], reviewTarget, new Date());
    reviewCount = await writeReviews(uid, reviewDocs, warnings);
  }

  // (i) Success.
  return {
    status: "success",
    ownerId: uid,
    email,
    password,
    address,
    lat,
    lng,
    serviceCount,
    agentCount,
    reviewCount,
    sourceType: source.sourceType,
    url: source.url,
    warnings,
    error: null,
  };
}
