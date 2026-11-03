# Operations

Status legend: commands verified on the Linux dev box unless marked **Windows: NOT RUN**.

## Layout
- Code + venv: repo root (Windows install target `D:\AI\ResearchOS\app`, M3 package).
- Data dir (`RESEARCHOS_DATA_DIR`, Windows default `D:\AI\ResearchOS\data`, Linux default `<repo>/data`):
  `raw/ parsed/ db/ runs/ exports/ backups/ config/ cache/ logs/ datasets/ incoming/ home/ run/`.
- Config: `<data>/config/researchos.toml` (any `Settings` field), env `RESEARCHOS_<FIELD>` overrides.
- Provider keys: Settings page (write-only) or `<data>/config/secrets.env`; never in git, logs, frontend.

## Dev setup (Linux)
```
uv sync --inexact --extra dev --extra experiments --extra plugins  # Python 3.11-3.13; --inexact keeps the
                                  # separately installed torch (plain sync uninstalls it); check.sh fails if the
                                  # venv drifts from uv.lock (e.g. optuna missing without `experiments`)
cd apps/web && pnpm install && pnpm run build    # Node >= 20.19 (dev box: 20.19.2), pnpm 10
scripts/check.sh                                  # all quality gates
scripts/start.sh / scripts/stop.sh / scripts/doctor.sh
```

## Windows (scripts provided; **Windows: NOT RUN**)
`scripts\start.ps1` (prints setup token + candidate LAN URLs, hidden windows), `stop.ps1`, `doctor.ps1`,
`backup.ps1 [-Label x]`, `restore.ps1 -BackupDir ... -TargetDir ...`, `selftest.ps1` (owner acceptance run;
writes `<data>\logs\selftest-*.txt`). One-click installer/package arrives in M3.

## First run
1. Start → copy the printed setup token (also `<data>/config/setup-token.txt`).
2. Open `http://127.0.0.1:8443` **on the host** → create the admin account (setup is host-only + token).

## iPad
The iPad uses the same URL as the desktop. Service-worker offline cache needs HTTPS (secure context).
- Option A (Tailscale): `tailscale cert <machine>.<tailnet>.ts.net`; set `tls_cert_file`, `tls_key_file`,
  `host = "<tailscale IP>"`, `public_origins = ["https://<machine>.<tailnet>.ts.net:8443"]`.
- Option B (LAN): `researchos-api make-cert 192.168.x.y my-pc.local` → local CA + server cert in
  `<data>/config/tls/`; on the iPad open `https://<ip>:8443/ca.crt`, install profile, then Settings → General →
  About → Certificate Trust Settings → enable. Set `host`, TLS files and `public_origins` as above.
- The API refuses to bind a non-loopback address without TLS (`allow_insecure_lan` exists but doctor warns).
- Pair: desktop Settings → Devices → Pair a device (8-char code, 10 min, single use) → iPad "Pair this device".
  Revoke any device from the same list. Approving sensitive actions from a paired device requires password
  re-entry. **iPad acceptance: NOT RUN.**

## Model relay
An OpenAI-compatible relay can carry the premium vendors' models (for example a relay that serves
Anthropic and OpenAI models). Configuration is data, not code:
1. `<data>\config\researchos.toml`: `relay_base_url = "https://relay.example.com/v1"` and
   `relay_for = ["anthropic", "openai"]` (vendors whose aliases go through the relay; routine DeepSeek/GLM stay direct).
2. Key: user environment variable `RESEARCHOS_RELAY_API_KEY` (or the Settings → keys page, provider `relay`). It is
   moved out of the process environment at start (children never inherit it), redacted from logs, never returned.
3. Prices: enter the relay's prices **and** the official list prices under provider `relay` for each model id
   (`PUT /api/v1/gateway/prices`, verified = true). Unknown price, unknown FX or relay price > 1.3× official = the
   alias stays unusable (fail closed). Calls record `provider` = vendor and `transport` = `relay`.
4. Caps: besides `monthly_budget_cny` / `per_task_budget_cny`, `PUT /api/v1/gateway/policy` takes
   `daily_budget_cny` (per Asia/Shanghai day) and `per_project_budget_cny` (ADR-197); null = no such cap.
5. Restart. `GET /api/v1/gateway/catalog` shows `transport` and why an alias is (not) usable.
Routing is unchanged: PREMIUM_AGENT = claude-opus-5-5 (Q&A, reports), LONG_DOCUMENT_REASONING = claude-sonnet-5-5,
COMPLEX_MULTIMODAL = gpt-6.1-sol; the independent verifier must be a different **vendor** (Claude ↔ GPT), which the
relay does not change. The relay can read everything sent to it: do not route private/sensitive projects through it.
Relays can switch upstream routing — repeat the authenticity check periodically.
Egress gate (ADR-159/162): content from datasets whose egress policy is not `cloud_ok` (e.g. credentialed
PhysioNet data, DICOM) never goes to the relay or any vendor; such calls use local models only, else they fail with
`egress_blocked`. A local model (e.g. Ollama on this PC) counts as local only when the owner lists its provider name
in `trusted_local_providers = ["..."]` in researchos.toml; a loopback URL alone is not trusted and the relay never is.

## Network behind a fake-IP proxy (Clash etc.)
If literature searches fail with "resolves to a non-public address (fake-IP proxy?)", your proxy answers DNS with
addresses in 198.18.0.0/15. Set `network_allow_fake_ip = true` in `researchos.toml` (or env
`RESEARCHOS_NETWORK_ALLOW_FAKE_IP=true`) and restart. Only that range is accepted; private/loopback addresses are
still refused. Check with `scripts/lit_live_smoke.py <tmp dir> <out.json>` (free public APIs, no keys).

## Low-privilege worker (baseline §7)
Create a separate local OS user without admin rights, give it write access to `<data>/runs` only, set
`run_as_user` in `researchos.toml`. Until then doctor reports `low_priv_worker: NOT CONFIGURED`. Always-on guards
regardless: test data are never materialized into run dirs, child processes get a scrubbed environment without
provider keys, only reviewed templates run. (Execution under `run_as_user` lands with the executor in M2.)

## Updates (ADR-223/224; **Windows: NOT RUN**)
Settings > About / Updates: "Check for updates" asks GitHub Releases (only when clicked; never at startup). The
release information is refused unless it is signed by a built-in key (ADR-228). If a newer version exists, "Update"
downloads `ResearchOS-Setup-<v>.exe`, verifies its sha256 and, on the installed Windows version, restarts into the
silent setup (`/S /RUNAFTER /KEEPPREV`), then waits for the new version to answer; if it does not within 2 minutes,
the previous version is put back and started. Your data\ is kept. See `<install>\install.log` and
`data\logs\update.log`. Behind the GFW, set a mirror prefix such as `https://ghfast.top/` (or `update_mirror_prefix`
in researchos.toml); if the mirror fails, the page offers "Retry without the mirror". Manual update: run the newer
setup exe; silent: `ResearchOS-Setup-<v>.exe /S`.
Mac (ADR-266/267; **macOS NOT RUN**): the same signed latest.json carries `platforms.darwin-arm64` (the app zip); "Update" downloads the zip, verifies its sha256, closes the app, checks the sha256 again
right before unpacking (ADR-270; a zip changed after the download is not unpacked), unpacks the new one next to
it, keeps the old one as `ResearchOS.app.prev` until the new version answers, otherwise puts it back (the failed
one stays as `ResearchOS.app.failed`). Log: `~/Library/Logs/ResearchOS/update.log`. A release without a Mac zip shows
"no update for this computer yet"; a Mac never downloads the .exe.

## Release (maintainer, Linux build box; ADR-225)
1. `.venv/bin/python scripts/release/bump_version.py <v>`, then `scripts/check.sh` (tests/test_version.py checks every
   copy); commit.
2. `.venv/bin/python scripts/build_package.py` -> `release/ResearchOS-Setup-<v>.exe`.
3. `.venv/bin/python scripts/release/manifest.py --notes-file notes.md [--notes-zh-file notes.zh.md]` ->
   `<exe>.sha256`, `release/latest.json` and its signature `release/latest.json.sig` (key: `$RESEARCHOS_UPDATE_KEY`,
   default `~/.config/researchos/keys/update-release.pem`; never in the repo; back it up and the backup key
   `update-backup.pem` separately - without them no update can be published to installed copies).
4. `.venv/bin/python scripts/release/e2e_check.py --exe release/ResearchOS-Setup-<v>.exe` -> must print `RESULT: PASS`
   (install step NOT RUN by design).
5. `.venv/bin/python scripts/release/publish.py` prints the preflight and the tag / push / `gh release create`
   commands (dry run); add `--yes` to execute them (needs `gh auth login`).

## Public export + daily check (maintainer, private repo only; ADR-226/227)
- Leak gate (part of check.sh): `.venv/bin/python scripts/public/scan.py --export-from .`. Owner-identifying patterns
  are read from `$RESEARCHOS_LEAK_PATTERNS` (default `~/.config/researchos/leak_patterns.json`, outside the repo).
  The gate (and the daily check) FAILS when that file is missing or invalid (exit 2); `--generic-only` runs only the
  generic patterns and is not a publication gate. Files that are neither UTF-8/16/32 text nor listed in
  `APPROVED_BINARY` (scan.py) are `uninspectable` hits: add a new binary there only after looking at it.
- Build the export for a sync: `.venv/bin/python scripts/public/build_export.py . <public clone>` (keeps its .git),
  then review `git -C <public clone> status` by hand; nothing is pushed by any script.
- Daily check: `.venv/bin/python scripts/public/daily_check.py` writes
  `~/.local/share/researchos/daily/YYYYMMDD-daily-check.md` (`--offline` skips the GitHub read; `--issues-file` /
  `--issues-url` read a saved or local feed). Cron (this box has no cron daemon installed today; NOT RUN):
  `30 7 * * * cd <repo> && .venv/bin/python scripts/public/daily_check.py >/dev/null 2>&1`

## Backup / restore
`backup` = SQLite online-backup snapshot + `raw/ runs/ exports/ datasets/` + non-secret config with a sha256
manifest; active runs and secrets excluded. Safe while running. `restore` writes into a NEW empty dir and verifies
every file hash + DB file references; then stop, switch `RESEARCHOS_DATA_DIR`, start. Migrations snapshot the DB
to `backups/pre-migrate-*.db` first.

## Recovery
Forgot password: `researchos-api reset-password <user>` on the host (revokes all sessions).

## Research self-test (ADR-188)
`.venv/bin/python scripts/research_selftest.py [--out report.json]` runs the fixed regression set in
`scripts/research_selftest.json` (21 items: feasibility, gap map, decisions, methods checklist, cited QA,
citation/number gates, egress, cost cap, leakage, study protocol, advisor, synthetic known-truth EEG). Mock provider
only, no network, no paid calls. Rerun after any change to agents, prompts, routing or the harness; every item must
pass. `tests/test_research_selftest.py` (in check.sh) fails when a listed test is renamed or removed.
