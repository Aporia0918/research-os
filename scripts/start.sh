#!/usr/bin/env sh
# Linux / macOS: start API + worker in the background (pid files in $RESEARCHOS_DATA_DIR/run).
# The Mac app's launcher sets RESEARCHOS_PYTHON (the bundled CPython) and RESEARCHOS_LOG_DIR (ADR-264).
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
export RESEARCHOS_DATA_DIR="${RESEARCHOS_DATA_DIR:-$ROOT/data}"
PY="${RESEARCHOS_PYTHON:-.venv/bin/python}"; RUN="$RESEARCHOS_DATA_DIR/run"
LOGS="${RESEARCHOS_LOG_DIR:-$RESEARCHOS_DATA_DIR/logs}"; mkdir -p "$RUN" "$LOGS"
"$PY" -m researchos.app.cli migrate
TOKEN=$("$PY" -m researchos.app.cli setup-token)
nohup "$PY" -m researchos.app.cli serve >> "$LOGS/api.out" 2>&1 & echo $! > "$RUN/api.pid"
sleep 3
nohup "$PY" -m researchos_worker.main >> "$LOGS/worker.out" 2>&1 & echo $! > "$RUN/worker.pid"
echo "Research OS started. Data: $RESEARCHOS_DATA_DIR"
"$PY" -m researchos.app.cli lan-urls | sed 's/^/Candidate LAN URL (needs host + TLS config): /'
case "$TOKEN" in *initialized*) ;; *) echo "First-run setup token: $TOKEN";; esac
