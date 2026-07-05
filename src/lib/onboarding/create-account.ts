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

import { FieldValue } from "firebase-admin/firestore";
import { getAuth, getDb } from "@/lib/firebase-admin";
import { buildSearchNameList, buildServicesPayload, buildUserProfile, generatePassword, slugify } from "./account-model";
import type { SalonExtract } from "./extract";
import { geocode } from "./geocode";
import { hoursToTiming } from "./hours";
import type { OnboardingHints, OnboardingResult } from "@/lib/onboarding";

const EMAIL_DOMAIN = "glaura.fr";
const SERVICES_UPLOAD_URL =
  process.env.GLAURA_FUNCTIONS_BASE_URL?.trim() || "https://us-central1-beauty-984c8.cloudfunctions.net";
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

function failure(partial: Omit<CreateAccountResult, "status" | "agentCount">): CreateAccountResult {
  return { status: "failed", agentCount: 0, ...partial };
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

/** Uploads the extract's services via the (open, unauthenticated) `uploadServicesFromJSON` Cloud Function. */
async function uploadServices(extract: SalonExtract, ownerId: string, warnings: string[]): Promise<number> {
  const payload = buildServicesPayload(extract, ownerId);
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

  // (c) Location.
  const { address, lat, lng } = await resolveLocation(extract, hints, warnings);

  // (d) Opening hours.
  const { timing, days } = hoursToTiming(extract.salon.hours);

  // (e) Auth user.
  const password = generatePassword();
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
  const serviceCount = await uploadServices(extract, uid, warnings);

  // (h) Agents — skipped for v1.
  if (extract.staff.length > 0) {
    warnings.push(`staff not created (services-only v1): ${extract.staff.join(", ")}`);
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
    agentCount: 0,
    sourceType: source.sourceType,
    url: source.url,
    warnings,
    error: null,
  };
}
