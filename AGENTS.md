<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# glaura-crm — sales CRM

Internal sales CRM ("Notifai") for the Glaura sales/admin team: prospect Paris
beauty salons, run a pipeline, schedule follow-ups, and trigger onboarding that
auto-creates a disabled Glaura account for the salon.

## Stack

- Next.js 16, React 19, TypeScript (strict).
- Prisma 6 + **PostgreSQL** (source of truth; `prisma/schema.prisma`). Note:
  `docs/design.md` still says MySQL — the code and deploy use Postgres.
- NextAuth 5 (beta) for auth; Tailwind 4; Vitest for tests; Anthropic SDK for
  AI-assisted prospecting; Firebase Admin.
- Node 22.

## Layout

- `src/app/(app)/` — `dashboard`, `modeles`, `onboarding`, `prospection`, `salons`; plus `login/` and `api/`.
- `prisma/schema.prisma` — models `User`, `Salon`, `Prospect`, `Tournee`, `Activity`, `Reminder`, `EmailJob`, `EmailTemplate`, `OnboardingJob`, `OnboardingJobEvent`, with pipeline enums (`SalonStatus`, `ProspectStatus` NOUVEAU→CONVERTI, `OnboardingStatus`, `IgStatus`, `GoogleStatus`).
- `scripts/` — background workers (`email:worker`, `onboard:worker`, `prospect:sweep`) and the Airtable import.
- `onboarding/`, `docker-compose.yml`, `Dockerfile`, `.github/workflows/build-image.yml`.
- `docs/design.md` — the real architecture/design doc (the `README.md` is unmodified `create-next-app` boilerplate).

## Commands

```bash
npm install
npm run dev
npm run lint
npm test            # vitest run (there is no typecheck script)
npm run db:migrate
npm run db:studio
npm run db:seed
npm run import:airtable
npm run email:worker      # and: onboard:worker, prospect:sweep
npm run build
```

## Deploy

- CI (`build-image.yml`) builds the image to GHCR `ghcr.io/glaura-ai/glaura-crm:latest`.
- The VPS runs a Docker Compose stack (services: `web` on `PORT=3102`,
  `onboarding-worker`, `email-worker`; `network_mode: host` because Postgres runs
  on the host, not in Docker).
- Live at `https://crm.glaura.ai`. Use the repo's `deploy-crm` skill, but verify
  the host — a 2026-10 handoff flagged the host in that skill as outdated
  (Hetzner Nuremberg, `188.245.250.151`).

## Conventions

- Integrate and push changes to `develop` first, then promote to `main` through
  the release workflow. Do not bypass it for fixes.
- Never commit `.env` files or secrets.
- Follow the root workflow (TDD, lint, code review, ask before push/merge/deploy).
