#!/bin/zsh
# Factory merge gate (see CLAUDE.md ship pipeline / factory-ship skill).
#
# Usage: scripts/factory/gate.sh <pr-number> [<pr-number>...]
#
# For each PR in order: poll mergeStateStatus to CLEAN (fail-fast on any
# failing check), merge, delete the remote branch, verify main CI for the
# exact merge commit, verify the production deployment for that sha.
# Between PRs, the next branch is refreshed onto the new main so serialized
# approvals don't strand it at BLOCKED.
#
# Honesty invariants (learned in production — do not weaken):
# - NEVER report success on timeout: the merged flag gates verification.
# - The verification sha comes from `gh pr view --json mergeCommit`, never
#   from ls-remote or the main ref.
# - Local branch deletion is expected to fail (worktrees hold main);
#   only the remote delete matters.

set -u
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_SLUG=$(cd "$REPO_DIR" && gh repo view --json nameWithOwner -q .nameWithOwner)
cd "$REPO_DIR"

gate_one() {
  local PR=$1 merged=0 state checks sha run dep st BRANCH
  BRANCH=$(gh pr view $PR --json headRefName -q .headRefName)
  for i in $(seq 1 60); do
    state=$(gh pr view $PR --json mergeStateStatus,state -q '.mergeStateStatus + " " + .state')
    checks=$(gh pr checks $PR 2>/dev/null | grep -c fail || true)
    if [[ "$checks" != "0" ]]; then echo "$PR CHECK FAILURE"; gh pr checks $PR; return 1; fi
    if [[ "$state" == "CLEAN OPEN" ]]; then
      echo "$PR CLEAN — merging"
      gh pr merge $PR --merge || return 1
      git push origin --delete "$BRANCH" 2>/dev/null || true
      merged=1; break
    fi
    sleep 20
  done
  if [[ "$merged" != "1" ]]; then
    echo "TIMEOUT: $PR never reached CLEAN (last: $state)"
    echo "Hint: BLOCKED + green checks = branch behind main OR unresolved review thread."
    return 1
  fi
  sha=$(gh pr view $PR --json mergeCommit -q '.mergeCommit.oid')
  echo "$PR MERGED, merge commit $sha"
  for i in $(seq 1 90); do
    run=$(gh run list --branch main --commit $sha --json conclusion,status -q '.[0] | .status + ":" + (.conclusion // "")' 2>/dev/null)
    [[ "$run" == "completed:success" ]] && { echo "$PR main CI: success"; break; }
    [[ "$run" == completed:* ]] && { echo "$PR main CI FAILED: $run"; return 1; }
    sleep 20
  done
  for i in $(seq 1 90); do
    dep=$(gh api "repos/$REPO_SLUG/deployments?sha=$sha&per_page=1" -q '.[0].id' 2>/dev/null)
    if [[ -n "$dep" && "$dep" != "null" ]]; then
      st=$(gh api "repos/$REPO_SLUG/deployments/$dep/statuses" -q '.[0].state' 2>/dev/null)
      [[ "$st" == "success" ]] && { echo "$PR production deployment: success"; return 0; }
      [[ "$st" == "failure" || "$st" == "error" ]] && { echo "$PR production deployment: $st"; return 1; }
    fi
    sleep 20
  done
  echo "$PR deployment: timed out"; return 1
}

refresh_branch() {
  local PR=$1 BRANCH
  BRANCH=$(gh pr view $PR --json headRefName -q .headRefName)
  git fetch origin -q
  git checkout -q "$BRANCH" && git merge -q origin/main --no-edit && git push -q origin "$BRANCH" \
    && echo "$PR branch ($BRANCH) refreshed onto main"
}

first=1
for PR in "$@"; do
  if [[ "$first" != "1" ]]; then refresh_branch "$PR" || exit 1; fi
  first=0
  gate_one "$PR" || exit 1
done
echo "ALL MERGED AND DEPLOYED: $*"
