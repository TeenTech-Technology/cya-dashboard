#!/usr/bin/env bash
# Sets up the CYA events database on Supabase and connects the dashboard.
# Needs: SUPABASE_CYA_TOKEN (a Supabase personal access token), curl, jq, openssl.
# Optional: SUPABASE_ORG_ID (else the first org the token can see), REGION (default eu-west-1;
#           Supabase has no African region, Ireland/Frankfurt are the closest to Zambia).
# Never prints the token, the DB password or the admin password.
set -euo pipefail

: "${SUPABASE_CYA_TOKEN:?Set SUPABASE_CYA_TOKEN first}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
API="https://api.supabase.com/v1"
NAME="${PROJECT_NAME:-cya-events}"
REGION="${REGION:-eu-west-1}"
ADMIN_EMAIL="${ADMIN_EMAIL:-infocya260@gmail.com}"
SECRETS_DIR="${SECRETS_DIR:-/workspace/cya}"
PW_FILE="$SECRETS_DIR/cya_admin_password.txt"
DBPW_FILE="$SECRETS_DIR/cya_db_password.txt"
umask 077; mkdir -p "$SECRETS_DIR"

api() { # method path [json]
  local m="$1" p="$2" d="${3:-}"
  if [ -n "$d" ]; then
    curl -fsS -X "$m" "$API$p" -H "Authorization: Bearer $SUPABASE_CYA_TOKEN" -H "Content-Type: application/json" --data "$d"
  else
    curl -fsS -X "$m" "$API$p" -H "Authorization: Bearer $SUPABASE_CYA_TOKEN"
  fi
}
sql() { api POST "/projects/$REF/database/query" "$(jq -n --arg q "$1" '{query:$q}')" >/dev/null; }

# 1. Project (reuse if it already exists)
REF="$(api GET /projects | jq -r --arg n "$NAME" '.[] | select(.name==$n) | .id' | head -n1)"
if [ -z "$REF" ]; then
  ORG="${SUPABASE_ORG_ID:-$(api GET /organizations | jq -r '.[0].id')}"
  [ -n "$ORG" ] && [ "$ORG" != "null" ] || { echo "No Supabase organization found for this token." >&2; exit 1; }
  DBPW="$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 28)"
  printf '%s\n' "$DBPW" > "$DBPW_FILE"; chmod 600 "$DBPW_FILE"
  echo "Creating project '$NAME' in $REGION (free plan)..."
  REF="$(api POST /projects "$(jq -n --arg n "$NAME" --arg o "$ORG" --arg p "$DBPW" --arg r "$REGION" \
        '{name:$n, organization_id:$o, db_pass:$p, region:$r, plan:"free"}')" | jq -r .id)"
  unset DBPW
else
  echo "Reusing existing project '$NAME' ($REF)."
fi

echo -n "Waiting for project to be ready"
for i in $(seq 1 90); do
  S="$(api GET "/projects/$REF" | jq -r .status)"
  [ "$S" = "ACTIVE_HEALTHY" ] && break
  echo -n "."; sleep 10
done; echo " $S"
[ "$S" = "ACTIVE_HEALTHY" ] || { echo "Project not ready yet; re-run this script in a few minutes." >&2; exit 1; }

URL="https://$REF.supabase.co"
KEYS="$(api GET "/projects/$REF/api-keys?reveal=true")"
ANON="$(jq -r '.[] | select(.name=="anon") | .api_key' <<<"$KEYS")"
SERVICE="$(jq -r '.[] | select(.name=="service_role") | .api_key' <<<"$KEYS")"
unset KEYS

# 2. Schema + seed (wait briefly for the DB to accept queries)
echo "Running schema..."
for i in $(seq 1 12); do sql "$(cat "$ROOT/supabase/schema.sql")" && break; sleep 10; done

# 3. Auth: no public signups; site URL = the dashboard
api PATCH "/projects/$REF/config/auth" "$(jq -n '{disable_signup:true, site_url:"https://teentech-technology.github.io/cya-dashboard/", uri_allow_list:"https://teentech-technology.github.io/cya-dashboard/**"}')" >/dev/null
echo "Signups disabled."

# 4. Admin user with a temporary password
case "$ADMIN_EMAIL" in *"'"*) echo "Bad email" >&2; exit 1;; esac
UID_="$(api POST "/projects/$REF/database/query" "$(jq -n --arg q "select id from auth.users where email = '$ADMIN_EMAIL'" '{query:$q}')" | jq -r '.[0].id // empty')"
if [ -z "$UID_" ]; then
  TMPPW="$(openssl rand -base64 18 | tr -dc 'A-Za-z0-9' | head -c 16)"
  UID_="$(curl -fsS -X POST "$URL/auth/v1/admin/users" -H "apikey: $SERVICE" -H "Authorization: Bearer $SERVICE" \
     -H "Content-Type: application/json" \
     --data "$(jq -n --arg e "$ADMIN_EMAIL" --arg p "$TMPPW" '{email:$e,password:$p,email_confirm:true,user_metadata:{must_change_password:true}}')" | jq -r .id)"
  printf 'CYA dashboard: https://teentech-technology.github.io/cya-dashboard/\nEmail: %s\nTemporary password: %s\n' "$ADMIN_EMAIL" "$TMPPW" > "$PW_FILE"
  chmod 600 "$PW_FILE"; unset TMPPW
  echo "Admin user created; temporary password saved to $PW_FILE"
else
  echo "Admin user already exists (password unchanged)."
fi
unset SERVICE
sql "insert into public.admins (user_id, email) values ('$UID_', '$ADMIN_EMAIL') on conflict (user_id) do nothing;"

# 5. Fill config.js (anon key is public by design; RLS protects data)
jq -n --arg u "$URL" --arg k "$ANON" '{SUPABASE_URL:$u, SUPABASE_ANON_KEY:$k, POSTERS_BUCKET:"posters"}' \
 | { printf '/* CYA dashboard settings (filled by scripts/setup.sh). The anon key is public by design; RLS protects data. */\nwindow.CYA_CONFIG = '; cat; printf ';\n'; } > "$ROOT/config.js"
echo "config.js filled for $URL"
echo "Done. Commit and push config.js to publish the connected dashboard."
