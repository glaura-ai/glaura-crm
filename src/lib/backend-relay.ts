// Gateway compat endpoint for SMS. It enqueues into the notification outbox
// (retries, dedupe) and replaces goglow-backend's /api/send-sms, which is
// being retired. GLAURA_SMS_SEND_URL still overrides the URL.
const DEFAULT_GATEWAY_URL = "https://api.glaura.ai";

export function smsRelayUrl(): string {
  const explicit = process.env.GLAURA_SMS_SEND_URL?.trim();
  if (explicit) return explicit;
  const base = (process.env.GLAURA_GATEWAY_URL?.trim() || DEFAULT_GATEWAY_URL).replace(/\/+$/, "");
  return `${base}/notifications/send-sms`;
}

// The gateway checks the shared secret and answers 503/403 without it.
export function smsRelayHeaders(): Record<string, string> {
  const secret = process.env.GOGLOW_BACKEND_SMS_SECRET?.trim();
  return {
    "content-type": "application/json",
    ...(secret ? { "x-glaura-sms-secret": secret } : {}),
  };
}

export function smsRelayBody(input: { to: string; body: string; source: string; idempotencyKey?: string }): string {
  return JSON.stringify({
    To: input.to,
    Body: input.body,
    source: input.source,
    ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {}),
  });
}
