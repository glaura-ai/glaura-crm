// Creating the Glaura account behind a Laura lead.
//
// Deliberately minimal, and deliberately NOT the onboarding pipeline: a salon
// on this offer keeps its own booking tool, so there is nothing to scrape and
// no catalogue to build. We create an account, put it on the Laura plan, and
// email the salon a way in. Everything else it sets up itself, guided by the
// checklist on the portal's Accueil.
//
// Pure helpers are separated from the impure writes so the profile shape and
// the slug/trial rules can be tested without Firebase.

import { Timestamp } from "firebase-admin/firestore";

/** Laura's own trial window. Mirrors TRIAL_DAYS in the portal's
 *  billing-state.ts — the portal is the authority, this only pre-seeds it. */
export const LAURA_TRIAL_DAYS = 14;

const SERVICE_PROVIDER_ROLE = 2;

export type LauraAccountInput = {
  email: string;
  salonName: string;
  contactName: string;
  phone?: string | null;
  instagram?: string | null;
  bookingUrl?: string | null;
};

/** Strips the @ and any profile-URL wrapper a salon may have typed. */
export function normalizeInstagram(value: string | null | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw) return "";
  const fromUrl = raw.match(/instagram\.com\/([^/?#]+)/i);
  return (fromUrl ? fromUrl[1] : raw).replace(/^@+/, "").replace(/\/+$/, "").slice(0, 120);
}

/** The account is created before the salon has chosen anything, so the trial
 *  clock starts here rather than at first login — otherwise a salon that never
 *  opens the email would hold an unstarted trial indefinitely. */
export function trialWindow(now: Date): { startedAt: Date; endsAt: Date } {
  return {
    endsAt: new Date(now.getTime() + LAURA_TRIAL_DAYS * 86_400_000),
    startedAt: now,
  };
}

/** The minimum a userProfile needs for the portal to treat this as a salon on
 *  the Laura offer. No services, no agents, no hours — the salon's own tool
 *  owns those, and the portal's Laura view never asks for them. */
export function buildLauraUserProfile(
  input: LauraAccountInput,
  ctx: { uid: string; companyUserName: string; now: Date },
): Record<string, unknown> {
  const { startedAt, endsAt } = trialWindow(ctx.now);

  return {
    id: ctx.uid,
    email: input.email,
    name: input.salonName,
    companyName: input.salonName,
    companyUserName: ctx.companyUserName,
    phone: (input.phone ?? "").trim(),
    insta: normalizeInstagram(input.instagram),
    countryCode: "+33",

    // Role is what gates portal access (see portal provider-access.ts).
    userRole: SERVICE_PROVIDER_ROLE,
    initialUserRole: SERVICE_PROVIDER_ROLE,

    // The plan is what makes the portal render the reduced Laura view:
    // laura + pilotage, no réservation. See portal salon-mode.ts.
    subscriptionPlanCode: "laura_lite",
    trialStartedAt: Timestamp.fromDate(startedAt),
    trialEndsAt: Timestamp.fromDate(endsAt),

    // The booking link the salon gave us on /laura. Stored so the agenda step
    // of the setup checklist has something to work from; nothing reads it
    // automatically and nothing is scraped.
    bookingUrl: (input.bookingUrl ?? "").trim(),

    // Laura is off until the salon has connected a channel and reviewed what
    // she knows — switching her on for an empty account would have her
    // answering with nothing to say.
    aiAssistantEnabled: false,

    // Hidden from the marketplace: the offer is explicitly "Glaura is invisible
    // infrastructure behind your Instagram" (doc 34 §1), and a salon that asked
    // to be called has not asked to be listed. Reversible with one field.
    //
    // NOTE: doc 34 gap 6 flags that slot/booking paths with enable:false are
    // unverified. It cannot bite a fresh account (no agents or services yet, so
    // there is nothing to quote either way), but it must be verified before
    // Laura starts quoting availability for these salons.
    enable: false,

    isActive: true,
    isDeleted: false,
    createdAt: Timestamp.fromDate(ctx.now),
    updatedAt: Timestamp.fromDate(ctx.now),
  };
}
