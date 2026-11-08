import { z } from "zod";
import { verifyMetaSignature } from "@/lib/instagram-inbox/security";
import { storeInstagramMessage } from "@/lib/instagram-inbox/store";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  const token = process.env.IG_WEBHOOK_VERIFY_TOKEN;
  if (!token || query.get("hub.mode") !== "subscribe" || query.get("hub.verify_token") !== token) return new Response("Accès refusé", { status: 403 });
  return new Response(query.get("hub.challenge") ?? "", { headers: { "Content-Type": "text/plain" } });
}

const eventSchema = z.object({ sender: z.object({ id: z.string() }), recipient: z.object({ id: z.string() }), timestamp: z.number(), message: z.object({ mid: z.string(), text: z.string().optional(), is_echo: z.boolean().optional(), attachments: z.array(z.unknown()).optional() }).optional() });
const payloadSchema = z.object({ object: z.literal("instagram"), entry: z.array(z.object({ id: z.string(), messaging: z.array(z.unknown()).optional() })).max(100) });
export async function POST(request: Request) {
  if (Number(request.headers.get("content-length")) > 1024 * 1024) return new Response("Demande trop volumineuse", { status: 413 });
  const body = await request.text();
  if (Buffer.byteLength(body) > 1024 * 1024) return new Response("Demande trop volumineuse", { status: 413 });
  if (!verifyMetaSignature(body, request.headers.get("x-hub-signature-256"), process.env.META_APP_SECRET)) return new Response("Signature invalide", { status: 403 });
  let payload;
  try { payload = payloadSchema.parse(JSON.parse(body)); } catch { return new Response("Évènement invalide", { status: 400 }); }
  const accountId = process.env.IG_GRAPH_USER_ID;
  if (!accountId) return new Response("Connexion non configurée", { status: 503 });
  try {
    for (const entry of payload.entry) {
      if (entry.id !== accountId) continue;
      for (const raw of entry.messaging ?? []) {
        const parsed = eventSchema.safeParse(raw);
        if (!parsed.success || !parsed.data.message) continue;
        const event = parsed.data;
        const message = event.message!;
        if (event.sender.id !== accountId && event.recipient.id !== accountId) continue;
        const incoming = event.sender.id !== accountId;
        const sentAt = new Date(event.timestamp);
        if (!Number.isFinite(sentAt.getTime())) continue;
        await storeInstagramMessage(accountId, { id: message.mid, participantId: incoming ? event.sender.id : event.recipient.id, incoming, text: message.text ?? (message.attachments?.length ? "[Pièce jointe — consulter Instagram]" : "[Message non textuel]"), sentAt });
      }
    }
  } catch { return new Response("Enregistrement temporairement indisponible", { status: 503 }); }
  return Response.json({ received: true });
}
