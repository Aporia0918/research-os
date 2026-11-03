#!/bin/sh
# One-click update helper for the Mac app (ADR-267; the Windows counterpart is apply_update.ps1). The server copies
# this file next to the verified zip and starts it detached (own session). Steps: stop the worker + API (the app's
# stop.sh), wait until the server, API and worker have exited, copy the zip into a private temp dir and check its SHA-256
# against <sha256> (the digest of the signature-verified latest.json, ADR-270; missing or different: nothing is
# unpacked, nothing changed, the current app is started again), unpack that copy with `ditto -x -k` into
# <parent>/.ResearchOS-update-<version>, check the unpacked app's version (Resources/app/pyproject.toml), keep the
# current app as <app>.prev, move the new one in, `open` it and wait until <health url> answers with the new version.
# Healthy: <app>.prev is removed. Any failure before the swap: nothing changed, the current app is started again.
# Not healthy in time: stop it and wait (bounded) until its API and worker have exited, set the new app aside as
# <app>.failed, <app>.prev becomes <app> again, is started and health-checked for its version (ADR-270).
# Exit: 0 updated, 1 nothing changed, 2 rolled back and the previous version answers, 3 needs a look (update.log).
# The data and log dirs live outside the app and are never touched.
# Usage: apply_update.sh <zip> <app> <server pid> <version> <health url> <data dir> <log file> <sha256>
# HEALTH_TIMEOUT_S (default 120) and STOP_TIMEOUT_S (default 60) are for the e2e check. macOS NOT RUN on the dev box; the e2e check runs this script
# on Linux with stand-ins for ditto and open.
set -u
ZIP=$1 APP=$2 SERVER_PID=$3 VERSION=$4 HEALTH_URL=$5 DATA=$6 LOG=$7 SHA256=${8:-}
PARENT=$(dirname "$APP")
STAGE="$PARENT/.ResearchOS-update-$VERSION"
PREV="$APP.prev" FAILED="$APP.failed"
mkdir -p "$(dirname "$LOG")"

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1" >> "$LOG"; }
version_of() { sed -n 's/^version = "\(.*\)"$/\1/p' "$1/Contents/Resources/app/pyproject.toml" 2>/dev/null | head -n 1; }
stop_app() { RESEARCHOS_DATA_DIR="$DATA" sh "$APP/Contents/Resources/app/scripts/stop.sh" >> "$LOG" 2>&1; }
running_version() {  # our own loopback server (self-signed certificate if TLS is on)
  curl -ksS -m 3 "$HEALTH_URL" 2>/dev/null | sed -n 's/.*"version": *"\([^"]*\)".*/\1/p'
}
sha256_of() {  # macOS has shasum; sha256sum is the Linux e2e box's
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 "$1"; else sha256sum "$1"; fi 2>/dev/null | awk '{print $1}'
}
pids_of() { for n in worker api; do cat "$DATA/run/$n.pid" 2>/dev/null; echo; done; }
alive() { for p in "$@"; do kill -0 "$p" 2>/dev/null && printf '%s ' "$p"; done; }
# stop.sh only sends SIGTERM and drops the pid files: remember the pids first, then wait (STOP_TIMEOUT_S, default
# 60) until every one of them has exited. Never SIGKILL: a server killed mid-write could damage the database.
stop_and_wait() {
  pids="$(pids_of) $*"
  stop_app
  t0=$(date +%s)
  while [ -n "$(alive $pids)" ]; do
    if [ $(( $(date +%s) - t0 )) -ge "${STOP_TIMEOUT_S:-60}" ]; then return 1; fi
    sleep 1
  done
  log "API and worker stopped after $(( $(date +%s) - t0 )) s"
}
wait_version() {  # poll the health URL until it answers with version $1 (HEALTH_TIMEOUT_S); sets $seen
  deadline=$(( $(date +%s) + ${HEALTH_TIMEOUT_S:-120} ))
  seen=""
  while [ "$(date +%s)" -lt "$deadline" ]; do
    seen=$(running_version)
    [ "$seen" = "$1" ] && return 0
    sleep 2
  done
  return 1
}
why_not() { if [ -n "$seen" ]; then echo "server answers with version $seen"; else echo "no answer from $HEALTH_URL"; fi; }
PRIV=""
give_up() {
  log "$1; nothing changed, starting the current version again"
  rm -rf "$STAGE" ${PRIV:+"$PRIV"}; open "$APP"; exit 1
}

log "update to $VERSION: $ZIP -> $APP (server pid $SERVER_PID)"
sleep 2  # let the server finish answering the install request
OLD=$(version_of "$APP"); OLD=${OLD:-unknown}
stop_and_wait "$SERVER_PID" || {
  log "still running after ${STOP_TIMEOUT_S:-60} s (pid $(alive $pids)); update not started, nothing changed"; exit 1; }

# the zip is read again only as a private copy whose digest matches the signed feed (ADR-270)
printf '%s' "$SHA256" | grep -Eq '^[0-9a-f]{64}$' || give_up "no valid sha256 for the zip was passed in"
PRIV=$(mktemp -d "${TMPDIR:-/tmp}/researchos-update.XXXXXX") && chmod 700 "$PRIV" || give_up "cannot create a temp dir"
cp "$ZIP" "$PRIV/update.zip" || give_up "cannot copy $ZIP"
GOT_SHA=$(sha256_of "$PRIV/update.zip")
[ "$GOT_SHA" = "$SHA256" ] || give_up "the zip's sha256 is '$GOT_SHA', the signed feed says $SHA256; not unpacked"
rm -rf "$STAGE" && mkdir -p "$STAGE" || give_up "cannot create $STAGE"
ditto -x -k "$PRIV/update.zip" "$STAGE" >> "$LOG" 2>&1 || give_up "unpacking the update failed"
rm -rf "$PRIV"; PRIV=""
NEW="$STAGE/$(basename "$APP")"
GOT=$(version_of "$NEW")
[ "$GOT" = "$VERSION" ] || give_up "the unpacked app has version '$GOT', expected $VERSION"

rm -rf "$PREV"
mv "$APP" "$PREV" || give_up "cannot move the current app aside"
if ! mv "$NEW" "$APP"; then
  mv "$PREV" "$APP" && give_up "cannot move the new app in"
  log "update failed: cannot move the new app in, and cannot move the current app back: it is kept as $PREV, the new one in $STAGE; nothing at $APP, not started. Move $(basename "$PREV") back to $(basename "$APP") by hand."
  exit 3
fi
rm -rf "$STAGE"
open "$APP"

if wait_version "$VERSION"; then
  rm -rf "$PREV"
  log "health check OK: version $VERSION is running"
  exit 0
fi
log "health check failed: $(why_not), expected $VERSION; rolling back to the previous version $OLD"
if ! stop_and_wait; then  # the failed server could still answer health requests for the restored app
  log "rollback not done: the new version is still running after ${STOP_TIMEOUT_S:-60} s (pid $(alive $pids)); it stays in place, the previous version is kept as $(basename "$PREV"). Quit Research OS, then move it back."
  exit 3
fi
rm -rf "$FAILED"
if ! mv "$APP" "$FAILED"; then
  log "rollback failed: cannot move the new app aside; it stays at $APP (not started), the previous version is kept as $PREV. Move them by hand."
  exit 3
fi
if ! mv "$PREV" "$APP"; then
  log "rollback failed: cannot move $(basename "$PREV") back; the previous version is kept as $PREV, the failed one as $FAILED; nothing at $APP, not started. Move $(basename "$PREV") back to $(basename "$APP") by hand."
  exit 3
fi
log "rolled back: previous version restored, the failed one kept as $(basename "$FAILED"). If the new version already migrated the database, the pre-migration backup is in the data dir's backups (researchos-api restore)."
open "$APP"
if wait_version "$OLD"; then
  log "health check after rollback OK: the previous version $OLD is running"
  exit 2
fi
log "health check after rollback failed: $(why_not), expected $OLD; the previous version is in place but does not answer"
exit 3
