#!/bin/sh
# Research OS.app launcher, installed as Contents/MacOS/ResearchOS by scripts/build_mac_app.py (ADR-264).
# Already answering -> open the browser. Otherwise start API + worker detached through the app's scripts/start.sh
# (data: ~/Library/Application Support/ResearchOS, logs: ~/Library/Logs/ResearchOS), wait for the health URL,
# show the first-run setup token once (also copied), open the browser. Errors: a dialog + launcher.log.
# RESEARCHOS_HEADLESS=1 (CI smoke): no dialog, no browser. macOS NOT RUN on the dev box (Linux); the CI smoke
# runs it on a macos-15 runner.
CONTENTS="$(cd "$(dirname "$0")/.." && pwd -P)"
export RESEARCHOS_DATA_DIR="$HOME/Library/Application Support/ResearchOS"
export RESEARCHOS_LOG_DIR="$HOME/Library/Logs/ResearchOS"
export RESEARCHOS_PYTHON="$CONTENTS/Resources/python/bin/python3"
export PYTHONDONTWRITEBYTECODE=1  # the bundle is signed; bytecode is compiled at build time
URL="http://127.0.0.1:8443/"
LOG="$RESEARCHOS_LOG_DIR/launcher.log"
mkdir -p "$RESEARCHOS_DATA_DIR" "$RESEARCHOS_LOG_DIR"

log() { printf '%s %s\n' "$(date '+%Y-%m-%dT%H:%M:%S')" "$1" >> "$LOG"; }
say() { [ -n "${RESEARCHOS_HEADLESS:-}" ] || osascript -e "display dialog \"$1\" with title \"Research OS\" buttons {\"OK\"} default button 1" >/dev/null 2>&1; }
fail() { log "ERROR: $1"; say "Research OS could not start: $1. Log: $LOG"; exit 1; }
up() { curl -fsS -m 3 -o /dev/null "${URL}api/v1/health"; }

if ! up; then
  log "starting server for $URL"
  [ -x "$RESEARCHOS_PYTHON" ] || fail "Python not found at $RESEARCHOS_PYTHON; reinstall Research OS"
  "$CONTENTS/Resources/app/scripts/start.sh" >> "$LOG" 2>&1 || fail "the server did not start"
  n=0
  until up; do
    n=$((n + 1)); [ "$n" -gt 120 ] && fail "the server did not answer at $URL within 90 s"
    sleep 0.75
  done
fi
TOKEN_FILE="$RESEARCHOS_DATA_DIR/config/setup-token.txt"
if [ -f "$TOKEN_FILE" ]; then
  TOKEN="$(tr -d '[:space:]' < "$TOKEN_FILE")"
  printf '%s' "$TOKEN" | pbcopy 2>/dev/null
  say "First start: create your account in the browser with this one-time setup token (already copied): $TOKEN
首次启动：请在浏览器中用这个一次性设置口令创建账号（已复制）。"
fi
log "opening $URL"
[ -n "${RESEARCHOS_HEADLESS:-}" ] || open "$URL"
