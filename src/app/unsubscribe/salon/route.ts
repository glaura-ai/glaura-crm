import { optOutOfDigest } from "@/lib/feature-digest/opt-out";
import { verifyUnsubscribeToken } from "@/lib/feature-digest/unsubscribe-token";
import { escapeHtml } from "@/lib/emailTemplates";

export const dynamic = "force-dynamic";

function page(title: string, body: string, status = 200): Response {
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#FFFBF7;color:#1A2B4A;font-family:Arial,sans-serif;"><main style="max-width:480px;margin:15vh auto;padding:0 24px;text-align:center;"><h1 style="font-family:Georgia,serif;font-size:26px;">${escapeHtml(title)}</h1>${body}</main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function providerFrom(request: Request): string | null {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  return verifyUnsubscribeToken(token, process.env.SALON_DIGEST_UNSUB_SECRET ?? "");
}

const invalid = () => page("Lien invalide", "<p>Ce lien de désinscription n’est pas valide.</p>", 400);

export async function GET(request: Request) {
  if (!providerFrom(request)) return invalid();
  const token = new URL(request.url).searchParams.get("t") ?? "";
  return page(
    "Ne plus recevoir les nouveautés ?",
    `<p>Vous ne recevrez plus nos emails de nouveautés Glaura.</p>
<form method="post" action="/unsubscribe/salon?t=${encodeURIComponent(token)}"><button type="submit" style="background:#D92D58;color:#fff;border:0;border-radius:14px;padding:14px 24px;font-size:16px;font-weight:700;cursor:pointer;">Confirmer</button></form>`,
  );
}

/** Handles both the confirm form and RFC 8058 one-click (`List-Unsubscribe=One-Click`). */
export async function POST(request: Request) {
  const providerId = providerFrom(request);
  if (!providerId) return invalid();
  try {
    await optOutOfDigest(providerId);
  } catch (err) {
    console.error("[unsubscribe/salon] opt-out failed", providerId, err);
    return page("Une erreur est survenue", "<p>Veuillez réessayer dans quelques instants.</p>", 500);
  }
  return page("C’est noté", "<p>Vous ne recevrez plus nos emails de nouveautés.</p>");
}
