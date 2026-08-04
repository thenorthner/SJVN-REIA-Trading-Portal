#!/usr/bin/env bash
#
# SJVN REIA & Power Trading Platform — deployment
#
# Builds the front end and starts one Node process that serves both the UI and
# the API, so the platform is reachable on a single address with no reverse
# proxy to configure.
#
# Run this ON the server, from the repo root:
#
#     ./deploy.sh
#
set -euo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$1" >&2; exit 1; }

# ── Prerequisites ────────────────────────────────────────────────────────
command -v node >/dev/null || fail "Node.js is not installed. Install Node 20 or newer, then run this again."
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || fail "Node $NODE_MAJOR is too old — this platform needs Node 18 or newer (20 recommended)."

# ── Secret ───────────────────────────────────────────────────────────────
# The development JWT secret is committed to a public repository, so anyone who
# reads the source could forge an admin token. The server refuses to start in
# production without a real one; generate it here on first run.
ENV_FILE="$ROOT/backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  say "Creating backend/.env"
  cp "$ROOT/backend/.env.example" "$ENV_FILE"
fi

if ! grep -q '^JWT_SECRET=.\+' "$ENV_FILE"; then
  say "Generating a JWT signing secret"
  SECRET="$(node -e 'console.log(require("crypto").randomBytes(32).toString("hex"))')"
  # Replace a commented or empty JWT_SECRET line, or append one.
  if grep -q '^#\? *JWT_SECRET=' "$ENV_FILE"; then
    sed -i.bak "s|^#\? *JWT_SECRET=.*|JWT_SECRET=$SECRET|" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
  else
    printf '\nJWT_SECRET=%s\n' "$SECRET" >> "$ENV_FILE"
  fi
  echo "    written to backend/.env — keep this file off version control"
fi

grep -q '^NODE_ENV=' "$ENV_FILE" || printf 'NODE_ENV=production\n' >> "$ENV_FILE"
grep -q '^PORT=' "$ENV_FILE"     || printf 'PORT=4000\n'            >> "$ENV_FILE"

# ── Install ──────────────────────────────────────────────────────────────
say "Installing backend dependencies"
( cd backend && ( npm ci --omit=dev 2>/dev/null || npm install --omit=dev 2>/dev/null || ( npm install --ignore-scripts && cd node_modules/better-sqlite3 && mkdir -p build/Release/.deps/Release/obj.target/sqlite3/gen/sqlite3/ build/Release/.deps/Release/obj.target/better_sqlite3/src/ && npx node-gyp rebuild ) ) )

say "Installing frontend dependencies"
( cd frontend && npm ci 2>/dev/null || npm install )

# ── Build ────────────────────────────────────────────────────────────────
say "Building the front end"
( cd frontend && npm run build )
[ -f "$ROOT/frontend/dist/index.html" ] || fail "The build produced no dist/index.html — check the output above."

# ── Database ─────────────────────────────────────────────────────────────
# schema.sql runs on every boot and migrations are idempotent, so an existing
# database is upgraded in place rather than replaced. Seeding is deliberately
# NOT automatic: it would overwrite real data on an already-live server.
DB="$ROOT/backend/src/db/platform.db"
if [ ! -f "$DB" ]; then
  say "No database found — seeding a fresh one"
  ( cd backend && npm run seed )
  cat <<'WARN'

    The seed creates demo users that all share the password "password123".
    Change them before anyone else can reach this server:
      - log in as admin@sjvn.in and reset each account, or
      - delete the demo users you do not need.

WARN
else
  say "Existing database kept — schema migrations will apply on start"
fi

# ── Start ────────────────────────────────────────────────────────────────
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
: "${IP:=$(ipconfig getifaddr en0 2>/dev/null || echo 'this-server')}"
PORT="$(grep '^PORT=' "$ENV_FILE" | cut -d= -f2)"

say "Ready"
cat <<EOF

  Start it in the foreground (Ctrl-C to stop):

      cd backend && npm start

  Or keep it running across reboots and logouts:

      sudo cp $ROOT/sjvn-platform.service /etc/systemd/system/
      sudo systemctl daemon-reload
      sudo systemctl enable --now sjvn-platform
      sudo systemctl status sjvn-platform

  Then open:

      http://$IP:$PORT

EOF
