# Notifai — Sales CRM Design Spec (crm.glaura.ai)

**Date:** 2026-06-03
**Status:** Draft for review
**Owner:** Henry Tanoh

## 1. Overview

Notifai is a light sales CRM for the Glaura sales/admin team to prospect and convert
Paris beauty salons, hosted at **crm.glaura.ai**. It manages the pipeline from
first contact to signed, reduces the reps' "charge mentale" with a daily priorities
view, logs every interaction, and — when a salon signs — triggers the **onboarding
engine** (sub-project #1) to auto-create the salon's (disabled) Glaura account.

This document specifies **v1 = Core CRM + onboarding trigger**. Later phases
(dashboard, itinéraire, RDV confirmation mail, admin cross-commercial view) are
captured in the Roadmap.

## 2. Scope

### In scope (v1)

- Google Workspace SSO login (restricted to `@glaura.fr`).
- Salon pipeline: list with filters + search, salon cards, add/edit.
- Status workflow: `à visiter → visite faite → intéressé → à relancer → pas intéressé → signé`.
- Salon detail with activity timeline.
- Activity logging: `appel, visio, visite, à relancer (relance), email, note`.
- Lead intake from Airtable (the existing capture form) synced into MySQL.
- **Account-readiness trigger**: a button on a salon that enqueues an onboarding job
  the engine consumes; result (credentials, disabled account) shown back on the salon.

### Out of scope (v1 — see Roadmap)

- "Aujourd'hui" daily-priorities dashboard with KPI tiles + conversion funnel.
- Itinéraire (route planning for field visits).
- RDV scheduling + automated client confirmation email (09:00–10:00 window).
- Admin cross-commercial view (per-rep activity: appels/visios/visites/relances/emails).
- Notifai becoming the *primary* lead source (Airtable remains intake in v1).

## 3. Stack & hosting

| Concern | Choice | Notes |
|-|-|-|
| Framework | Next.js (App Router, TypeScript) | UI + API in one app; Node runtime shared with the engine |
| DB | MySQL | Source of truth; Airtable is intake only |
| ORM | Prisma | Drizzle is an acceptable alternative |
| Auth | Auth.js (NextAuth v5), Google provider | Domain-restricted to `@glaura.fr` |
| Styling | Tailwind CSS | To match the polished mockups |
| Hosting | Self-hosted, EU (Hetzner) via Docker, behind Cloudflare | French data residency; Vercel is a fallback option |

**Why MySQL source of truth, Airtable as intake:** clean ownership, fast relational
queries for filters/reporting, and the pipeline data is internal sales data that does
not belong in the customer Firestore. Airtable stays as the low-friction capture form.

## 4. Architecture

```
Airtable lead form
   └─(automation webhook, HMAC)→ POST /api/intake/airtable ──► upsert Salon (source=airtable)
                                  (+ nightly reconcile poll as fallback)

Next.js app (crm.glaura.ai)
   ├─ UI (App Router, server components + client islands)
   ├─ API route handlers (REST-ish) + server actions
   ├─ Auth.js middleware (every route requires @glaura.fr session)
   └─ MySQL (Prisma): User, Salon, Activity, OnboardingJob

Account-readiness:
   CRM "Préparer le compte" → create OnboardingJob(status=queued)
                                          │
   Onboarding engine (separate VPS Node service)
     polls  GET  /api/onboarding/jobs?status=queued   (service token)
     runs   claude -p (scrape + create DISABLED account)
     writes PATCH /api/onboarding/jobs/:id  {status, accountUid, login, counts, warnings}
                                          │
   CRM shows result (credentials + disabled account) on the salon
```

**Engine decoupling:** the engine never imports CRM code. It talks to one small HTTP
contract (`/api/onboarding/jobs`). This is the same "thin trigger adapter" idea from
the engine spec — we just swap the Airtable adapter for a Notifai adapter
(`trigger/notifai.js`) implementing `fetchPending` / `claim` / `writeResult` against
this API. The engine core is unchanged.

## 5. Data model (Prisma sketch)

```
User
  id, email (unique), name, avatarUrl, role (COMMERCIAL | ADMIN),
  googleId, createdAt, lastLoginAt

Salon                       // a prospect/lead
  id, name, slug,
  metier (COIFFURE|ESTHETIQUE|ONGLES|BARBIER|SPA),   // single in v1; revisit multi
  type (A|B|C|D),                                     // segmentation tier (define meaning)
  arrondissement (string/int), address, lat, lng,    // lat/lng nullable, for itinéraire later
  phone, instagram,
  bookingTool (ACUITY|PLANITY|TREATWELL|SITE|NONE), bookingUrl,
  rating (float, nullable),
  status (A_VISITER|VISITE_FAITE|INTERESSE|A_RELANCER|PAS_INTERESSE|SIGNE),
  assignedToId → User (nullable),
  source (AIRTABLE|MANUAL), externalRef (airtable record id, nullable, unique),
  notes (text),
  lastContactedAt, nextActionAt,                      // feed future priorities view
  createdAt, updatedAt

Activity
  id, salonId → Salon, userId → User,
  type (APPEL|VISIO|VISITE|RELANCE|EMAIL|NOTE),
  notes (text), outcome (string, nullable),
  scheduledAt (nullable), completedAt (nullable),
  createdAt

OnboardingJob               // bridge to the onboarding engine
  id, salonId → Salon, requestedById → User,
  sourceUrl, sourceType (PLANITY|TREATWELL|ACUITY|GENERIC, nullable),
  status (QUEUED|PROCESSING|DONE|FAILED|ALREADY_ONBOARDED),
  accountUid (nullable), loginEmail (nullable), loginPasswordEnc (nullable),
  serviceCount, agentCount, warnings (json), error (text, nullable),
  createdAt, updatedAt
```

Status enums map 1:1 to the mockup's filter chips and the result schema from the
engine spec.

## 6. Key flows

### 6.1 Lead intake (Airtable → MySQL)

- Airtable automation fires on new/updated lead → POST `/api/intake/airtable` with an
  HMAC signature header. Handler validates signature, maps fields, **upserts** Salon by
  `externalRef` (idempotent). New leads default `status=A_VISITER`, `source=AIRTABLE`.
- Fallback reconciliation: a scheduled task (cron/route) pulls recent Airtable rows
  nightly to catch missed webhooks.

### 6.2 Pipeline management

- `/salons` list: filter by Métier, Arrondissement, Type, Status chips, assigned rep;
  free-text search; salon cards (name, métier tags, address, Instagram, rating, type
  badge). "Ajouter un salon" opens the add form.
- `/salons/:id` detail: info panel, status control, activity timeline, edit, and the
  account-readiness panel.
- Add/edit form fields per mockup: name, arrondissement, métier, status (+ rating
  stars), Outils de RDV (tool + booking URL), phone, Instagram.

### 6.3 Activity logging

- From the salon detail, log an activity (type + notes, optional scheduledAt). Logging
  updates `lastContactedAt`; scheduling a follow-up sets `nextActionAt` (drives the v2
  priorities view). Timeline shows reverse-chronological activities.

### 6.4 Account-readiness → onboarding

- Button "Préparer le compte" on a salon (intended once `status=SIGNÉ`, but allowed
  earlier with a confirm). Creates `OnboardingJob(status=QUEUED)` with
  `sourceUrl = bookingUrl`. If `bookingTool=NONE`/no URL, warn that the salon has no
  scrapable booking page (the Instagram-only case) and block or allow manual entry.
- The engine consumes the job, runs headless onboarding (creates a **disabled**
  account), and PATCHes the result back. The salon detail shows job status and, on
  success, the generated `loginEmail` + password (decrypted on demand, audit-logged)
  and the disabled `accountUid`. Going live (enabling the account) stays a manual,
  separate step outside v1.

## 7. Auth & authorization

- Auth.js Google provider; reject sign-ins whose email domain ≠ `glaura.fr`
  (verify `hd` claim + explicit allowlist). Session via database adapter.
- Middleware guards all pages and API routes. Service-to-service calls from the engine
  use a separate static **service token** (not a user session), scoped to
  `/api/onboarding/jobs`.
- v1 roles: `COMMERCIAL` and `ADMIN`. All authenticated staff can see/edit all salons
  (per-rep restriction and the admin cross-commercial view come in v2). Only the
  salon's `assignedTo` or an `ADMIN` may trigger onboarding (revisit).

## 8. Non-functional

- **Data residency:** EU hosting (Hetzner), Cloudflare in front. French PII (salon
  contacts) stays in the EU.
- **Secrets:** DB creds, Airtable token, Google OAuth client, engine service token, and
  the password-encryption key in env (never committed).
- **Auditability:** log who triggered onboarding and who revealed credentials.
- **Performance:** server-side pagination + indexed filters (status, métier,
  arrondissement, assignedTo) on the salon list.

## 9. Testing

- **Unit:** status transitions; Airtable field mapping + upsert idempotency;
  OnboardingJob lifecycle; domain-restricted auth guard.
- **Integration:** `/api/intake/airtable` (signature + upsert); `/api/onboarding/jobs`
  GET/PATCH with the service token.
- **E2E (Playwright):** Google-SSO login (mocked) → create salon → log activity →
  change status → trigger onboarding → see result.

## 10. Open questions

- **Type A/B/C/D** — what do these tiers mean (deal size? readiness? priority?)? Drives
  sorting and the v2 KPI tiles.
- **Métier** — single value per salon, or multi-select (a salon doing coiffure + ongles)?
- **Credentials policy** — store the generated salon password encrypted and reveal in
  UI, or never store it and email it to the salon on go-live?
- **Onboarding trigger gate** — any rep, or only assigned rep / admin? Only when
  `SIGNÉ`?
- **Airtable field map** — exact field names in base `appVtDLXBQEyLx5kU`.

## 11. Roadmap (post-v1)

1. **Daily priorities dashboard** ("Aujourd'hui"): KPI tiles (Total, Type A/B/C/D,
   Visites), "X priorités à visiter", "relances dues", "à recontacter", conversion
   funnel, "Voir mes N actions du jour".
2. **Itinéraire**: cluster the day's visit priorities by geography; route ordering
   (needs lat/lng geocoding on Salon).
3. **RDV + confirmation mail**: schedule client appointments; send a confirmation email
   in the 09:00–10:00 window.
4. **Admin cross-commercial view**: per-rep activity rollups (appels, visios, visites,
   relances, emails) and pipeline by rep.
5. **Notifai as primary lead source**: in-app lead creation/import replaces Airtable
   intake; retire the Airtable form.
```
