// Headers for goglow-backend's /api/send-sms. The backend checks the shared
// secret; without it the call is only logged until enforcement is turned on.
export function smsRelayHeaders(): Record<string, string> {
  const secret = process.env.GOGLOW_BACKEND_SMS_SECRET?.trim();
  return {
    "content-type": "application/json",
    ...(secret ? { "X-Glaura-SMS-Secret": secret } : {}),
  };
}
