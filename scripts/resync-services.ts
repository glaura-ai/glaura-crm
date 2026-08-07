/**
 * Re-sync an onboarded salon's Firestore `services` against its live booking
 * page (Planity/Treatwell/…). The page is the source of truth: drifted
 * prices/durations are updated, new services created, returned ones restored,
 * and vanished ones soft-deactivated (isDeleted=true, reversible).
 *
 * USAGE (dry-run by default — prints the diff, writes nothing):
 *   npx tsx scripts/resync-services.ts --uid <ownerId> --url <bookingUrl> \
 *     [--apply] [--alias "Page name=Existing name"]... \
 *     [--existing <services.json>] [--cache <extract.json>]
 *
 *   --apply           perform the writes (needs firebase SA credentials)
 *   --alias "A=B"     pair the page's renamed service A with existing doc
 *                     named B instead of create+deactivate (repeatable)
 *   --subcat-alias "A=B"  file creates under the salon's existing subcategory
 *                     B when the page heading A was renamed/restructured —
 *                     otherwise uploadServicesFromJSON spawns a duplicate
 *                     section (repeatable)
 *   --existing FILE   read current services from a JSON array instead of
 *                     Firestore (local dry-runs without SA credentials)
 *   --cache FILE      cache the expand+extract result; reused when present
 *                     (skips the ~2min Playwright scrape + Haiku call)
 *
 * On the VPS (SA key + ANTHROPIC_API_KEY), same pattern as onboard-acuity.ts:
 *   docker run --rm -u root --network host \
 *     --env-file /opt/glaura/.env.onboard \
 *     -v /opt/glaura/secrets/firebase-adminsdk.json:/opt/glaura/secrets/firebase-adminsdk.json:ro \
 *     -v /opt/glaura/resync-services.ts:/app/x.ts:ro \
 *     ghcr.io/glaura-ai/glaura-crm:latest npx tsx x.ts --uid ... --url ... --apply
 *
 * Creates go through the same `uploadServicesFromJSON` Cloud Function as
 * onboarding (it owns subcategory resolution + searchNameList), so created
 * docs are shaped identically to onboarded ones.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

import { FieldValue } from "firebase-admin/firestore";
import { getDb } from "@/lib/firebase-admin";
import {
  buildSearchNameList,
  buildServicesPayload,
  variantKeyForServiceName,
} from "@/lib/onboarding/account-model";
import { expandSalonPage } from "@/lib/onboarding/expand";
import { extractSalon, type ExtractedService, type SalonExtract } from "@/lib/onboarding/extract";
import {
  diffServices,
  type ExistingService,
  type ServiceDiff,
} from "@/lib/onboarding/resync";

const FUNCTIONS_BASE_URL =
  process.env.GLAURA_FUNCTIONS_BASE_URL?.trim() || "https://us-central1-beauty-984c8.cloudfunctions.net";

interface CliArgs {
  uid: string;
  url: string | null;
  apply: boolean;
  aliases: Record<string, string>;
  subcatAliases: Record<string, string>;
  existingFile: string | null;
  cacheFile: string | null;
}

function parseAliasPair(flag: string, pair: string): [string, string] {
  const eq = pair.indexOf("=");
  if (eq <= 0) throw new Error(`${flag} expects "Page name=Existing name", got: ${pair}`);
  return [pair.slice(0, eq).trim(), pair.slice(eq + 1).trim()];
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    uid: "",
    url: null,
    apply: false,
    aliases: {},
    subcatAliases: {},
    existingFile: null,
    cacheFile: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--uid") args.uid = argv[++i] ?? "";
    else if (arg === "--url") args.url = argv[++i] ?? null;
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--existing") args.existingFile = argv[++i] ?? null;
    else if (arg === "--cache") args.cacheFile = argv[++i] ?? null;
    else if (arg === "--alias") {
      const [from, to] = parseAliasPair("--alias", argv[++i] ?? "");
      args.aliases[from] = to;
    } else if (arg === "--subcat-alias") {
      const [from, to] = parseAliasPair("--subcat-alias", argv[++i] ?? "");
      args.subcatAliases[from.toLowerCase()] = to;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.uid) throw new Error("--uid <ownerId> is required");
  if (!args.url && !(args.cacheFile && existsSync(args.cacheFile))) {
    throw new Error("--url <bookingUrl> is required (or --cache with an existing file)");
  }
  return args;
}

async function loadExtract(args: CliArgs): Promise<SalonExtract> {
  if (args.cacheFile && existsSync(args.cacheFile)) {
    console.log(`extract: reusing cache ${args.cacheFile}`);
    return JSON.parse(readFileSync(args.cacheFile, "utf8")) as SalonExtract;
  }
  const url = args.url as string;
  console.log(`expanding ${url} …`);
  const expanded = await expandSalonPage(url);
  console.log(`expanded ${expanded.sourceType} page (${expanded.html.length} bytes) — extracting …`);
  const extract = await extractSalon(expanded.html, expanded.sourceType, url);
  if (args.cacheFile) {
    writeFileSync(args.cacheFile, JSON.stringify(extract, null, 2), "utf8");
    console.log(`extract: cached to ${args.cacheFile}`);
  }
  return extract;
}

function toExistingService(id: string, data: Record<string, unknown>): ExistingService {
  return {
    id,
    service_name: String(data.service_name ?? ""),
    service_price: Number(data.service_price ?? 0),
    duration_minutes: data.duration_minutes == null ? null : Number(data.duration_minutes),
    discounted_price: Number(data.discounted_price ?? 0),
    isActive: Boolean(data.isActive),
    isDeleted: Boolean(data.isDeleted),
  };
}

async function loadExisting(args: CliArgs): Promise<ExistingService[]> {
  if (args.existingFile) {
    const raw = JSON.parse(readFileSync(args.existingFile, "utf8")) as
      | Array<Record<string, unknown>>
      | { documents: Array<Record<string, unknown>> };
    const rows = Array.isArray(raw) ? raw : raw.documents;
    return rows.map((row) => toExistingService(String(row.id ?? ""), row));
  }
  const snap = await getDb().collection("services").where("ownerId", "==", args.uid).get();
  return snap.docs.map((doc) => toExistingService(doc.id, doc.data()));
}

function printDiff(diff: ServiceDiff<ExtractedService>): void {
  const money = (n: number) => `${n}€`;
  console.log(`\n=== RESYNC DIFF ===`);
  console.log(`unchanged: ${diff.unchanged.length}`);

  console.log(`\nupdates (${diff.updates.length}):`);
  for (const u of diff.updates) {
    const parts = Object.entries(u.changes).map(([k, v]) =>
      `${k} → ${k === "duration_minutes" ? `${v}min` : typeof v === "number" ? money(v) : v}`,
    );
    console.log(`  ~ ${u.service_name} [${u.id}]  ${parts.join(", ")}`);
  }

  console.log(`\nrestores (${diff.restores.length}):`);
  for (const r of diff.restores) {
    console.log(`  + ${r.service_name} [${r.id}]  ${money(r.changes.service_price)}${r.changes.duration_minutes ? `, ${r.changes.duration_minutes}min` : ""}`);
  }

  console.log(`\ncreates (${diff.creates.length}):`);
  for (const c of diff.creates) {
    console.log(`  + ${c.service_name}  ${money(c.service_price)}${c.duration_minutes ? `, ${c.duration_minutes}min` : ""}  (${c.subcategory_name} / ${c.category})`);
  }

  console.log(`\ndeactivates (${diff.deactivates.length}):`);
  for (const d of diff.deactivates) {
    console.log(`  - ${d.service_name} [${d.id}]`);
  }

  if (diff.kept.length > 0) {
    console.log(`\nkept, NOT deactivated (${diff.kept.length}) — 0€ "sur devis" docs the scrape may skip; remove manually if truly gone:`);
    for (const k of diff.kept) {
      console.log(`  = ${k.service_name} [${k.id}]`);
    }
  }
  console.log("");
}

/** Firestore hard-caps a WriteBatch at 500 ops; chunk well below it (as create-account.ts does for reviews). */
const BATCH_CHUNK = 400;

async function applyDocWrites(diff: ServiceDiff<ExtractedService>): Promise<void> {
  const db = getDb();
  const writes: Array<{ id: string; patch: Record<string, unknown> }> = [
    ...diff.updates.map((u) => {
      const patch: Record<string, unknown> = { ...u.changes, updatedAt: FieldValue.serverTimestamp() };
      if (u.changes.service_name) {
        patch.searchName = u.changes.service_name.toLowerCase();
        patch.searchNameList = buildSearchNameList(u.changes.service_name);
      }
      return { id: u.id, patch };
    }),
    ...diff.restores.map((r) => ({
      id: r.id,
      patch: { ...r.changes, updatedAt: FieldValue.serverTimestamp() } as Record<string, unknown>,
    })),
    ...diff.deactivates.map((d) => ({
      id: d.id,
      patch: { isActive: false, isDeleted: true, updatedAt: FieldValue.serverTimestamp() } as Record<string, unknown>,
    })),
  ];

  for (let i = 0; i < writes.length; i += BATCH_CHUNK) {
    const batch = db.batch();
    for (const { id, patch } of writes.slice(i, i + BATCH_CHUNK)) {
      batch.update(db.collection("services").doc(id), patch);
    }
    await batch.commit();
  }
  console.log(`applied ${writes.length} doc write(s) (updates/restores/deactivates)`);
}

async function applyCreates(
  diff: ServiceDiff<ExtractedService>,
  extract: SalonExtract,
  uid: string,
  subcatAliases: Record<string, string>,
): Promise<void> {
  if (diff.creates.length === 0) return;
  const creates = diff.creates.map((svc) => ({
    ...svc,
    subcategory_name: subcatAliases[svc.subcategory_name.toLowerCase()] ?? svc.subcategory_name,
  }));
  const { payload, variantsByServiceName } = buildServicesPayload({ ...extract, services: creates }, uid);

  const response = await fetch(`${FUNCTIONS_BASE_URL}/uploadServicesFromJSON`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await response.json().catch(() => null)) as {
    success?: boolean;
    message?: string;
    results?: { totalCreatedServices?: number; totalSkipped?: number; errors?: unknown[] };
  } | null;
  if (!response.ok || !body?.success) {
    throw new Error(`uploadServicesFromJSON failed (HTTP ${response.status}): ${body?.message ?? response.statusText}`);
  }
  console.log(`created ${body.results?.totalCreatedServices ?? 0} service(s), skipped ${body.results?.totalSkipped ?? 0}`);

  // Patch variants onto just-created docs (same post-upload pass as onboarding).
  const variantKeys = Object.keys(variantsByServiceName);
  if (variantKeys.length === 0) return;
  const db = getDb();
  const snap = await db.collection("services").where("ownerId", "==", uid).get();
  let patched = 0;
  for (const doc of snap.docs) {
    const name = String((doc.data() as { service_name?: string }).service_name ?? "");
    const patch = variantsByServiceName[variantKeyForServiceName(name)];
    if (!patch) continue;
    try {
      await doc.ref.update({ variants: patch.variants, base_option_label: patch.base_option_label, updated_at: FieldValue.serverTimestamp() });
      patched += 1;
    } catch (error) {
      console.warn(`variant patch failed for ${doc.id} (${name}): ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  console.log(`patched variants on ${patched} service(s)`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const extract = await loadExtract(args);
  console.log(`page menu: ${extract.services.length} services (${extract.salon.name})`);

  const existing = await loadExisting(args);
  console.log(`firestore: ${existing.length} service docs for ${args.uid}`);

  const diff = diffServices(existing, extract.services, { aliases: args.aliases });
  printDiff(diff);

  if (!args.apply) {
    console.log("dry-run only — re-run with --apply to write.");
    return;
  }

  // A typo'd uid must not seed a duplicate catalog under a bogus owner.
  const profile = await getDb().collection("userProfile").doc(args.uid).get();
  if (!profile.exists) throw new Error(`userProfile/${args.uid} does not exist — refusing to write`);
  const profileName = String((profile.data() as { companyName?: string; name?: string }).companyName ?? "") || "?";
  console.log(`applying to ${profileName} (${args.uid}) …`);

  await applyDocWrites(diff);
  await applyCreates(diff, extract, args.uid, args.subcatAliases);
  console.log("resync complete.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
