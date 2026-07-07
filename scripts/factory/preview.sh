#!/bin/zsh
# Print the Vercel preview URL for a PR's head commit (polls until the
# deployment succeeds or ~4 minutes pass).
#
# Usage: scripts/factory/preview.sh <pr-number>

set -u
PR=$1
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_SLUG=$(cd "$REPO_DIR" && gh repo view --json nameWithOwner -q .nameWithOwner)

sha=$(gh pr view $PR --json headRefOid -q .headRefOid)
for i in $(seq 1 12); do
  id=$(gh api "repos/$REPO_SLUG/deployments?sha=$sha&environment=Preview&per_page=1" -q '.[0].id' 2>/dev/null)
  if [[ -n "$id" && "$id" != "null" ]]; then
    read -r state url <<< "$(gh api "repos/$REPO_SLUG/deployments/$id/statuses" -q '.[0] | .state + " " + (.environment_url // "")' 2>/dev/null)"
    if [[ "$state" == "success" && -n "$url" ]]; then echo "$url"; exit 0; fi
    [[ "$state" == "failure" || "$state" == "error" ]] && { echo "preview deployment $state" >&2; exit 1; }
  fi
  sleep 20
done
echo "preview not ready after timeout (sha $sha)" >&2
exit 1
