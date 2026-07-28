---
name: deploy-crm
description: Deploy glaura-crm to the VPS — wait for the GitHub Actions image build, then pull ghcr.io/glaura-ai/glaura-crm:latest and roll the compose stack (web + onboarding-worker + email-worker) and verify. Use when asked to deploy the CRM, ship it, push it live, or release the current main.
---

# Deploy glaura-crm

Deploys whatever is on `main` to https://crm.glaura.ai. CI builds the image on
every push to `main`; deploying is pull + `compose up -d`. Nothing is built on
the server.

## Facts about the target

- VPS: `ssh root@204.168.167.79`, stack at `/opt/glaura/glaura-crm`
- Image: `ghcr.io/glaura-ai/glaura-crm:latest`, built by `.github/workflows/build-image.yml`
- Run config: `docker-compose.yml` **in this repo** is the source of truth. Step 4 copies it up, so server-side edits are overwritten — change it here and merge
- Env file: `/opt/glaura/glaura-crm/.env.docker` on the host, NOT in the repo (secrets). Not the older 26-key `.env` sitting next to it
- Postgres `glaura_crm` runs on the VPS **host**, not in Docker — hence `network_mode: host`
- Web listens on `PORT=3102`
- `/opt/glaura/glaura-crm` also holds a stale git checkout (unrelated to deploys, ignore it)

## Steps

### 1. Confirm what you are shipping

```bash
git status --short && git log --oneline -1
gh run list --limit 3 --json databaseId,status,conclusion,headSha,workflowName
```

`main` must be pushed and the working tree clean — the image is built from the
GitHub commit, so uncommitted local work is NOT in the deploy. If the tree is
dirty, stop and tell the user what is uncommitted rather than shipping a commit
they think includes it.

### 2. Wait for the image

Match the run's `headSha` to the commit you are deploying. If it is
`in_progress`:

```bash
gh run watch <databaseId> --exit-status
```

Roughly 2-4 minutes. Never deploy on a `failure` conclusion — `:latest` still
points at the previous good image, so the pull would silently "succeed" while
deploying nothing new.

### 3. Check for schema changes

```bash
git diff --name-only <previously-deployed-sha>..HEAD -- prisma/
```

If anything under `prisma/migrations/` changed, run migrations BEFORE step 4 and
tell the user first — this is not automatic:

```bash
ssh root@204.168.167.79 'cd /opt/glaura/glaura-crm && docker compose run --rm --no-deps web npx prisma migrate deploy'
```

### 4. Deploy

```bash
scp docker-compose.yml root@204.168.167.79:/opt/glaura/glaura-crm/docker-compose.yml
ssh root@204.168.167.79 'set -e
cd /opt/glaura/glaura-crm
docker compose config --quiet
docker compose pull
docker compose up -d'
```

`up -d` recreates only what actually changed, and `config --quiet` fails fast on
a malformed file instead of half-rolling the stack.

### 5. Verify

```bash
ssh root@204.168.167.79 'sleep 25
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

`:latest` is overwritten by each build, so roll back by digest. Find the
previous image and pin it for one boot:

```bash
ssh root@204.168.167.79 'docker images ghcr.io/glaura-ai/glaura-crm --format "{{.ID}}\t{{.Tag}}\t{{.CreatedAt}}"
cd /opt/glaura/glaura-crm
CRM_IMAGE=ghcr.io/glaura-ai/glaura-crm@sha256:<digest> docker compose up -d'
```

That last line only works if `docker-compose.yml` has been parameterised with
`${CRM_IMAGE:-ghcr.io/glaura-ai/glaura-crm:latest}` — as of now it has not, so
the actual rollback is either editing the `image:` line on the server (and
remembering step 4 will overwrite it next deploy) or, preferably, `git revert` +
push + deploy: one build cycle, and the rollback is recorded in history.

## Notes

- Deploying is user-authorized per-request. Ask before deploying if the user did
  not explicitly ask for it in this turn.
- Recreating drops the containers for a few seconds — crm.glaura.ai returns 502
  during the gap. Fine for an internal tool, but say so if a rep is mid-demo.
- In-flight onboarding jobs die with the worker. A killed job stays `PROCESSING`
  and will not self-heal; check before deploying:
  `ssh root@204.168.167.79 $'echo "SELECT id, status FROM \\"OnboardingJob\\" WHERE status IN (\'QUEUED\',\'PROCESSING\');" | su postgres -c "psql -d glaura_crm -f -"'`
- The config that is easy to lose and expensive to omit now lives in
  `docker-compose.yml` with comments explaining why: the onboarding worker's
  `user: root` + `firebase-adminsdk.json` bind mount, `network_mode: host`, and
  the pinned `container_name`s that glaura-alloy scrapes by.
