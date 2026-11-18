import { isPreviewBot, recordClickAndResolve } from "@/lib/outreach/booking";
import { calendarUrlOf, DEFAULT_OUTREACH_SETTINGS } from "@/lib/outreach/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public tracked link sent in the outreach messages: counts the click, redirects to the salesperson's calendar. */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  let url: string;
  try { url = await recordClickAndResolve((await params).token, { count: !isPreviewBot(request.headers.get("user-agent")) }); }
  catch (e) { console.error("[demo] redirect failed", e); url = calendarUrlOf(DEFAULT_OUTREACH_SETTINGS); }
  return Response.redirect(url, 302);
}
