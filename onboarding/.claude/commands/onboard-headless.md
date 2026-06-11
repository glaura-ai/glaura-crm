---
description: Headless onboarding — scrape a salon URL and create a DISABLED Glaura account, no confirmation, write a result JSON file
argument-hint: <url> <result-json-path> [crm-hints-json-path]
allowed-tools: mcp__playwright__browser_navigate, mcp__playwright__browser_snapshot, mcp__playwright__browser_click, mcp__playwright__browser_evaluate, mcp__playwright__browser_run_code, mcp__playwright__browser_take_screenshot, Bash(curl:*,node:*), Read, Write, Glob, Grep, Edit
---

# Headless Salon Onboarding

You are onboarding a salon into Glaura **fully autonomously, with no human in the loop**.

Arguments (`$ARGUMENTS`) are: `<url> <result-json-path> [crm-hints-json-path]`.
- The first token is the salon booking-page URL to scrape.
- The second token is the absolute path where you MUST write the final result JSON.
- The optional third token is a JSON file containing CRM hints gathered before the run.

If the result path is missing, default it to `/tmp/onboard-result.json`.

If the hints path is present and readable, read it before scraping. Treat non-empty
fields as authoritative hints when the booking page does not expose the value. For
Instagram specifically, use `instagram` / `instagramHandle` from hints as the first
handle candidate before deriving handles from the booking URL or salon name.
For location specifically, use `address` plus `lat`/`lng` or
`latitude`/`longitude` from hints as trusted CRM location data when the booking page
does not expose a better source.

## Step 0 — Detect source type and load the procedure

Detect the source from the URL host:
- contains `planity.com` → **planity** → procedure file `.claude/commands/onboard-salon.md`
- contains `treatwell.` → **treatwell** → `.claude/commands/onboard-treatwell.md`
- contains `acuityscheduling.com`, `app.acuityscheduling.com`, or `.as.me` (Acuity vanity domain, e.g. `salon.as.me/schedule/...`) → **acuity** → `.claude/commands/onboard-acuity.md`
- anything else → **generic** → `.claude/commands/onboard-generic.md`

**Read** the matching procedure file. Follow its scraping, image, category-mapping,
skip-rules, and French-description rules **exactly**, EXCEPT where the Headless Policy
below overrides it.

## Headless Policy — these OVERRIDE anything in the referenced procedure

1. **Never ask for confirmation.** Ignore every "Confirmation Policy", "DRY RUN",
   "ask the user", or go/no-go step in the referenced file. Execute all phases through
   the Firestore writes without stopping.

2. **Create the account DISABLED.** Wherever the referenced procedure creates the
   `userProfile` document, force these fields regardless of what the procedure says:
   ```
   enable:    false
   isActive:  false
   available: false
   ```
   Also add CRM trace fields when hints are present:
   ```
   crmSalonId: hints.crmSalonId || null,
   crmOnboardingMode: 'headless',
   crmSourceUrl: inputUrl,
   crmCreatedAt: admin.firestore.FieldValue.serverTimestamp()
   ```
   Everything else (services, agents, images) is created normally. A teammate will flip
   the account live later. NEVER enable the account.

3. **Idempotency and suffix policy (before any write).** CRM onboarding must create a
   new disabled staging account even when the real salon profile already exists.
   Derive the base `companyUserName` slug as the procedure does, then:
   - If CRM hints include `crmSalonId`, first query for an existing CRM-created
     disabled staging profile:
     ```
     db.collection('userProfile')
       .where('crmSalonId','==',hints.crmSalonId)
       .where('crmOnboardingMode','==','headless')
       .where('enable','==',false)
       .limit(1)
       .get()
     ```
     If found, do NOT create anything — write `status: "already_onboarded"` with that
     `ownerId`, then stop.
   - Otherwise reserve the first available suffix by checking both `companyUserName`
     and generated email. If `rimane-aura` exists, try `rimane-aura-1`,
     `rimane-aura-2`, etc. Existing active or non-CRM profiles are **not** blockers;
     they only consume their slug/email. The final generated email must match the
     selected suffix, e.g. `rimane-aura-1@glaura.fr`.

4. **Write the result file as the final action.** After the run finishes (success,
   already_onboarded, or failure), use the `Write` tool to write the result JSON to the
   result path. This is the LAST thing you do. The result file — not your prose — is the
   source of truth.

5. **Instagram reels ARE part of headless onboarding — do not skip them.** If an
   Instagram handle was found (or is derivable from the source), pull a few reels and
   seed them to the new account. This is NOT optional in headless mode. Only skip if no
   IG handle exists, or reels genuinely can't be fetched — record the reason in
   `warnings[]` and continue. Do **not** use SnapInsta or any third-party downloader.

   **The browser is launched already authenticated to Instagram** (the runner loads a
   logged-in session via `--isolated --storage-state` from `IG_COOKIES`). So navigate to
   the profile/reel pages as a logged-in user — they should NOT redirect to the login
   page. If you DO land on `instagram.com/accounts/login` (session expired or not loaded),
   record `Instagram reels skipped: session not authenticated` in `warnings[]` and finish.

   **Step A — collect up to 3 video reels.** Fetch Instagram's web profile endpoint from
   the page context (so session cookies are sent):
   `https://www.instagram.com/api/v1/users/web_profile_info/?username=<handle>` with
   headers `X-IG-App-ID: 936619743392459`, `X-ASBD-ID: 129477`,
   `X-Requested-With: XMLHttpRequest`. From `data.user.edge_owner_to_timeline_media.edges[]`
   take up to 3 nodes with `is_video: true`. For each collect: `instagramVideoId` =
   `node.shortcode`, `caption` = `node.edge_media_to_caption.edges[0].node.text`,
   `thumbnailUrl` = `node.thumbnail_src || node.display_url`, `timestamp` = ISO from
   `node.taken_at_timestamp`, and `videoUrl` = `node.video_url`. If a node has no
   `video_url`, open `https://www.instagram.com/reel/<shortcode>/` and read it from
   `meta[property="og:video"]` or the `"video_url":"…"` field in the page HTML (unescape
   `&`→`&`). Keep only reels with a non-empty `videoUrl`.

   **Step B — seed them to Cloudflare R2.** POST the collected reels to the seed function
   (do NOT use `uploadSalonVideos` — that targets the wrong storage). The function
   downloads each MP4, uploads to R2, runs service detection, and writes `videos/{id}`:
   ```bash
   curl -s -X POST "$ONBOARDING_SEED_URL" \
     -H "Authorization: Bearer $ONBOARDING_SEED_SECRET" \
     -H "Content-Type: application/json" \
     -d '{"uid":"<ownerId>","reels":[{"videoUrl":"…","caption":"…","instagramVideoId":"…","thumbnailUrl":"…","timestamp":"…"}]}'
   ```
   `<ownerId>` is the userProfile id you just created. `ONBOARDING_SEED_URL` and
   `ONBOARDING_SEED_SECRET` are already in the environment. Read `data.synced` from the
   JSON response and set `videoCount` to it. If the whole step fails, write a warning and
   finish the result file — never block onboarding on reels.

6. **Do not block on anything.** If a non-fatal sub-step fails (e.g. a few images or a
   few reels), log it in `warnings[]` and continue. Only abort if scraping yields no
   usable salon data or a Firestore write hard-fails — then write `status: "failed"`
   with `error`.

7. **Location is required work.** Every source procedure must attempt to extract a
   salon location from the page, linked contact pages, footer text, embedded maps, or
   booking metadata. If the source has no usable location, fall back to CRM hints. If
   you have an address but no coordinates, geocode it with the French government API:
   `https://api-adresse.data.gouv.fr/search/?limit=1&q=<encoded address>`.
   When writing `userProfile`, set `address` to the resolved address and set
   `spLocation` to a location object when coordinates are known:
   ```js
   {
     formatted_address: resolvedAddress,
     name: resolvedAddress,
     place_id: '',
     geometry: { location: { lat, lng } },
     latitude: lat,
     longitude: lng,
   }
   ```
   Only use `spLocation: null` when neither scraping, CRM hints, nor api-adresse can
   provide coordinates, and record that in `warnings[]`.

## Result file schema

```json
{
  "status": "success | already_onboarded | failed",
  "ownerId": "<firestore userProfile doc id, or null>",
  "email": "<slug>@glaura.fr, or null",
  "password": "<generated password, or null>",
  "address": "<resolved address, or null>",
  "lat": 0.0,
  "lng": 0.0,
  "serviceCount": 0,
  "agentCount": 0,
  "videoCount": 0,
  "sourceType": "planity | treatwell | acuity | generic",
  "url": "<the input url>",
  "warnings": ["..."],
  "error": "<reason, only when status=failed; otherwise omit or null>"
}
```

## Notes

- Credentials (email + generated password) go in the result file only.
- Keep the disabled-account invariant no matter which procedure you follow.
- Work quietly: minimise narration; the result file carries the outcome.
