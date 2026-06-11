#!/usr/bin/env bash
# Headless salon onboarding runner.
#
# Local usage (uses your existing `claude` subscription login + gcloud ADC for Firebase):
#   ./run-onboard.sh "<salon-url>" [result-json-path] [crm-hints-json-path]
#
# Proves the end-to-end scrape -> create-DISABLED-account pipeline for one salon.
# Trigger (Airtable/Notifai) is intentionally NOT wired here yet.

set -euo pipefail

URL="${1:-}"
RESULT="${2:-/tmp/onboard-result.json}"
HINTS="${3:-}"

if [[ -z "$URL" ]]; then
  echo "usage: $0 <salon-url> [result-json-path] [crm-hints-json-path]" >&2
  exit 2
fi

# Run from this script's dir (glaura-crm/onboarding), which holds .claude/commands
# so `claude` discovers the /onboard-* slash commands.
cd "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNNER_DIR="$(pwd)"

# --- Onboarding-specific env (IG_COOKIES, etc.). The CRM spawns us with its own
#     process env, which does NOT include these, so load them here explicitly.
#     Secrets live OUTSIDE the repo; default to the deploy root two levels up
#     (…/glaura/.env.onboard). Override with ONBOARD_ENV_FILE. ---
ENV_ONBOARD="${ONBOARD_ENV_FILE:-$(cd "$(pwd)/../.." 2>/dev/null && pwd)/.env.onboard}"
if [[ -f "$ENV_ONBOARD" ]]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_ONBOARD"
  set +a
fi

# --- Auth: force the Claude SUBSCRIPTION, never pay-per-token ---
# If ANTHROPIC_API_KEY is set it takes precedence and bills the API. Drop it.
unset ANTHROPIC_API_KEY
# On the VPS (later) instead of an interactive login:
#   export CLAUDE_CODE_OAUTH_TOKEN="<from `claude setup-token`>"
#   export GOOGLE_APPLICATION_CREDENTIALS="/path/to/beauty-984c8-sa.json"

# --- Instagram auth for reel pulls: load the salon-research IG session cookies
#     into the browser so reel pages aren't bounced to the login wall. ---
STORAGE_STATE=""
if [[ -n "${IG_COOKIES:-}" && -f "${IG_COOKIES}" ]]; then
  STORAGE_STATE="$(mktemp -t ig-storage-XXXX.json)"
  if node "$(pwd)/../scripts/ig-cookies-to-storage-state.mjs" "$IG_COOKIES" "$STORAGE_STATE"; then
    echo ">> instagram session loaded for reel pulls"
  else
    echo ">> WARN: could not build instagram storage state — reels will be skipped" >&2
    rm -f "$STORAGE_STATE"
    STORAGE_STATE=""
  fi
fi

# --- Playwright MCP (headless), passed explicitly so we don't depend on kit settings ---
MCP_CONFIG="$(mktemp -t mcp-playwright-XXXX.json)"
PW_ARGS='["-y", "@playwright/mcp@latest", "--headless"]'
if [[ -n "$STORAGE_STATE" ]]; then
  # --isolated is REQUIRED for --storage-state to be applied (otherwise the MCP
  # uses a persistent, logged-out profile and ignores the cookies).
  PW_ARGS="[\"-y\", \"@playwright/mcp@latest\", \"--headless\", \"--isolated\", \"--storage-state\", \"$STORAGE_STATE\"]"
fi
cat > "$MCP_CONFIG" <<JSON
{
  "mcpServers": {
    "playwright": {
      "type": "stdio",
      "command": "npx",
      "args": $PW_ARGS
    }
  }
}
JSON
trap 'rm -f "$MCP_CONFIG" "$STORAGE_STATE"' EXIT

rm -f "$RESULT"

echo ">> onboarding: $URL"
echo ">> result file: $RESULT"
if [[ -n "$HINTS" ]]; then
  echo ">> hints file: $HINTS"
fi

PROMPT="/onboard-headless $URL $RESULT"
if [[ -n "$HINTS" ]]; then
  PROMPT="$PROMPT $HINTS"
fi

claude -p "$PROMPT" \
  --model sonnet \
  --mcp-config "$MCP_CONFIG" \
  --strict-mcp-config \
  --permission-mode dontAsk \
  --allowedTools "Bash,Read,Write,Edit,Glob,Grep,WebFetch,mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_click,mcp__playwright__browser_evaluate,mcp__playwright__browser_take_screenshot,mcp__playwright__browser_run_code,mcp__playwright__browser_wait_for,mcp__playwright__browser_type,mcp__playwright__browser_press_key" \
  --output-format stream-json --verbose

echo ""
if [[ -f "$RESULT" ]]; then
  # --- Completeness guardrail: annotate the result with any missing profile
  #     fields (hours, location, services…) so an incomplete-but-"success" run
  #     is surfaced in the CRM warnings instead of passing as fully prepared.
  #     Runs from goglow-firebase/functions so firebase-admin resolves. ---
  OWNER_ID="$(node -e "try{process.stdout.write(String((require('$RESULT').ownerId)||''))}catch(e){}" 2>/dev/null || true)"
  FUNCTIONS_DIR="$RUNNER_DIR/../../goglow-firebase/functions"
  if [[ -n "$OWNER_ID" && -d "$FUNCTIONS_DIR" ]]; then
    ( cd "$FUNCTIONS_DIR" && node "$RUNNER_DIR/scripts/validate-profile.mjs" "$OWNER_ID" "$RESULT" ) || true
  fi

  echo "===== RESULT ($RESULT) ====="
  cat "$RESULT"
  echo ""
  STATUS="$(node -e "process.stdout.write((require('$RESULT').status)||'')" 2>/dev/null || echo "")"
  [[ "$STATUS" == "success" || "$STATUS" == "already_onboarded" ]] && exit 0
  exit 1
else
  echo "ERROR: no result file written at $RESULT — run failed before completion." >&2
  exit 1
fi
