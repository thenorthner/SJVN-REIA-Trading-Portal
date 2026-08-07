#!/usr/bin/env bash
#
# SJVN REIA & Power Trading Platform — update an already-deployed server
#
# Pulls the latest code, rebuilds, runs the test suite, restarts the service and
# checks it actually came back. If anything fails the checkout is returned to the
# commit it was on and rebuilt, so a bad deploy does not leave the server down.
#
# Run this ON the server, from the repo root:
#
#     ./update.sh
#
# deploy.sh does the install and build; this drives the release around it.
set -uo pipefail

cd "$(dirname "$0")"
ROOT="$(pwd)"

say()  { printf '\n\033[1m==> %s\033[0m\n' "$1"; }
warn() { printf '\033[1;33m !! %s\033[0m\n' "$1" >&2; }
fail() { printf '\n\033[1;31m!! %s\033[0m\n' "$1" >&2; exit 1; }

SERVICE="${SJVN_SERVICE:-sjvn-platform}"
PORT="$(grep -h '^PORT=' backend/.env 2>/dev/null | cut -d= -f2 | tr -d '[:space:]')"
: "${PORT:=4000}"
HEALTH="http://127.0.0.1:${PORT}/api/health"

command -v git >/dev/null || fail "git is not installed."
[ -d .git ] || fail "This is not a git checkout — deploy.sh clones the repo first."

# ── Where we are now, so we can get back here ────────────────────────────
PREVIOUS="$(git rev-parse HEAD)"
say "Currently on $(git rev-parse --short HEAD) — $(git log -1 --pretty=%s)"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  fail "There are uncommitted changes to tracked files. Commit or discard them, then run this again."
fi

# ── Pull ─────────────────────────────────────────────────────────────────
say "Fetching"
git fetch --quiet origin || fail "Could not reach the remote."

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
TARGET="$(git rev-parse "origin/${BRANCH}")"

if [ "$PREVIOUS" = "$TARGET" ]; then
  say "Already up to date — nothing to deploy."
  exit 0
fi

say "Updating to $(git rev-parse --short "$TARGET")"
# Fast-forward only: if the server's history has diverged, stop rather than
# silently rewriting whatever is running.
git merge --ff-only "origin/${BRANCH}" || fail "Cannot fast-forward — the server checkout has diverged from origin/${BRANCH}."

git log --oneline "${PREVIOUS}..${TARGET}" | sed 's/^/    /'

# ── Roll back to the previous commit and rebuild ─────────────────────────
rollback() {
  warn "Rolling back to ${PREVIOUS:0:7}"
  git reset --hard --quiet "$PREVIOUS"
  if ./deploy.sh >/tmp/sjvn-rollback-build.log 2>&1; then
    sudo systemctl restart "$SERVICE" 2>/dev/null || warn "Could not restart ${SERVICE} — start it by hand."
    warn "Rolled back. The failed release is described above; build log: /tmp/sjvn-rollback-build.log"
  else
    fail "Rollback build ALSO failed — see /tmp/sjvn-rollback-build.log. The service may be down."
  fi
  exit 1
}

# ── Build ────────────────────────────────────────────────────────────────
say "Installing and building"
./deploy.sh || { warn "deploy.sh failed."; rollback; }

# ── Test ─────────────────────────────────────────────────────────────────
# Run before restarting, so a release that breaks the engines never reaches the
# running service. The suite uses its own throwaway database.
say "Running the test suite"
( cd backend && npm test ) || { warn "Tests failed — not restarting the service."; rollback; }

# ── Restart ──────────────────────────────────────────────────────────────
say "Restarting ${SERVICE}"
if systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE}.service"; then
  sudo systemctl restart "$SERVICE" || { warn "systemctl restart failed."; rollback; }
else
  warn "No ${SERVICE}.service installed — start the process yourself (cd backend && npm start)."
  say "Code is updated and tested; skipping restart and health check."
  exit 0
fi

# ── Verify it came back ──────────────────────────────────────────────────
say "Waiting for ${HEALTH}"
for i in $(seq 1 30); do
  if curl -fsS --max-time 3 "$HEALTH" >/dev/null 2>&1; then
    say "Healthy after ${i}s"
    printf '\n  Deployed %s → %s\n\n' "${PREVIOUS:0:7}" "$(git rev-parse --short HEAD)"
    exit 0
  fi
  sleep 1
done

warn "Service did not answer ${HEALTH} within 30s."
journalctl -u "$SERVICE" -n 30 --no-pager 2>/dev/null | sed 's/^/    /' || true
rollback
