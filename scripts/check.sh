#!/usr/bin/env sh
# All quality gates (ARCHITECTURE §3). Run before every commit. Exit non-zero on any failure.
set -e
cd "$(dirname "$0")/.."
PY=.venv/bin
if command -v uv >/dev/null 2>&1; then  # a venv that drifted from uv.lock fails here, not as obscure test errors
  echo "== venv matches uv.lock =="; uv sync --inexact --extra dev --extra experiments --extra plugins --frozen --check -q
fi
echo "== ruff ==";          $PY/ruff check services/api workers tests scripts
echo "== mypy ==";          $PY/mypy
echo "== import-linter =="; $PY/lint-imports
echo "== arch health ==";   $PY/python scripts/arch_health.py "$@"
if [ -d scripts/public ]; then  # maintainer tooling; the public export itself never contains scripts/public/
  echo "== public export: tooling tests + leak scan of an export built from this tree (ADR-226) =="
  $PY/python -m pytest -q -p no:warnings -o addopts="" scripts/public/tests
  $PY/python scripts/public/scan.py --export-from .
fi
if [ -n "$PWSH" ]; then
  echo "== powershell parse + analyzer =="
  $PWSH -NoProfile -File scripts/check_ps1.ps1
  $PWSH -NoProfile -c 'if (Get-Module -ListAvailable PSScriptAnalyzer) { $r = Get-ChildItem scripts,packaging -Filter *.ps1 | % { Invoke-ScriptAnalyzer -Path $_.FullName -Settings scripts/PSScriptAnalyzerSettings.psd1 -Severity Error,Warning }; if ($r) { $r | ft -AutoSize | Out-String -Width 200; exit 1 } else { "PSScriptAnalyzer: clean" } }'
fi
if command -v makensis >/dev/null 2>&1; then
  echo "== NSIS setup compiles (warnings fail) =="
  NSI_TMP=$(mktemp -d); mkdir -p "$NSI_TMP/app/scripts" "$NSI_TMP/py" "$NSI_TMP/wh"
  cp scripts/researchos.ico "$NSI_TMP/app/scripts/"; touch "$NSI_TMP/py/python.exe" "$NSI_TMP/wh/install.txt"
  makensis -V2 -WX -DVERSION=0.0.0 -DAPPDIR="$NSI_TMP/app" -DPYDIR="$NSI_TMP/py" -DWHEELDIR="$NSI_TMP/wh" \
    -DPIPWHEEL=pip.whl -DOUTFILE="$NSI_TMP/ResearchOS-Setup-gate.exe" \
    packaging/windows/ResearchOS-Setup.nsi   # a plain command, so `set -e` stops on failure
  echo "makensis: ok"; rm -rf "$NSI_TMP"
fi
echo "== reference plugin (offline conformance) =="
$PY/ruff check examples
$PY/mypy --strict --python-executable $PY/python examples/plugin_hello/src >/dev/null && echo "mypy --strict: ok"
PYTHONPATH=examples/plugin_hello/src $PY/python -m pytest -q -p no:warnings -o addopts="" examples/plugin_hello/tests
echo "== merged plugins (plugins/*: own ruff/mypy --strict config, offline tests) =="
for d in plugins/*/; do
  (cd "$d" && ../../$PY/ruff check -q . && ../../$PY/ruff format --check -q . && ../../$PY/mypy src >/dev/null \
     && echo "$d: ruff + mypy --strict ok" && ../../$PY/python -m pytest -q -p no:warnings -o addopts="" tests)
done
echo "== pytest ==";        $PY/python -m pytest -q -p no:warnings
if [ -d apps/web/node_modules ]; then
  echo "== web lint/typecheck/test/build =="
  (cd apps/web && pnpm run -s lint && pnpm run -s typecheck && pnpm run -s test && pnpm run -s build)
  echo "== mind-ledger extension (node --test, jsdom from apps/web) =="
  node --test apps/extension/test/*.test.mjs
fi
echo "ALL GATES PASSED"
