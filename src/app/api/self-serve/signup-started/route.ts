/**
 * Self-serve signup registration API.
 *
 * The SP portal calls this the moment a salon submits the /pro signup form —
 * BEFORE the Instagram Business Login gate — so salons that never come back
 * from Meta still exist in the CRM pipeline. The onboarding worker's sweep
 * flags rows still `signup_started` after 30 minutes as `signup_stuck`.
 *
 * Auth mirrors /api/self-serve/onboard: shared `SELF_SERVE_ONBOARD_SECRET`
 * bearer, compared in constant time. Idempotent per portal account
 * (`externalRef self_serve:{targetUid}`) — the later onboard dispatch updates
 * the same row.
 */

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { isBearerAuthorized } from "@/lib/bearer-auth";
import { normalizeInstagramHandle } from "@/lib/instagram";
import { registerSignupStarted } from "@/lib/onboarding/signup-started";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  targetUid: z.string().min(1),
  email: z.string().email(),
  salonName: z.string().min(1),
  bookingUrl: z.string().url(),
  contactName: z.string().trim().optional(),
  phone: z.string().trim().optional(),
  instagramHandle: z.string().trim().max(500).optional().transform(normalizeInstagramHandle),
  planCode: z.enum(["basic", "reservation"]).optional(),
});

export async function POST(req: NextRequest) {
  if (!isBearerAuthorized(req.headers.get("authorization"), process.env.SELF_SERVE_ONBOARD_SECRET)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body", issues: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const result = await registerSignupStarted(prisma, parsed.data);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return NextResponse.json(
      { error: "register_failed", message: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
