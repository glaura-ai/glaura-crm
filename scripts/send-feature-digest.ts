/**
 * Monthly feature digest to salons.
 *
 *   npm run digest:send -- --edition 2026-11 --features a,b,c --dry-run
 *   npm run digest:send -- --edition 2026-11 --features a,b,c --to me@example.com
 *   npm run digest:send -- --edition 2026-11 --features a,b,c --all
 *
 * Env: SMTP_*, SALON_DIGEST_UNSUB_SECRET, GOOGLE_APPLICATION_CREDENTIALS, DATABASE_URL (--all),
 *      PORTAL_BASE_URL (default https://pro.glaura.ai), CRM_PUBLIC_URL (default https://crm.glaura.ai).
 * Recipients come from Firestore prod-eu (see src/lib/firebase-admin.ts).
 */
import { parseArgs } from "node:util";
import { fetchCatalog, pickFeatures } from "../src/lib/feature-digest/catalog";
import { selectRecipients, type ProfileDoc } from "../src/lib/feature-digest/recipients";
import { renderDigest } from "../src/lib/feature-digest/render";
import { runDigest, type DigestMode } from "../src/lib/feature-digest/run";
import { signUnsubscribeToken } from "../src/lib/feature-digest/unsubscribe-token";

const BATCH_SIZE = 20;
const DELAY_MS = 1500;
const REPLY_TO = "support@glaura.fr";
const strip = (url: string) => url.replace(/\/+$/, "");

async function main() {
  const { values } = parseArgs({
    options: {
      edition: { type: "string" },
      features: { type: "string" },
      subject: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      to: { type: "string" },
      all: { type: "boolean", default: false },
    },
  });

  const edition = values.edition ?? "";
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(edition)) throw new Error("--edition YYYY-MM requis");
  const modes = [values["dry-run"], values.to, values.all].filter(Boolean).length;
  if (modes !== 1) throw new Error("Choisir exactement un mode : --dry-run | --to <email> | --all");

  const secret = process.env.SALON_DIGEST_UNSUB_SECRET ?? "";
  if (!secret) throw new Error("SALON_DIGEST_UNSUB_SECRET manquant");
  const portal = strip(process.env.PORTAL_BASE_URL || "https://pro.glaura.ai");
  const crm = strip(process.env.CRM_PUBLIC_URL || "https://crm.glaura.ai");

  const catalog = await fetchCatalog(portal);
  const features = pickFeatures(catalog, (values.features ?? "").split(",").map((s) => s.trim()).filter(Boolean));

  const { getDb } = await import("../src/lib/firebase-admin");
  const snap = await getDb().collection("userProfile").where("userRole", "==", 2).get();
  const docs: ProfileDoc[] = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
  const recipients = selectRecipients(docs);

  const mode: DigestMode = values["dry-run"]
    ? { mode: "dry-run" }
    : values.to
      ? { mode: "test", to: values.to }
      : { mode: "all" };

  let prisma: typeof import("../src/lib/db").prisma | null = null;
  if (mode.mode === "all") prisma = (await import("../src/lib/db")).prisma;

  const { sendEmail } = await import("../src/lib/email");
  const result = await runDigest(
    {
      edition,
      recipients,
      batchSize: BATCH_SIZE,
      delayMs: DELAY_MS,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      send: async (job) => {
        const tokenId = job.providerId; // sentinel for --to samples
        const unsubscribeUrl = `${crm}/unsubscribe/salon?t=${encodeURIComponent(signUnsubscribeToken(tokenId, secret))}`;
        const { subject, html, text } = renderDigest({
          edition,
          salonName: job.salonName,
          features,
          portalBaseUrl: portal,
          unsubscribeUrl,
          subject: values.subject,
        });
        await sendEmail({
          to: job.email,
          subject,
          html,
          text,
          replyTo: REPLY_TO,
          headers: {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        });
      },
      claim: async (r) => {
        if (!prisma) return false;
        try {
          await prisma.featureDigestSend.create({ data: { edition, providerId: r.providerId, email: r.email } });
          return true;
        } catch (err) {
          if ((err as { code?: string }).code !== "P2002") throw err;
          // Row exists: retry only a previously failed one (atomic, so racing runs cannot both win).
          const { count } = await prisma.featureDigestSend.updateMany({
            where: { edition, providerId: r.providerId, sentAt: null, error: { not: null } },
            data: { error: null },
          });
          return count === 1;
        }
      },
      markSent: async (r) => {
        await prisma?.featureDigestSend.update({
          where: { edition_providerId: { edition, providerId: r.providerId } },
          data: { sentAt: new Date() },
        });
      },
      markFailed: async (r, error) => {
        await prisma?.featureDigestSend.updateMany({
          where: { edition, providerId: r.providerId, sentAt: null },
          data: { error },
        });
      },
      optedOut: async (ids) => {
        const refs = ids.map((id) => getDb().collection("userProfile").doc(id));
        const snaps = await getDb().getAll(...refs);
        return new Set(
          snaps.filter((d) => d.get("featureAnnouncements.emailOptOut") === true).map((d) => d.id),
        );
      },
    },
    mode,
  );

  console.log(`Edition ${edition} · mode ${mode.mode} · eligible salons: ${result.total}`);
  if (mode.mode === "dry-run") {
    console.log(`Features: ${features.map((f) => f.id).join(", ")}`);
    result.preview.forEach((r) => console.log(`  ${r.providerId}  ${r.email}  ${r.salonName}`));
    console.log("Dry run: nothing sent.");
  } else {
    console.log(`sent ${result.sent} · skipped ${result.skipped} · failed ${result.failed}`);
  }
  await prisma?.$disconnect();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
