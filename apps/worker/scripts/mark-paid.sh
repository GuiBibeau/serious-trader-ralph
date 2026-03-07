#!/usr/bin/env bash
set -euo pipefail

ENVIRONMENT="dev"
PLAN_ID="manual_access"
YEARS="1"
USER_ID=""
PRIVY_USER_ID=""
EMAIL=""
SOURCE="manual_onboarding"

usage() {
  cat <<'USAGE'
Grant manual access in a chosen Cloudflare environment.

Usage:
  ./scripts/mark-paid.sh --env <dev|production> [user selector] [options]

User selector (provide one):
  --user-id <id>               Internal users.id
  --privy-user-id <id>         users.privy_user_id (creates user if missing)
  --email <email>              Best-effort lookup via users.profile.email

Options:
  --plan <id>                  Default: manual_access
  --years <n>                  Default: 1
  --source <text>              Default: manual_onboarding

Examples:
  ./scripts/mark-paid.sh --env dev --privy-user-id did:privy:abc
  ./scripts/mark-paid.sh --env production --user-id 123e4567 --years 2
USAGE
}

escape_sql() {
  printf "%s" "$1" | sed "s/'/''/g"
}

normalize_privy_id() {
  local raw="$1"
  if [[ "$raw" == did:privy:* ]]; then
    printf "%s" "$raw"
    return
  fi
  printf "did:privy:%s" "$raw"
}

strip_privy_prefix() {
  local raw="$1"
  printf "%s" "$raw" | sed 's/^did:privy://'
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

if [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "production" ]]; then
  echo "Invalid --env '$ENVIRONMENT'. Use dev|production." >&2
  exit 1
fi

if [[ -z "$PLAN_ID" ]]; then
  echo "--plan cannot be empty." >&2
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

BOOTSTRAP_USER_SQL=""
if [[ -n "$USER_ID" ]]; then
  SELECTOR_SQL="'$(escape_sql "$USER_ID")'"
elif [[ -n "$PRIVY_USER_ID" ]]; then
  PRIVY_RAW="$(printf "%s" "$PRIVY_USER_ID" | xargs)"
  PRIVY_NORMALIZED="$(normalize_privy_id "$PRIVY_RAW")"
  PRIVY_FALLBACK="$(strip_privy_prefix "$PRIVY_RAW")"

  RAW_ESCAPED="$(escape_sql "$PRIVY_RAW")"
  NORMALIZED_ESCAPED="$(escape_sql "$PRIVY_NORMALIZED")"
  FALLBACK_ESCAPED="$(escape_sql "$PRIVY_FALLBACK")"

  BOOTSTRAP_USER_SQL="
  INSERT INTO users (id, privy_user_id)
  SELECT lower(hex(randomblob(16))), '$NORMALIZED_ESCAPED'
  WHERE NOT EXISTS (
    SELECT 1
    FROM users
    WHERE privy_user_id IN ('$RAW_ESCAPED', '$NORMALIZED_ESCAPED', '$FALLBACK_ESCAPED')
  );
  "

  SELECTOR_SQL="(
    SELECT id
    FROM users
    WHERE privy_user_id IN ('$RAW_ESCAPED', '$NORMALIZED_ESCAPED', '$FALLBACK_ESCAPED')
    ORDER BY CASE
      WHEN privy_user_id = '$NORMALIZED_ESCAPED' THEN 0
      WHEN privy_user_id = '$RAW_ESCAPED' THEN 1
      ELSE 2
    END
    LIMIT 1
  )"
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
$BOOTSTRAP_USER_SQL

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

UPDATE users
SET onboarding_status = 'active'
WHERE id IN (
  SELECT $SELECTOR_SQL AS user_id
);
"

WRANGLER_ENV_ARGS=()
if [[ "$ENVIRONMENT" != "dev" ]]; then
  WRANGLER_ENV_ARGS+=(--env "$ENVIRONMENT")
fi

echo "Applying manual access override: env=$ENVIRONMENT plan=$PLAN_ID years=$YEARS"

npx wrangler d1 execute WAITLIST_DB \
  "${WRANGLER_ENV_ARGS[@]}" \
  --remote \
  --command "$SQL"

echo "Done."
echo "If no rows changed, verify the selector exists (or provide --privy-user-id)."
