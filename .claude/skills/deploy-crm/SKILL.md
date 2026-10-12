---
name: deploy-crm
description: Deploy glaura-crm to the VPS — build the image on the host from main (scripts/build-on-server.sh), then roll the compose stack (web + onboarding-worker + email-worker) and verify. Use when asked to deploy the CRM, ship it, push it live, or release the current main.
---

# Deploy glaura-crm

Deploys whatever is on `main` to https://crm.glaura.ai. The image is built ON
the host by `scripts/build-on-server.sh` (GitHub Actions minutes are no longer
available, 2026-10-12); deploying is build + `compose up -d`, never
`compose pull` (that would swap in the stale GHCR image).

## Facts about the target

- VPS: `ssh root@188.245.250.151`, stack at `/opt/glaura/glaura-crm`
- Image: `ghcr.io/glaura-ai/glaura-crm:latest`, built on the host by `scripts/build-on-server.sh` (local only, never pushed)
- Run config: `docker-compose.yml` **in this repo** is the source of truth. Step 4 copies it up, so server-side edits are overwritten — change it here and merge
- Env file: `/opt/glaura/glaura-crm/.env.docker` on the host, NOT in the repo (secrets). Not the older 26-key `.env` sitting next to it
  - `LAURA_LEAD_SECRET` — shared secret for `POST /api/leads/laura`, where the
    marketing site posts "être rappelée" leads from glaura.ai/laura. Must match
    `CRM_LAURA_LEAD_SECRET` in the Goglow-website env. **Unset means every lead
    is rejected with 401** (fails closed by design), and the site then logs
    `laura_lead_crm_failed` and keeps only the Airtable copy — so set it before
    or with the deploy that first ships that endpoint
  - `TRANSACTIONAL_EMAIL_SECRET` — shared secret for
    `POST /api/transactional/booking-refund`, called by the Cloud Function
    `adminRefundBooking` after an admin refund. Must match
    `CRM_TRANSACTIONAL_EMAIL_SECRET` in `goglow-firebase/functions/.env`.
    **Unset means the route answers 503** (fails closed); the refund itself
    still succeeds on the functions side and reports
    `emailSkippedReason: email_send_failed`
- Postgres `glaura_crm` runs on the VPS **host**, not in Docker — hence `network_mode: host`
- Web listens on `PORT=3102`
- `/opt/glaura/glaura-crm` also holds a stale git checkout (unrelated to deploys, ignore it)

## Steps

### 1. Confirm what you are shipping

```bash
git status --short && git log --oneline -1
npm run lint && npm test
```

`main` must be pushed and the working tree clean — the image is built from the
GitHub commit, so uncommitted local work is NOT in the deploy. If the tree is
dirty, stop and tell the user what is uncommitted rather than shipping a commit
they think includes it.

### 2. Build the image on the host

```bash
bash scripts/build-on-server.sh        # origin/main; or pass a sha
```

Roughly 3-5 minutes. It tags `:latest` (what compose runs) and `:sha-<sha>`.
If it fails, `:latest` still points at the previous good image — do not deploy.

### 3. Check for schema changes

```bash
git diff --name-only <previously-deployed-sha>..HEAD -- prisma/
```

If anything under `prisma/migrations/` changed, run migrations BEFORE step 4 and
tell the user first — this is not automatic:

```bash
ssh root@188.245.250.151 'cd /opt/glaura/glaura-crm && docker compose run --rm --no-deps web npx prisma migrate deploy'
```

### 4. Deploy

```bash
scp docker-compose.yml root@188.245.250.151:/opt/glaura/glaura-crm/docker-compose.yml
ssh root@188.245.250.151 'set -e
cd /opt/glaura/glaura-crm
docker compose config --quiet
docker compose up -d --pull never'
```

`up -d` recreates only what actually changed, and `config --quiet` fails fast on
a malformed file instead of half-rolling the stack.

### 5. Seed system email templates

```bash
ssh root@188.245.250.151 'cd /opt/glaura/glaura-crm && docker compose run --rm --no-deps web npm run seed:system-email-templates'
```

Publishes any bundled email template (welcome, pro preview/activation,
booking-refund, …) that is missing from /modeles. Idempotent and
create-if-missing: a row the team already edited in /modeles is never
overwritten (that requires an explicit `-- --force`, which you should not run
during a routine deploy). Safe and cheap on every deploy — skipping it is what
leaves a new template's emails silently unsendable.

### 6. Verify

```bash
ssh root@188.245.250.151 'sleep 25
cd /opt/glaura/glaura-crm
docker compose ps --format "{{.Name}}\t{{.Status}}"
echo "--- http"; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3102/login
docker compose logs --tail 8 onboarding-worker email-worker'
```

Expect three containers `Up`, web `(healthy)`, `/login` returning `200`, and
both workers logging `polling every 60s`. `Restarting` means it is failing to
boot — read the logs before touching anything else.

Report the deployed commit sha and the verification output. Do not claim a
feature works because containers are up — say what you actually checked.

## Rollback

`:latest` is overwritten by each build, so roll back to a previous `:sha-<sha>` tag. Find the
previous image and pin it for one boot:

```bash
ssh root@188.245.250.151 'docker images ghcr.io/glaura-ai/glaura-crm --format "{{.ID}}\t{{.Tag}}\t{{.CreatedAt}}"
cd /opt/glaura/glaura-crm
CRM_IMAGE=ghcr.io/glaura-ai/glaura-crm:sha-<previous sha> docker compose up -d --pull never'
```

`CRM_IMAGE` is a one-boot override — it is not persisted, so the next deploy
returns the stack to `:latest`. Treat it as a way to stop the bleeding, then fix
forward properly with `git revert` + push + deploy, which records the rollback
in history and survives the next deploy.

## Notes

- Deploying is user-authorized per-request. Ask before deploying if the user did
  not explicitly ask for it in this turn.
- Recreating drops the containers for a few seconds — crm.glaura.ai returns 502
  during the gap. Fine for an internal tool, but say so if a rep is mid-demo.
- In-flight onboarding jobs die with the worker. A killed job stays `PROCESSING`
  and will not self-heal; check before deploying:
  `ssh root@188.245.250.151 $'echo "SELECT id, status FROM \\"OnboardingJob\\" WHERE status IN (\'QUEUED\',\'PROCESSING\');" | su postgres -c "psql -d glaura_crm -f -"'`
- The config that is easy to lose and expensive to omit now lives in
  `docker-compose.yml` with comments explaining why: the onboarding worker's
  `user: root` + `firebase-adminsdk.json` bind mount, `network_mode: host`, and
  the pinned `container_name`s that glaura-alloy scrapes by.
