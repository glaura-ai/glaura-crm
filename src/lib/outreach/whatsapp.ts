import { createHmac } from "node:crypto";
import { getDb } from "@/lib/firebase-admin";
import { whatsappOutreachConfig } from "./config";

/** Sends an approved WhatsApp template (body variable: the salon name; optional dynamic URL button suffix). Returns the wamid. */
export async function sendOutreachTemplate(opts: { to: string; template: string; language: string; displayName: string; buttonParam?: string }): Promise<string> {
  const config = whatsappOutreachConfig();
  if (!config) throw new Error("La connexion WhatsApp n’est pas configurée.");
  const secret = process.env.META_APP_SECRET?.trim();
  const url = new URL(`https://graph.facebook.com/${config.version}/${config.phoneNumberId}/messages`);
  if (secret) url.searchParams.set("appsecret_proof", createHmac("sha256", secret).update(config.token).digest("hex"));
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to: opts.to.replace(/^\+/, ""), type: "template", template: { name: opts.template, language: { code: opts.language }, components: [{ type: "body", parameters: [{ type: "text", text: opts.displayName }] }, ...(opts.buttonParam ? [{ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: opts.buttonParam }] }] : [])] } }),
    cache: "no-store", signal: AbortSignal.timeout(20000), redirect: "error",
  });
  if (!response.ok) throw new Error(`WhatsApp a refusé l’envoi (HTTP ${response.status}).`);
  const body = await response.json() as { messages?: { id?: string }[] };
  const id = body.messages?.[0]?.id;
  if (!id) throw new Error("WhatsApp n’a pas confirmé l’envoi.");
  return id;
}

/** True when the number asked to stop WhatsApp messages (Firestore `whatsappOptOuts/{E.164}`). */
export async function isWhatsappOptedOut(e164: string) {
  return (await getDb().collection("whatsappOptOuts").doc(e164).get()).exists;
}
