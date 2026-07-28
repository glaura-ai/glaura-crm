---
name: deploy-crm
description: Deploy glaura-crm to the VPS — wait for the GitHub Actions image build, pull ghcr.io/glaura-ai/glaura-crm:latest, recreate the web + onboarding-worker + email-worker containers, and verify. Use when asked to deploy the CRM, ship it, push it live, or release the current main.
---

# Deploy glaura-crm

Deploys whatever is on `main` to https://crm.glaura.ai. There is no compose file
and no deploy script on the server — the three containers are plain `docker run`
processes, so deploying means pull + recreate with the exact flags below.

## Facts about the target

- VPS: `ssh root@204.168.167.79`, app checkout at `/opt/glaura/glaura-crm`
- Image: `ghcr.io/glaura-ai/glaura-crm:latest`, built by `.github/workflows/build-image.yml` on every push to `main`
- Env file for all three containers: `/opt/glaura/glaura-crm/.env.docker` (NOT `.env`, which is the older 26-key file)
- Postgres `glaura_crm` runs on the VPS **host**, not in Docker. Containers use `--network host`
- Web listens on `PORT=3102`

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
`in_progress`, wait for it:

```bash
gh run watch <databaseId> --exit-status
```

The build takes roughly 2-4 minutes. Never deploy on a `failure` conclusion —
`:latest` still points at the previous good image, so a pull would silently
"succeed" while deploying nothing new.

### 3. Check for schema changes

```bash
git diff --name-only <previously-deployed-sha>..HEAD -- prisma/
```

If anything under `prisma/migrations/` changed, run migrations BEFORE recreating
the containers, and tell the user first — this one is not automatic:

```bash
ssh root@204.168.167.79 'cd /opt/glaura/glaura-crm && docker run --rm --network host \
  --env-file /opt/glaura/glaura-crm/.env.docker \
  ghcr.io/glaura-ai/glaura-crm:latest npx prisma migrate deploy'
```

### 4. Pull and recreate

```bash
ssh root@204.168.167.79 'set -e
docker pull ghcr.io/glaura-ai/glaura-crm:latest

docker rm -f glaura-crm-web glaura-crm-onboarding-worker glaura-crm-email-worker

docker run -d --name glaura-crm-web --restart unless-stopped --network host \
  --env-file /opt/glaura/glaura-crm/.env.docker \
  ghcr.io/glaura-ai/glaura-crm:latest node server.js

docker run -d --name glaura-crm-onboarding-worker --restart unless-stopped --network host --user root \
  --env-file /opt/glaura/glaura-crm/.env.docker \
  -v /opt/glaura/secrets/firebase-adminsdk.json:/opt/glaura/secrets/firebase-adminsdk.json:ro \
  ghcr.io/glaura-ai/glaura-crm:latest npm run onboard:worker

docker run -d --name glaura-crm-email-worker --restart unless-stopped --network host \
  --env-file /opt/glaura/glaura-crm/.env.docker \
  ghcr.io/glaura-ai/glaura-crm:latest npm run email:worker
'
```

Flags that are load-bearing, all recovered from the running containers — do not
drop them when editing this recipe:

- **onboarding-worker only**: `--user root` (Playwright needs it) and the
  read-only bind mount of `firebase-adminsdk.json`, which is what
  `GOOGLE_APPLICATION_CREDENTIALS` in the env file points at. Without the mount
  every account write fails at Firebase auth.
- **web** runs as the image's default `nextjs` user — do not add `--user root`.

### 5. Verify

```bash
ssh root@204.168.167.79 'docker ps --filter name=glaura-crm --format "{{.Names}}\t{{.Status}}\t{{.Image}}"
echo "--- web"; docker logs --tail 15 glaura-crm-web
echo "--- onboarding"; docker logs --tail 15 glaura-crm-onboarding-worker
echo "--- email"; docker logs --tail 15 glaura-crm-email-worker
echo "--- http"; curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3102/login'
```

Expect three containers `Up`, `/login` returning `200`, and no crash loop
(`Restarting` in the status column means it is failing to boot — read the logs
before touching anything else).

Report the deployed commit sha and the verification output. Do not claim the
feature works because containers are up — say what you actually checked.

## Rollback

`:latest` is overwritten by each build, so roll back by digest. List what is on
the host and re-run the step 4 commands against the previous image id:

```bash
ssh root@204.168.167.79 'docker images ghcr.io/glaura-ai/glaura-crm --format "{{.ID}}\t{{.Tag}}\t{{.CreatedAt}}"'
```

Faster alternative when the bad commit is known: `git revert`, push, and deploy
again — one build cycle, and the rollback is recorded in history.

## Notes

- Deploying is user-authorized per-request. Ask before deploying if the user did
  not explicitly ask for it in this turn.
- `docker rm -f` drops the three containers for a few seconds — crm.glaura.ai
  returns 502 during the gap. It is an internal sales tool, so this is normally
  fine, but say so if a rep is mid-demo.
- In-flight onboarding jobs die with the worker. A killed job stays `PROCESSING`
  and will not self-heal; check for one before deploying:
  `su postgres -c "psql -d glaura_crm -c \"SELECT id, status FROM \\\"OnboardingJob\\\" WHERE status IN ('QUEUED','PROCESSING');\""`
