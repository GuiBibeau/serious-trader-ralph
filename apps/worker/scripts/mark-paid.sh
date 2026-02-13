#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="dev"
PLAN_ID="byok_annual"
YEARS="1"
USER_ID=""
PRIVY_USER_ID=""
EMAIL=""
SOURCE="manual_override"

usage() {
  cat <<'EOF'
Mark a user as paid (active annual subscription) in a chosen Cloudflare env.

Usage:
  ./scripts/mark-paid.sh --env <dev|staging|production> [user selector] [options]

User selector (provide one):
  --user-id <id>               Internal users.id
  --privy-user-id <id>         users.privy_user_id
  --email <email>              Best-effort lookup via users.profile.email

Options:
  --plan <byok_annual|hobbyist_annual>   Default: byok_annual
  --years <n>                             Default: 1
  --source <text>                         Default: manual_override

Examples:
  ./scripts/mark-paid.sh --env staging --privy-user-id did:privy:abc --plan hobbyist_annual
  ./scripts/mark-paid.sh --env production --user-id 123e4567
EOF
}

escape_sql() {
  # Escape single quotes for sqlite string literals.
  printf "%s" "$1" | sed "s/'/''/g"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)
      ENVIRONMENT="${2:-}"
      shift 2
      ;;
    --plan)
      PLAN_ID="${2:-}"
      shift 2
      ;;
    --years)
      YEARS="${2:-}"
      shift 2
      ;;
    --source)
      SOURCE="${2:-}"
      shift 2
      ;;
    --user-id)
      USER_ID="${2:-}"
      shift 2
      ;;
    --privy-user-id)
      PRIVY_USER_ID="${2:-}"
      shift 2
      ;;
    --email)
      EMAIL="${2:-}"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown arg: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "production" ]]; then
  echo "Invalid --env '$ENVIRONMENT'. Use dev|staging|production." >&2
  exit 1
fi

if [[ "$PLAN_ID" != "byok_annual" && "$PLAN_ID" != "hobbyist_annual" ]]; then
  echo "Invalid --plan '$PLAN_ID'. Use byok_annual|hobbyist_annual." >&2
  exit 1
fi

if ! [[ "$YEARS" =~ ^[0-9]+$ ]]; then
  echo "--years must be a positive integer." >&2
  exit 1
fi

if [[ -z "$USER_ID" && -z "$PRIVY_USER_ID" && -z "$EMAIL" ]]; then
  echo "Provide one selector: --user-id, --privy-user-id, or --email." >&2
  exit 1
fi

if [[ -n "$USER_ID" ]]; then
  SELECTOR_SQL="'$(escape_sql "$USER_ID")'"
elif [[ -n "$PRIVY_USER_ID" ]]; then
  PUID_ESCAPED="$(escape_sql "$PRIVY_USER_ID")"
  SELECTOR_SQL="(SELECT id FROM users WHERE privy_user_id = '$PUID_ESCAPED' LIMIT 1)"
else
  EMAIL_LOWER="$(printf "%s" "$EMAIL" | tr '[:upper:]' '[:lower:]')"
  EMAIL_ESCAPED="$(escape_sql "$EMAIL_LOWER")"
  SELECTOR_SQL="(
    SELECT id
    FROM users
    WHERE lower(json_extract(profile, '$.email')) = '$EMAIL_ESCAPED'
    LIMIT 1
  )"
fi

SOURCE_ESCAPED="$(escape_sql "$SOURCE")"
PLAN_ESCAPED="$(escape_sql "$PLAN_ID")"

SQL="
INSERT INTO subscriptions (
  user_id,
  plan_id,
  status,
  starts_at,
  expires_at,
  source_signature,
  updated_at
)
SELECT
  resolved.user_id,
  '$PLAN_ESCAPED',
  'active',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+$YEARS year'),
  '$SOURCE_ESCAPED',
  strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT $SELECTOR_SQL AS user_id
) AS resolved
WHERE resolved.user_id IS NOT NULL
ON CONFLICT(user_id) DO UPDATE SET
  plan_id = excluded.plan_id,
  status = 'active',
  starts_at = excluded.starts_at,
  expires_at = excluded.expires_at,
  source_signature = excluded.source_signature,
  updated_at = datetime('now');
"

WRANGLER_ENV_ARGS=()
if [[ "$ENVIRONMENT" != "dev" ]]; then
  WRANGLER_ENV_ARGS+=(--env "$ENVIRONMENT")
fi

echo "Applying paid override: env=$ENVIRONMENT plan=$PLAN_ID years=$YEARS"

npx wrangler d1 execute WAITLIST_DB \
  "${WRANGLER_ENV_ARGS[@]}" \
  --remote \
  --command "$SQL"

echo "Done."
echo "If no rows changed, verify the selector exists in users table."
