#!/usr/bin/env bash
# Stops a deploy that would lose 1.x data or open a page that the 1.x secret kept private.
# Usage: scripts/check-upgrade.sh <flarewatch-state namespace id>. Remove in 4.0.
set -euo pipefail

NAMESPACE_ID="${1:?usage: scripts/check-upgrade.sh <flarewatch-state namespace id>}"

# Output that isn't a JSON array stops the script, so it can't read as "no key" either.
json_array() {
  printf '%s' "$1" | jq -e 'type == "array"' >/dev/null || {
    echo "Unexpected wrangler output: $1" >&2
    return 1
  }
  printf '%s' "$1"
}
kv_keys() {
  local out
  out="$(vp exec --filter worker -- wrangler kv key list --namespace-id "$NAMESPACE_ID" --prefix "$1" --remote)"
  json_array "$out"
}
has_name() {
  printf '%s' "$1" | jq -e --arg name "$2" 'any(.[]; .name == $name)' >/dev/null
}

# Assignments, not inline calls, so a failed lookup stops the script instead of reading as "no key".
MARKER="$(kv_keys imported_to_hub)"
if ! has_name "$MARKER" imported_to_hub; then
  STATE="$(kv_keys state)"
  MAINTENANCES="$(kv_keys maintenances)"
  SIGNALS="$(kv_keys hb:v1:)"
  if has_name "$STATE" state || has_name "$MAINTENANCES" maintenances ||
    [ "$(printf '%s' "$SIGNALS" | jq 'length')" -gt 0 ]; then
    echo "::error::This install still has FlareWatch 1.x data, which 3.0 can't read. Deploy v2.3.1 first, then update. The 3.0.0 entry in CHANGELOG.md shows how."
    exit 1
  fi
fi

ERRORS="$(mktemp)"
trap 'rm -f "$ERRORS"' EXIT
if SECRETS="$(vp exec --filter status-page -- wrangler secret list --name flarewatch --format json 2>"$ERRORS")"; then
  SECRETS="$(json_array "$SECRETS")"
  if has_name "$SECRETS" FLAREWATCH_STATUS_PAGE_BASIC_AUTH; then
    echo "::error::The status page still has the FLAREWATCH_STATUS_PAGE_BASIC_AUTH secret. 3.0 no longer reads it, so the page would turn public. To keep it private, set statusPage.visibility to 'private' in packages/config/src/public.ts. Then delete the secret: vp exec --filter status-page -- wrangler secret delete FLAREWATCH_STATUS_PAGE_BASIC_AUTH --name flarewatch"
    exit 1
  fi
elif ! grep -q 'not found' "$ERRORS"; then
  cat "$ERRORS" >&2
  exit 1
fi
