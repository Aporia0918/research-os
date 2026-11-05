# Decisions (ADR log)

Format: id — decision — reason — consequence. Changing a frozen core contract requires a new ADR here.

## Process
- **ADR-001** Core frozen as 9 contracts K1-K9 + engineering conventions (ARCHITECTURE.md, core 1.0.0). Supersedes
  the 10 contracts in the V1_FINAL_SCOPE draft and the 20/12-contract drafts of rounds 2-3. Reason: minimal core
  that still keeps all invariants in core. Consequence: plugins via entry points only.
- **ADR-002** Freeze rule = semver per contract; additive changes free; breaking changes need ADR + major bump +
  migration + updated conformance suite.
- **ADR-003** Repo docs in English, chat with owner in Chinese (workspace AGENTS.md vs CLAUDE_START "concise English
  docs").
- **ADR-004** Uncommitted pre-round-1 M0 code will be rewritten to K1-K9 (separately approved step). No user data
  exists, so `0001` migration is rewritten instead of migrated; M0 `notes` become Doc kind `note`.

## Data, evidence, accuracy
- **ADR-005** Single validated write path: Evidence only after deterministic quote match; numbers must occur in quote.
- **ADR-006** Trust levels `failed < unverified < machine_checked < human_checked`; shown as composition; only
  `failed` blocks; `human_checked` set only by user action.
- **ADR-007** Identifiers stored as `(scheme, value)` table, not fixed columns (CNKI, Zotero, patents lack DOIs).
- **ADR-008** FTS5 `trigram` tokenizer (CJK-capable); jieba segmentation = plugin.
- **ADR-009** Chunk id = hash(version_id, parser_version, page, offset).
- **ADR-010** Parser: pypdf (BSD); PyMuPDF rejected (AGPL); pdfminer.six/pdfplumber as swappable parser plugins.
- **ADR-011** Gold sets G1-G7; (model, prompt) certification before use for evidence-bearing tasks.

## Experiments and diagnosis
- **ADR-012** Template SDK verification modes `recomputed | invariant_checked | self_reported`; `sample_id`
  mandatory in classification predictions.
- **ADR-013** Default split for HAR studies 13/4/4 (train / search-val / confirm-val) of the 21 train subjects;
  GroupKFold as protocol option. Supersedes the 16/5 split used in round 4.
- **ADR-014** Default sampler QMC; TPE optional (little benefit at ~30 trials).
- **ADR-015** Baseline "≤3 candidate configs on val then freeze" = stage 4 top-3 (+ default as reference) on the
  confirm split, 5 seeds. Baseline "first round ≤3 experiments, each ≤90 min": an experiment = one protocol stage
  task (≤90 min); trials are runs inside it; a study may span tasks/days.
- **ADR-016** Search-space narrowing inside the approved space is automatic; widening, metric/data/code change =
  new plan revision + approval.
- **ADR-017** No alpha spending; anti-forking-paths via pre-registered protocol, independent confirm split, single
  test evaluation and reporting the number of configurations evaluated + winner's-curse estimate.
- **ADR-018** v1 analysis = factorial(+center) OLS-ANOVA, failure-region trees, exploratory Optuna importances.
  Morris/Sobol (SALib), GP surrogates, PDP/ICE, MixedLM deferred to plugins.
- **ADR-019** Streaming detection in v1 limited to D01 nonfinite and D05 stall (heartbeat tail).
- **ADR-020** Shuffled-label control only when a result is suspicious, at freeze, or on a new template/pipeline version.
- **ADR-021** Executors receive a materialized RunBundle, never raw dataset paths.
- **ADR-022** Baseline §7 low-privilege worker kept as `run_as` setting + doctor check (status NOT CONFIGURED until
  the owner creates the account); round-4 pruning of it was a baseline violation and is reverted.

## Models and cost
- **ADR-023** Tiers by cost class; routine = DeepSeek V4 + GLM; premium = Claude + OpenAI/Codex; emergency fallback
  only per MODEL_ROUTING_SPEC conditions.
- **ADR-024** Confidence thresholds 0.60/0.85 apply to a composite score; hard rules override (see ARCHITECTURE K6).
- **ADR-025** Unknown price, unknown FX, or effective price > 1.3× official → reject. Prices/IDs are placeholders
  marked `verify` until confirmed.
- **ADR-026** Ledger cost items `model_call | compute | other` with the same reserve/settle/unknown semantics.
- **ADR-027** One paid call in flight; concurrent desktop/iPad requests queue with visible status (no error).

## Platform, safety, effects
- **ADR-028** Windows and Linux first-class; OS code only in the Platform adapter (supersedes baseline "Windows
  native first").
- **ADR-029** Effects contract for all side effects outside data_dir; copy-by-default library organization;
  trash-only; password re-entry when applying from a remote device.
- **ADR-030** Approval subjects and data classes are registries (extensible: research_checkpoint, phi, …).
- **ADR-031** Dataset has `governance` JSON and `storage` external reference + manifest hash.
- **ADR-032** In-house migration runner and SQLite job queue kept (small, controllable; survey confirms huey/Prefect
  add little); all other infrastructure from mature libraries.
- **ADR-033** No integration of Sci-Hub, no Google Scholar scraping, no account login (CNKI = user exports only).

## Scope
- **ADR-034** Baseline M5 hospital line deferred; medical work only via generic adapters (owner decision). External
  agent-runtime adapter not in v1 (optional in baseline).
- **ADR-035** Milestones renumbered M0-M6 (ARCHITECTURE §11); baseline M0-M3 unchanged in meaning, baseline M4 split
  into M4 (diagnosis) + M5 (literature agent); M6 writing added.
- **ADR-036** Literature monitoring: metadata auto-imported, PDF download opt-in; schedules catch up when the host
  is on (no real-time promise).
- **ADR-037** Gold QA set size 30 (≥20 required by baseline).

## Build phase (M0)
- **ADR-038** Hardening patterns adopted inside existing contracts (no parallel mechanism): arch baseline ratchet
  + `--changed` + context pack (scripts/arch_health.py, context_pack.py); key isolation = keystore captures provider
  keys at process start, inherited env scrubbed to an OS allowlist, children get `child_env()` and `spawn()`
  refuses credential-like names (platform/env.py); trace_id on tasks/runs (children inherit; events carry it as
  correlation_id); request preflight = Content-Length cap in the ASGI middleware (2 MB JSON, max_upload_mb for
  uploads). Gateway request-budget preflight is part of K6 in M1.
- **ADR-039** Worker composition root lives in `services/wiring.py` (worker and app are independent top layers);
  plugin loading via entry points in `services/plugins.py`; plugin routers must be under `/api/v1/x/`.
- **ADR-040** Reaper runs only in workers and never touches the reaping worker's own leases; requires both an
  expired lease and a stale/stopped owner worker (host-sleep safe). Non-idempotent kinds → `interrupted`, never
  auto-rerun; a live orphan child that cannot be killed → `blocked`.
- **ADR-041** Web toolchain: pnpm (system npm 9 hits an arborist bug), Node ≥ 20.19 with react-router 7 and
  vitest 4 pinned for Node-20 compatibility; Tailwind v4 + Radix (shadcn-style copied components), TanStack
  Query with IndexedDB persistence, sonner toasts. Packages ship prebuilt assets (no Node at runtime).
- **ADR-042** Every frontend write runs under a persisted intent (IndexedDB) whose idempotency key is reused on
  retry; cleared on success or definitive 4xx. Fixes the M0 "fresh key per request" bug.
- **ADR-043** tailwind-merge extended with the UI type scale (bug found via screenshots: `text-caption` was
  dropped next to color classes).

## Build phase (M1)
- **ADR-044** Hardening M1 adoption: AgentRun toolset frozen at creation (tuple), tool risk manifests in
  `contracts.gateway.ToolSpec`, permission re-evaluated after any argument hook; evidence re-verified (version +
  page digest + quote digest) before it is cited, and passages re-verified before they are sent to a model.
- **ADR-045** First schema/format validation failure retries the same model; escalation needs two validation
  failures or a composite below 0.60 (MODEL_ROUTING_SPEC §4 literal reading).
- **ADR-046** Independent support verification uses a model from a different provider than the writer; if none is
  usable the answer is labelled `support_unverified` (never silently trusted).
- **ADR-047** Unconfigured routine models never trigger premium ("premium = escalation only"); the emergency
  fallback is used only when both routine providers are unusable.
- **ADR-048** Certification eval runs QA in `eval_mode` (gate bypassed, labelled); items with verified=false never
  certify; owner override is recorded as `override` and labels answers `certification_override`.
- **ADR-049** Plugins are loaded only from distributions that declare a `researchos.plugins` manifest whose
  `core_contract` specifier includes the running core version.
- **ADR-050** Owner deferred UI polish; M1+ ship functional pages only until the dedicated polish pass.

## Build phase (M2)
- **ADR-051** Additive core change (core 1.1): `TaskContext.run_id` so handlers can scope artifacts to the run row.
- **ADR-052** SDK `eval_split()`: templates must not probe splits; every `ctx.data()` call is logged and requests
  outside the stage are D04 violations.
- **ADR-053** Revision fence (HARDENING #7): `settings_kv['catalog.revision']` is read once when a run starts and
  stored on the run; the template registry is snapshotted per run.
- **ADR-054** Plan revisions are immutable (DB trigger); approval of a revision also covers later revisions that
  are pure narrowings of the search space; anything else needs a new approval.
- **ADR-055** final_eval needs its own approval (re-auth from remote devices) and runs at most once per plan;
  test data are materialized only for that stage.
- **ADR-056** torch is installed outside the lockfile via the official selector (CPU/CUDA differ per machine);
  templates declare `requires` and fail honestly with `missing_dependency`.
- **ADR-057** Datasets are registered by reference (external path + manifest hash), re-hashed at registration;
  `random_rows` split kind exists only to demonstrate leakage and is failed by D03.

## Build phase (M3)
- **ADR-058** Package = source + uv.lock + prebuilt web; the installer uses the official uv installer and uv-managed
  Python 3.12 (`uv sync --frozen`), so the exact dependency set is reproducible; no bundled interpreter in v1.
- **ADR-059** Offline intents are replayed on reconnect with their original idempotency keys; paid AI requests are
  never replayed automatically.
- **ADR-060** Document parsing runs in an isolated child process with a hard timeout (kill tree).
- **ADR-061** PowerShell scripts are gated by the PowerShell parser + PSScriptAnalyzer (Write-Host and
  dot-sourced variables excluded) when `PWSH` is available.

## Plugin SDK (core 1.2, 2026-10-12)
- **ADR-062** Public extension protocols published additively in `researchos.contracts`: `datasources`
  (BibRecord, SearchQuery/Page, DataSourceSpec, BibliographicSource, DatasetProvider + DatasetDescriptor/build
  context, window-table arrays), `importers` (Importer, KnowledgeWriter, FileImporter), `exporters`
  (ReportSnapshot with structured cite/metric spans, ExportContext, Exporter, Diagnostic), `http` (HttpContext,
  HttpPolicy, HttpDenied/Unavailable), `gateway.ToolBinding/ToolContext`, `execution.TemplatePackage`.
  CORE_VERSION 1.2.0. Input: the three PluginKit proposals (litsearch, har_datasets, report_export); adopted their
  core asks (normalized record with explicit unknowns, host-validated opaque approval instead of booleans, structured
  citation/metric spans, confined outputs, host-owned RunContext); deferred: Semantic-Scholar-specific settings,
  LaTeX process SDK (exporters may ship their own subprocess use inside out_dir; a capability-scoped process SDK is
  M6 scope), artifact blob streaming beyond file paths.
- **ADR-063** Conformance suites live in `researchos.sdk.conformance` as abstract base classes with plain asserts
  (pytest collects subclasses); offline doubles in `researchos.sdk.testing`. Reference plugin
  `examples/plugin_hello` passes all suites and `mypy --strict`; `scripts/check.sh` runs it.
- **ADR-064** Imports need a K3 approval of subject `knowledge_import` whose id IS the sha256 of the exact selected
  records; the host consumes it once before calling the importer.
- **ADR-065** Plugin templates are reviewed only via the owner file `<data>/config/REVIEWED.json`; REVIEWED.json
  shipped inside plugins is ignored. Trusted roots (core, owner-configured dirs) keep their own REVIEWED.json.
- **ADR-066** Network for plugins only through `HostHttp`: https, granted hosts = spec.hosts ∩ manifest
  `network:` capabilities, public resolved addresses (re-checked per redirect), per-host interval, Retry-After,
  size cap, TTL cache. Process-wide rate-limit/cache state is deliberate (per host, not per plugin instance).
- **ADR-067** Entry-point objects may be instances, classes or zero-arg factories (documented in PLUGIN_DEV.md).
- **ADR-068** Run reports now render through the core Markdown Exporter (single rendering path; same contract as
  third-party exporters).

## M4 diagnosis loop (2026-10-12)
- **ADR-069** Studies are a `studies` row + K2 children (no new task engine). Protocol (stages, seeds, budgets,
  chance level) is fixed and hashed at creation; the worker calls `study.advance` after each child finishes;
  idempotency keys make repeated advances harmless.
- **ADR-070** ANOVA uses the full factorial model and falls back to lower orders when failed runs leave cells
  empty; inestimable terms are reported as NOT ESTIMABLE. Reporting needs p_holm < 0.05 AND partial η² ≥ 0.06.
  A factor is fixed (narrowing) only if its main η² < 0.01, no reported term involves it, and its two-way
  interactions were estimable.
- **ADR-071** The response-surface fit over adaptively sampled runs is labelled association, never effect.
- **ADR-072** Freeze = best confirm mean on confirm_val (5 seeds); shuffled-label control must be ≤ chance +
  tolerance (default 0.15) or the study stops as possible leakage; final_eval needs its own approval and runs once.
- **ADR-073** Canary sweep is a built-in reviewed template + generated dataset run through the normal approval and
  executor path (no bypass); modes are an approved `choices` space; D06 stays a fake-clock unit test.
- **ADR-074** Efficiency metrics: SDK `measure_latency` (stdlib), reported with `split="device:<label>"` and units
  ms/bytes/count, verification `self_reported`; a host suspend (D06) voids timing metrics at ingest.
- **ADR-075** Self-tests must fail loudly: selftest.sh/.ps1 exit with the pytest code; the package includes
  `examples/` and PLUGIN_DEV.md.

## Plugin merge batch 1 (litsearch, har_datasets, report_export; 2026-10-12)
- **ADR-076** Merged plugins live in `plugins/<name>/` as uv workspace members, installed through the `plugins`
  extra (installers + selftest). They keep their own ruff/mypy-strict config and tests, run by `scripts/check.sh`.
  Core tests still build services with `load_plugins=False`; `tests/test_plugins_merged.py` loads the real entry
  points. Dev env gains bibtexparser and python-docx.
- **ADR-077** Core ships `py.typed` (PEP 561) — adopted from all three proposals.
- **ADR-078** Templates must be self-contained (review finding: `har_rf`/`har_cnn` imported unreviewed plugin
  code). New `researchos.sdk.checks.template_import_violations` (stdlib, `researchos.sdk`, declared `requires`,
  template-local modules only) is used by `TemplateConformance.test_self_contained` and by the host template gate
  (`template_not_self_contained`, blocked). `TemplateConformance.test_requires_importable` checks that `requires`
  holds import names. Additive SDK change (core stays 1.2.0: no contract type changed).
- **ADR-079** Deferred proposals (not adopted now): federated result groups with per-field provenance (M5 library
  organisation decides the host model); typed split proposal registration (plans own splits; the UCI descriptor now
  carries `official_test_subjects`); streaming/transactional dataset storage (current 256 MB bounded builds are
  enough for v1); managed LaTeX/process contract, typed numeric-claim spans, per-claim evidence graph/freshness,
  transactional export commit + font inventory (M6 writing). Rejected: plugin-settable HttpContext policy / fake
  clock (policy is host-owned, ADR-066); RunContext `declare_artifact` (ingest already hashes every run-dir file);
  extra lease/cancel hooks in TemplateConformance beyond the existing CANCEL test (leases are host-internal).
- **ADR-080** Review fixes applied to the plugins themselves (see their CHANGELOGs): per-record resilience in
  litsearch, har_np template + `sklearn` import name, WISDM malformed-record accounting, UCI official test subjects,
  DOCX control characters.

## Core fixes from the batch-2 review (2026-10-12)
- **ADR-081** HostHttp response cache is per instance and keyed on URL + request headers; requests carrying
  credential headers (Authorization, Cookie, *key*/*token*/*secret*/*auth*) are never cached, nor are
  `no-store`/`private`/`Vary: *` responses. Credential headers are dropped when a redirect leaves the original host.
  The size cap is enforced while streaming (Content-Length pre-check + running count). Per-host politeness state
  stays process-wide (ADR-066). Supersedes the shared class-level cache of ADR-066.
- **ADR-082** Every `np.load` in core and the SDK uses a context manager (open NpzFile handles block deletion on
  Windows, WinError 32).

## Plugin merge batch 2 (physio_signals, zotero_import, diag_stats; core 1.3.0; 2026-10-12)
- **ADR-083** `IdScheme` gains `zotero` (library-scoped `users|groups/<id>/<key>`); the host writer and
  `InMemoryKnowledgeWriter` treat it as a hard identity, so a Zotero version bump of an item without DOI updates
  the same Work instead of creating a duplicate (zotero proposal 1+2). zotero_import now emits it (legacy
  `("other", "zotero:...")` still read) and requires core `>=1.3`.
- **ADR-084** `contracts.gateway.ToolError(code, message)`; host returns `ERROR [code]: message`; tool output over
  `max_output_bytes` is rejected (`output_too_large`) instead of truncated into invalid JSON; any other tool
  exception fails the step, not the AgentRun (diag_stats proposal 1+2). diag_stats `StatsInputError` is a
  ToolError (`invalid_input`).
- **ADR-085** Owner-managed plugin settings: `services/plugin_settings.py` + `GET/PUT
  /api/v1/extensions/{group}/{name}/settings`. Secret fields (writeOnly / format password / x-researchos-secret) are
  stored only in the backend SecretStore under `ROS_PLUGIN_<GROUP>_<NAME>_<FIELD>`, registered for log redaction,
  never returned; requests carrying a secret field are refused; search, import and dataset.build pass merged,
  schema-validated settings. Fixes a review finding that also affected batch 1: the Zotero and Semantic Scholar keys
  previously had to be sent by the client (violating "keys never in the frontend"). Per-plugin header injection by
  HostHttp (plugins never see the key) is deferred: it needs a header-name contract.
- **ADR-086** Documented (not a type change): HostHttp forwards `Range` and returns 206; tested.
- **ADR-087** Deferred: `DatasetDescriptor.license: str | None` (kept required; providers fail unless upstream or
  the owner states a license — stricter); typed split assignment and `upstream_version` fields (ADR-079; kept in
  `extra`); `BibRecord` tags/collections/notes/attachments and FileImporter diagnostics (M5 library organisation will
  define the host model; changing `parse_file`'s return type would be breaking); `MetricValue` CI/n/method and
  recomputable tool results (M6 number gates). Physio datasets are medical signals: built only from public PhysioNet
  open-access projects; no PHI handling is claimed (owner decision: medical specifics later).

## Relay wiring (2026-10-12)
- **ADR-088** OpenAI-compatible relay as a **transport**, not a vendor: `Settings.relay_base_url` (https only) +
  `relay_for` (vendors routed through it) select `RelayProvider` and the key `RESEARCHOS_RELAY_API_KEY` (SecretStore,
  captured out of the environment at start). Aliases keep their vendor (`provider`), so routing tiers, premium switch
  and the different-vendor rule for independent verification are unchanged; prices are looked up under provider
  `relay` (fail closed until the owner verifies relay + official prices; 1.3× rule applies). `model_calls.transport`
  records direct|relay (migration 0005). The relay enforces `max_tokens ≥ 16` (relays refuse smaller "probe"
  requests). Nothing is hard-coded: the installers only write commented hints. Authenticity check by the owner's
  assistant (docs/OPS.md#model-relay); this repo made no paid call. Tests clear all provider/relay env vars (autouse).
  Open: K3 data-class egress rules (block sending sensitive projects to cloud models/relays) are not yet enforced;
  tracked for M5/M6.

## M5 literature agent — checkpoint 1 (core 1.4.0; 2026-10-13)
- **ADR-089** Optional datasource capabilities (additive protocols, detected per object): CitationGraphSource,
  RetractionSource, OaResolver (`spec.kind="oa_resolver"`, own registry table). litsearch 0.2.0 implements them with
  OpenAlex (`cited_by:`/`cites:` filters, `is_retracted`) and Unpaywall (owner email required); requires core ≥ 1.4.
- **ADR-090** Literature candidates are a typed table (invariants: dedupe by normalized hard identifier only, never
  by title; every source sighting kept with its run). Every search/chain run is logged per source (returned, total,
  warnings, error) — the PRISMA "records identified" numbers come from this log, not from memory. One failing
  source never hides the others. `review_first` ranks reviews first (review-first discovery).
- **ADR-091** Imports from candidates: manual selection = consumed K3 `knowledge_import` approval of exactly these
  records (same subject as plugin imports); saved searches may auto-import metadata only when the owner opted in on
  that saved search (autonomy table: internal writes). OA PDFs: owner setting `literature.pdf_download` (default off),
  explicit open licence (CC-BY/CC-BY-SA/CC0) with its source, https, `%PDF-`, HostHttp SSRF guard on the PDF host;
  otherwise metadata only with the reason.
- **ADR-092** Retractions (§5.2): status per work combines all RetractionSources (any True → retracted; else any
  False → not; else unknown, shown as unknown). A newly retracted work sets all its Evidence to `failed`, records
  `works.retraction`, and raises one `retraction` alert listing affected answers.

## M5 — checkpoint 2: screening, saved searches, triggers (2026-10-13)
- **ADR-093** Systematic-review screening: reviews have fixed, hashed criteria; `screening_decisions` is append-only
  (DB triggers). Only users decide (API route); rules and models write `suggestion` rows that never enter PRISMA
  counts. Full-text screening requires a title/abstract include. PRISMA numbers (identified per source, duplicates
  removed, screened, excluded with reasons, full text, included, awaiting) are computed from the run log + decisions.
  A built-in rule always suggests excluding retracted records.
- **ADR-094** Model screening suggestions (`screen_suggest` prompt) are evidence-bearing (certification required),
  treat titles/abstracts as data, and must cite a criterion and quote the exact title/abstract words they rely on
  (deterministic check; otherwise dropped). Structure failures are validator failures; unquoted items lower
  evidence coverage.
- **ADR-095** K2 time triggers: `orchestration/triggers.py` + `Services.triggers`; the worker runs them every
  `trigger_interval_s` (first tick one interval after start). Triggers only enqueue tasks with slot idempotency keys
  (`ss:<id>:<next_run_at>`, `retractions:<ISO week>`); the next slot is computed from *now*, so a long sleep yields
  one catch-up run. Catch-up searches add `from_year` = year of the last run (dedupe absorbs the overlap).
- **ADR-096** Saved searches (query or author watch) run as `literature.saved_search` tasks: new-for-this-search
  candidates → review items + rule auto-screen → `new_papers` alert (or `source_error`); `auto_import` (owner opt-in,
  recorded in the creation event) imports metadata of candidates not auto-excluded; `pdf_download` additionally needs
  the global literature setting. Weekly `literature.retraction_check` over the library when enabled.
- **ADR-097** litsearch 0.3.0 portable filters `author` and `from_year` mapped per source (Crossref
  `query.author`/`from-pub-date`, OpenAlex `raw_author_name.search`/`from_publication_date`, PubMed `[Author]` +
  `mindate`, arXiv `au:` + client-side year filter, Semantic Scholar year only — author reported unsupported).

## M5 — checkpoint 3: citation management and library index (2026-10-13)
- **ADR-098** Citekeys `surname+year+firstword` (ASCII-folded, stopwords skipped, `a…z` on collision), assigned once
  and stable; non-Latin first author → `ref<year>-<hash4>` (pinyin = plugin later). `GET /citekeys/{key}` resolves to
  the Work, its document versions and Evidence — the binding the M6 citation gate uses.
- **ADR-099** Library export BibTeX / RIS / CSL-JSON from stored metadata only (unknown fields omitted), BibTeX
  escaping, explicit `RETRACTED` note for retracted works; round-trips through the merged BibTeX/RIS parsers (test).
  Import: BibTeX/RIS (litsearch), CSL-JSON/Zotero RDF (zotero_import) files become a logged candidate run
  (`POST /literature/files/{importer}`); library import still needs the selection approval. Zotero Web API import
  uses the existing approved-import path with the owner-held key.
- **ADR-100** Tags and collections are K1 relations (`tagged`, `in_collection`); backlinks = docs whose title/body
  cite `{{cite:<citekey>}}`; global search = works (title/authors/venue/citekey), docs, and FTS passages.

## M5 — checkpoint 4: K4 Effects + library organisation (2026-10-13)
- **ADR-101** K4 implemented as `services/effects/`: owner file roots (`settings_kv.file_roots`, default empty,
  hard-denied OS/credential/browser/app-DB locations), closed op set mkdir/copy/move/trash, immutable plans
  (`effect_plans`, DB trigger) whose ops hash is the `effect_plan` approval subject (re-auth on remote devices,
  2 h TTL), append-only `effect_journal` (intent before, result after each op, committed separately).
- **ADR-102** Never overwrite: copies go to `<dst>.ros-partial`, are fsynced and hash-verified, then published by
  hard link (fails if the target exists; rename fallback only where links are unsupported); same-volume moves are
  link + unlink of the source name, cross-volume moves are copy + verify + source to trash. Preconditions (source
  hash, target absent) are re-checked immediately before each op. Windows naming rules apply to every path we
  create; existing sources are accepted as they are.
- **ADR-103** Failure semantics: a locked file (Windows sharing violation / EBUSY) pauses the plan and runs nothing
  after it; a conflict fails the plan (later ops not run). Crash recovery resolves `intent` rows from the world
  (target with recorded hash -> `recovered`; our partial -> removed and the op retried; link-without-unlink ->
  source name removed) and marks the plan `interrupted`; resuming is the owner's `apply` call. Undo walks the
  journal backwards, validates state, reports conflicts instead of forcing (copies -> trash, moves back, created
  empty folders removed, trashed items flagged for manual restore).
- **ADR-104** Library organisation (`library.organize` task) is copy-by-default: scan a read root (PDFs only,
  byte-duplicates kept once), import into the CAS (internal write), identify DOI/arXiv from the first two pages
  (isolated parser), match the library first and then sources by exact identifier only, citekey targets
  `<year|nd>/<citekey>.pdf` (`-v2` for other versions), unidentified to `_unsorted/` with Windows-safe names.
  Gate test: 30-PDF generated fixture -> exact expected plan, crash recovery (both crash points), undo restores
  identical source/library hashes. Trash goes through the platform adapter (tests use a fake recycle bin because the
  sandbox reports every /tmp file as a mount point; real recycle-bin behaviour on Windows: NOT RUN).

## M5 — checkpoint 5: claim graph + deep research pipeline (2026-10-13)
- **ADR-105** Claims are K1 entities (`claim`) created only from verified, page-cited answer sentences; they keep
  their Evidence ids (`supported_by` relations) and work ids, and inherit `failed` trust from failed evidence.
  Contradictions are model suggestions (`claim_contradictions`, certified prompt) only between claims of different
  works, stored as `contradicts` relations with status suggested; the owner confirms or rejects.
- **ADR-106** Deep research is a persisted state machine (`deep_research` table, `research.deep_advance` task, trigger
  that enqueues at most one advance per run per minute bucket). Human checkpoints: K3 `research_checkpoint`
  (subject `<run>:plan`, hash over question + plan + settings) before any network search; the owner's own screening
  decisions (rules/models only suggest; "accept suggestions" is an explicit owner action logged as owner decisions);
  K3 `knowledge_import` of exactly the included records. Round 2 = citation chaining from included records.
  Synthesis = the existing cited-QA path per sub-question (verify-before-use, independent support check), restricted
  to the project's imported full texts; works without parsed full text are listed as metadata-only and never cited.
- **ADR-107** The report is a K8 Doc of new kind `report` with `{{evidence:<id>}}` and `{{cite:<key>}}` placeholders
  per sentence, PRISMA numbers from the logs, contradiction suggestions, sources (retractions and metadata-only
  works flagged) and limitations. Export gates for these placeholders are M6.

## M5 — live check findings (2026-10-13)
- **ADR-108** Live smoke against the real public APIs (`scripts/lit_live_smoke.py`, evidence in docs/evidence/M5):
  (1) the sandbox resolves every host into 198.18.0.0/15 (fake-IP proxy, common with Clash in China) and the SSRF
  guard correctly refused everything -> owner opt-in `network_allow_fake_ip` accepting only that range;
  (2) real PubMed EFetch XML carries an external DOCTYPE, which litsearch's guard refused (all PubMed results lost)
  -> plain external DOCTYPE references are stripped (ElementTree never loads external DTDs), internal subsets and
  ENTITY declarations still refused; (3) arXiv returned 429/timeouts on back-to-back runs -> host-owned politeness
  floor of 3 s for export.arxiv.org (its published terms).

## M6 writing — checkpoint 1: citation + number gates, gated export (2026-10-13)
- **ADR-109** Doc bodies are a Markdown subset parsed into structured blocks/spans: `{{cite:k1;k2}}`,
  `{{metric:run/name/split}}`, `{{evidence:id}}`, `{{lit:text}}`. Exporters still receive only the 1.2 span types:
  evidence becomes a citation of its work + page label. New doc kind `manuscript`.
- **ADR-110** Gates (deterministic, `services/writing/gates.py`; writing sits above content, knowledge and literature): citations must resolve via `citekeys` (retracted
  works flagged); metrics must exist (failed = error, self-reported/unverified = warning); evidence is re-verified at
  check time (missing/stale/failed trust = error, superseded = warning); free numbers are forbidden. A number is
  sourced only inside a placeholder or `{{lit:}}`, in an exempt pattern (figure/table/section/equation refs,
  heading numbers, 4-digit years, letter-first names such as GPT-4/COVID-19), or if it occurs in the quote of
  evidence cited in the same block. `final` = errors refuse the export before any file is written; `draft` =
  warnings, export proceeds and carries the diagnostics. Malformed placeholders are always errors.
- **ADR-111** Fix: the export context resolved citekeys from `identifiers(scheme='citekey')`, but M5 stores them in
  `citekeys`; now the table first, the legacy scheme as fallback.

## M6 — checkpoint 2: suggestion mode (2026-10-13)
- **ADR-112** Suggestion mode (`doc_suggestions`, migration 0009): proposals (replace / insert_after / append) never
  change a doc; an owner decision applies one as a new revision; an anchor that no longer occurs exactly once makes
  the suggestion `conflict` (nothing changes). Cited QA answers enter docs only as suggestions containing the
  verified sentences with their `{{evidence:}}` and `{{cite:}}` placeholders (gate-clean by construction).
- **ADR-113** `{{lit:...}}` also marks values the system computed deterministically from its own logs at generation
  time (PRISMA counts, trust composition) and bibliographic titles in generated reports; generated deep-research
  reports pass the final gates (test). Model/author numbers still need metric/evidence sourcing.

## Research-method features (AFTER M6; design: docs/DESIGN_RESEARCH_METHODS.md)
- **ADR-114** Orientation mode = `literature.discovery.orientation()`: composes `search(review_first)` and `chain`
  (1 hop back + forward from up to N reviews, else top hits); every step is a logged run; the field-overview map
  (kinds, years, top venues, hubs reached from >= 2 seeds) is computed from those results only. No new subsystem.
- **ADR-115** Reading aids (feature 2) extend K7: parser `pypdf-text/2` makes figure/table captions their own
  chunks (label + first sentence; previously captions inside the text flow were never `chunk_kind=caption`);
  `knowledge/reading.py` stores captions (`source_fact`) and author main-point signal sentences
  (`author_conclusion`, versioned cue list `reading-cues@1`, EN + ZH, references excluded) through
  `evidence.create` only (quote located on the page -> page + offsets + hashes; unlocatable sentences are dropped,
  never stored unverified); the cue is a K1 relation `reading_cue`. Runs automatically after parsing and via
  `POST/GET /documents/{version_id}/reading`; idempotent by page offsets. No model.
- **ADR-116** Per-paper note card (feature 3) reuses existing paths: `FtsRetriever.search(work_id=)` and
  `QAContext.work_id` restrict cited QA to one paper; new DocKind `paper_card` with a fixed skeleton (problem +
  importance, method design facts, findings, novelty, author signals, "relation to my work" = owner-only); every
  field is proposed through suggestion mode from a verified cited answer (else "insufficient material"); author
  signals come from feature-2 Evidence. Cards pass the final M6 gates (test).
- **ADR-117** Evidence weight (feature 4) = `literature/weight.py` labels, not a score: venue tier only from
  owner-imported tables (`PUT /library/venue-tiers`, source + year; ISSN or exact normalized venue match, else "tier
  unknown"); publication `preprint` vs `published` from stored facts (peer review is not claimed); retraction from
  `works.retraction` (unknown shown as unknown). Surfaced in `/works/{id}/weight`, library listing and citekey
  resolution.

## Relay review fixes (2026-10-14; review: 20261013-RelayReview/REVIEW.md)
- **ADR-118** Estimability is checked by design-matrix rank, not by NaN p-values. `anova` drops terms that add no
  column rank (highest order first) and reports them NOT ESTIMABLE; e.g. an interaction whose corner cell failed is
  aliased with its main effects and is no longer "reported" from a pinv artefact (the M4 planted lr x batch effect is
  now shown as not estimable and captured by the failure rule). `surface` adds a quadratic term only for factors
  with >= 3 distinct levels (2-level factors are listed in `linear_only`) and refuses an aliased fit.
- **ADR-119** Number-gate exemptions are label forms only (`writing/gates.py` EXEMPT): structural references
  (Figure/Table/Section/Eq./pp. + number); capitalised design labels with 1-2 digits ("Study 2", "Experiment 3");
  years only in citation-like contexts ("(2019)", "(Smith, 2019)", "et al., 2019", "in/since/until/during 2019");
  model/dataset names only in upper-case or CamelCase form ("GPT-4", "COVID-19", "ResNet-50"). A bare 1800-2100
  integer ("N = 2000"), lower-case "steps 1000" and "top-5" are free numbers again.
- **ADR-120** Analyzer reporting gate and curvature. The documented seed-noise floor is now applied: a term is
  reported only if p_holm < alpha, partial eta^2 >= min_eta2 AND its size in response units (2*sqrt(SS/N), the
  high-low difference for a balanced 2-level factor) exceeds the pooled seed SD (skipped with a note when there are
  no replicate seeds). Unreported terms state the reason (nonsignificant / below min effect size / below noise
  floor / not estimable). Curvature = mean(center) - equal-weighted mean of corner cell means, SE from pure error
  (replicates within cells and among centers), t on the pure-error df; wording "departs from linear
  interpolation", no claim of an interior optimum.
- **ADR-121** Parser `pypdf-text/3`: an unterminated caption ends at its paragraph (blank line / heading) instead of
  absorbing the next paragraph's first sentence. Chunk ids include the parser version, so docs parsed by /1 or /2
  keep their chunks until `POST /documents/{id}/reparse` (same `enqueue_parse` path as import; one task per
  version + parser version) re-parses them; reading aids then run on the new chunks.

## Review fixes (2026-10-15)
- **ADR-122** (#1) Reject rank-deficient or zero-residual-df fits before calling ANOVA. Exhausted fallback
  produces exactly one NOT ESTIMABLE result per requested term, with no inferential statistics.
- **ADR-123** (#2) Curvature requires all corners of a two-level factorial and center coordinates at their
  midpoints. Missing corners cannot be averaged into a valid factorial-center contrast; return unavailable.
  The planted study's failed (lr=high, batch=low) corner therefore yields `curvature: null` (`None` in Python),
  not a negative curvature result or evidence of an interior optimum. Study narrowing uses effect estimates
  and failure rules; stopping uses failure rates, search progress/noise, and control results, independently of
  curvature. The full-protocol regression must still reach completion with curvature unavailable.
- **ADR-124** (#3) Writing gates scan embedded digits (including `n30` and `top5`) after explicit label/model
  and metric-name exemptions (`F1`, `R2`, `AUC`). The writing gate extends the existing `NUMBER_RE` grammar:
  hyphens after word characters are separators (`top-5` yields `5`, `n-30` yields `30`), while standalone
  signed values retain their signs. Evidence quotes use the same scanner; the shared evidence-validation
  number grammar is unchanged.
- **ADR-125** (#4; T6) Reading extraction takes an IMMEDIATE transaction before locating/deduplicating evidence.
  The shared `evidence.create_in_tx` validation path and JSON-encoded cue relation commit together; retries repair
  missing relations, and concurrent requests cannot create duplicate evidence at the same source offsets.
- **ADR-126** (#5; T10) Suggestion decisions read and conditionally claim the proposal, apply the current-document
  revision, and emit events in one IMMEDIATE transaction. Composable writers explicitly join the outer transaction;
  exceptions including interruption roll back everything. No compensating accepted-to-proposed write is needed.
- **ADR-127** (#6; T12 U1/U3) Short doc mutations and their replay response share one IMMEDIATE transaction.
  Exports use that boundary and a stable per-intent output directory, so rollback/retry cannot create a second
  artifact directory. Exporters must tolerate overwriting their own output on retry; filesystem writes themselves
  cannot participate in SQLite rollback. Card generation persists a 102 operation record, the initial document,
  per-field progress, and suggestions at atomic checkpoints. An OS lock excludes concurrent executions and is
  released on process death. Saved answers are recovered by a deterministic field trace without repeating QA.
  A field interrupted before its answer was saved is reported as `operation_uncertain`, never automatically
  charged again. Completed records replay; concurrent active cards return `operation_in_progress` for same-key retry.
- **ADR-128** (#7; T12 U5) The document editor owns suggestion mutation state. Title/body editing, saving,
  export and further decisions are disabled until the decision and awaited query refresh finish. The existing
  revision remount then loads the new body without allowing edits to be entered during the acceptance window.
- **ADR-129** (#8; T3/T5) Citation resolution is shared through `content.citekey_index.lookup_work`, including
  legacy identifier-based keys, so gates, export and resolution agree. `literature.citekeys.cited_markdown` is the
  single builder for verified cited sentences used by QA insertion and deep reports; callers do not duplicate it.
- **ADR-130** (#8; T8/T11) Dataset descriptors explicitly declare overlapping windows (MIT-BIH does), allowing
  downstream split/leakage checks to use facts rather than assume independence. Zero-discordance McNemar reports
  p=1; study planning calls the public `sampling.center` helper rather than a private implementation.
- **ADR-131** (#8; T6/T10/T12) Reading evidence and cue relations share the transaction described in ADR-125;
  suggestion decisions and revisions share ADR-126. Doc create/update/decision retry responses commit with their
  mutations; card recovery and its uncertain-paid-call limit are defined in ADR-127. T12 U2 filters ordinary notes
  out of the authored-docs list; U4 exposes parser-version-keyed reparse so existing documents can acquire current
  reading chunks (ADR-121); U5 blocks edits throughout acceptance and refresh (ADR-128). These are extensions of
  the existing document, task, evidence and replay paths, with no separate writing or citation subsystem.

- **ADR-132** (Feature 6) Register `report_slides` in the existing report_export plugin.
  SlidesExporter consumes the same ReportSnapshot, resolver, provenance sidecar and host M6 gates as
  DOCX/LaTeX. Emit report.pptx with white backgrounds, explicit 24 pt body/28 pt headings and at most
  ten explicit lines per slide (heading included); conservatively wrap Unicode text before pagination.
  Default sections are Background/Objectives/Method/Results/Discussion/Conclusion in that order.
  Matching headings select a section; other headings and unsectioned text remain in the current section
  (initially Background). Empty sections are labelled as unsupplied, never synthesized. Retain report title,
  references, claims, table rows and verified figures. Overflow splits into continuation slides and emits
  `slide_overflow` warnings in both the result and provenance, including in final mode. Formatting uses
  fixed safe defaults; unsupported options are rejected. No contract, dependency or host gate changes.

- **ADR-133** Reproduce-and-compare (feature 5) extends `execution.ingest` over K5 runs and K9's stored,
  independently recomputed metrics. Reruns use the existing approved plan revision/run task path; comparison is
  a read-only `POST /runs/{run_id}/compare` in the experiments router. Each requested item explicitly selects a
  number in a freshly verified paper Evidence quote and a run metric/split, with stated absolute or relative
  tolerance (relative threshold = abs(reported) * tolerance; zero therefore requires exact agreement).
  Percent values become fractions; other units must agree exactly (no guessed conversions). Missing, stale,
  superseded, untrusted or non-source evidence, missing/nonfinite/unverified metrics and unsuccessful runs are
  `not comparable`, never matches. Parameter evidence must belong to the same paper version; numeric values
  are selected from quotes and text values must occur in them. Differences against the run's plan revision
  params and actual task params are labelled `candidate cause` only on deviations; no causal inference.
  Responses carry the quotes, source locations, verification, tolerance and M6 evidence/metric placeholders.
  No core contract, schema migration, dependency or frontend change.

- **ADR-134** Frontend page structure and ownership: Codex owns structure, API wiring, interaction logic,
  accessibility and component tests; Claude owns later visual polish. Reuse the existing App.tsx router,
  AppShell navigation, UI components and tokens; introduce no visual system or parallel API client.
  Planned pages: experiments (template launch, immutable plan review/approval, task-backed run status,
  sealed test set/single final evaluation and detector findings); studies (sweep creation/progression,
  ANOVA effects, NOT ESTIMABLE terms, unavailable curvature and failure rules); literature agent;
  evidence weight; reproduce-and-compare; and the slides export option in the existing document editor.
  Page status: experiments and studies implemented in chunk 1; literature search, citation chasing,
  review creation/lookup, screening decisions, PRISMA summary and saved searches implemented in chunk 2.
  Evidence labels, retraction checks and confirmed source-wide venue-tier replacement are integrated into
  Library (including works without PDFs). Chunk 3 implements reproduce-and-compare on each run attempt
  (explicit metric/evidence-number mappings, absolute/relative tolerances, optional parameter specs,
  server-owned item outcomes and candidate cause differences) and draft/final slides export in DocEditor,
  with persistent export diagnostics including slide_overflow warnings. Parameter specs use a JSON array;
  evidence IDs and zero-based number indices are explicit caller selections. Comparisons do not rerun
  experiments; the existing approved execution flow remains the rerun path.
  Existing src/api modules own calls through
  the shared client, using generated request contracts and explicit read-side types for dynamic responses.
  Study lookup uses an ID because the API does not expose a study list. Reads poll real server state;
  loading, error and empty results stay explicit. Plan approval and final evaluation require confirmation,
  with a separate final-evaluation approval and server-enforced once-per-plan gate. No client-side inference
  replaces detector, estimability or curvature results; unavailable statistics remain unavailable.

  Chunk 2 API limits: reviews require ID lookup (no list endpoint); PRISMA exposes aggregate counts and
  exclusion reasons, not append-only decision history. Publication status is derived and "published"
  does not establish peer review. Manual publication/retraction overrides and individual work-tier edits
  are unavailable; tiers can only be replaced as a complete source table. Search is a bounded first page:
  the HTTP search/chain inputs expose no cursor. Saved searches support create, enable/disable and run,
  but no delete or query-update route. Generated request aliases are reused without hand-editing schema.d.ts.

- **ADR-135** P1 analytical planning extends the existing diag_stats plugin with `stats_power`, using its
  ToolBinding, strict input errors and Report envelope. statsmodels becomes a runtime dependency (BSD-3).
  Independent t, paired t, balanced one-way ANOVA and two-proportion arcsine-normal designs solve n, power
  or standardized effect; effects require an explicit source, and Cohen conventions emit a warning.
  n means group 1, complete pairs, or ANOVA total respectively; report total and group allocations separately.
  Round sample sizes upward, balance ANOVA groups, and recompute power at the realized allocation.
  Buderer (1996) supports only precision-based n for sensitivity and/or specificity, using expected prevalence;
  this is not hypothesis-test power or a guarantee of realized case counts. AUC uses Hanley–McNeil (1982)
  variance with a normal critical region calculated under the specified null AUC, and alternative variance
  for power. It supports n, power and minimum detectable AUC above the null (two-sided or larger).
  This is a single-ROC approximation, not a paired-ROC comparison. No observed data are accepted.
  Reject irrelevant/contradictory fields, infeasible targets and unsupported simulation/correlation requests.
  Keep calculations pure and research-only; no host contracts, hospital adapters, persistence or UI changes.
  A result can later be attached to the existing experiment plan; that hook is outside this chunk.
  Validation: frozen statsmodels golden values, independent evaluations of published formulas, round trips,
  integer allocation, strict input and SDK conformance tests. Sources/approximation limits live in the plugin README.
  Review amendment: AUC rejection thresholds outside [0, 1] give zero power; alpha floor 1e-10 (mpmath-checked
  noncentral tails); group-2 rounding uses the decimal ratio so float error cannot add a subject.

## Review of the relay-review-fixes branch (2026-10-16)
- **ADR-136** Review fixes before merge: (1) curvature accepts arithmetic or geometric (log-scaled) design centers
  with the sampler's integer rounding — the review #2 fix had silently disabled curvature for every complete design
  with log/int factors; (2) reproduce-and-compare moved from `ingest.py` into `execution/compare.py` (no behaviour
  change); (3) the number gate uses an explicit `PROSE_NUMBER_RE` instead of string-patching and shadowing
  `knowledge.text.NUMBER_RE`; (4) slides (ADR-132): common manuscript headings (Introduction, Methods, Materials and
  Methods, Conclusions, numbered) map to the default sections, wrapping is word-aware at 60 display columns (verified
  by rendering with LibreOffice), list items are bulleted and never straddle two slides.

## Second review of the fixes, findings #13-#17 (2026-10-16)
- **ADR-137** [review #13] Curvature is the center mean minus the multilinear interpolation of the corner cell means
  at the ACTUAL center coordinates on each factor's design scale (`anova(scales=...)`; the study passes log for
  log-sampled factors). Exact for responses linear (with interactions) on those scales, so rounded integer centers
  and geometric centers no longer create false curvature (ADR-136's midpoint tolerance did); SE uses the same
  weights. Requires a complete 2^k design and one common center strictly inside every range; categorical factors
  give "unavailable".
- **ADR-138** [review #14] Slide wrapping budgets glyph advances, not characters: a printable-ASCII Arial advance
  table (measured on metric-compatible Liberation Sans, rounded up), East Asian wide = 1 em, other characters
  0.95 em; 35.5 em per 24 pt line in the 12.1 in usable box. A render-measured test checks adversarial lines
  ("W"*60, spaced wide words) stay inside the box.
- **ADR-139** [review #15] Number syntax is defined once in `knowledge.text` (SIGN, INT_PART, DOT_PART, PERCENT) and
  composed by both NUMBER_RE (evidence, QA, comparison) and the writing gate's PROSE_NUMBER_RE; leading-dot
  decimals (".05", "-.05", ".95%") are numbers and canonicalize to "0.05" etc., so they can no longer bypass the
  final number gate and still match a quoted "0.05".
- **ADR-140** [review #16] Scientific notation is one quantity in both scanners ("1e-3", "1.2E5", "1×10^-3",
  "1×10⁻³"; a sentence period may follow) and canonicalizes to one exponent form, so "1e-3" can no longer be
  sourced by unrelated "1" and "3" in evidence, while equal quantities in different notations still match.
  Reproduce-and-compare now reads such quotes (Decimal) instead of rejecting them; its special-case check is gone.
- **ADR-141** [review #17] SIGN accepts the Unicode minus (U+2212) and its small/full-width forms (U+FE63, U+FF0D),
  and `canon_number` maps them to "-": a quoted "−5" is -5 in evidence, prose and comparison, so evidence quoting
  +5 can no longer source a claimed "−5", and reproduce-and-compare keeps the sign. En/em dashes stay range
  separators ("3–5" is two numbers), not signs.
- **ADR-142** P2 HRV WIP stash (ros-fixes `stash@{0}`, c16ee83, "WIP P2 neurokit_hrv") is dropped, not finished.
  It computed HRV per window of `X`, but every registered ECG dataset stores short windows (MIT-BIH: 0.7 s
  beat-centred, below its 10 s minimum, so every sample is NaN; PTB-XL: 10 s records, time domain only, never the
  300 s frequency domain), so the option yields little or nothing on the data it targets. Its tests (synthetic ECG,
  hand formulas, offline MIT-BIH R-peak matching) were never run, it stopped with a mypy error, its R-peak check
  used its own beat matcher instead of diag_stats metrics as the plan requires, and it widened the core SDK
  (`dataset_metadata`) for that feature alone. P2 is redone from the plan: continuous record segments with
  reference R-peaks first, peak validation via diag_stats, then HRV features. The patch, including its untracked
  design note and tests, is archived outside the repo (as a patch file); useful
  parts (method/unit recording, quality flags instead of silent drops, the synthetic and hand-formula tests) are
  reused in the redesign.
- **ADR-143** [BIOMED P2 step 1] `physio_mitbih` gains `unit: "segment"`: non-overlapping continuous MLII segments
  (`segment_s`, default 300 s) with reference R peaks (`r_peaks`, every AAMI beat annotation, segment-relative,
  -1 padded to 4 beats/s, denser is an error) and `sampling_rate_hz` as per-row arrays; label `any_SVF_beat`.
  Same DS1/DS2 subject split; `overlapping_windows` is False. Per-row arrays reach the template through the existing
  materialization (all table arrays are copied), so P2 needs no core/SDK change (unlike the dropped WIP's
  `dataset_metadata`). `Table` extras may now be fixed-shape arrays (stacked, dtype kept). Beat mode is unchanged.
- **ADR-144** [review #18–#20] The shared scientific-notation scanner consumes the full exponent before attached
  units ("1e-3ms" yields "1e-3"), so evidence, prose gates and comparison cannot accept the mantissa alone;
  comparison units remain explicit caller selections. Normalize Unicode signs before stripping thousands
  separators ("−1,000" = -1000). Curvature checks log coordinates for positivity before taking logarithms and
  reports an explicit "curvature test not applicable" note when the contrast is unavailable. Regressions cover
  all three numeric paths and nonpositive log centers/corners; no additional parser or contract is introduced.
- **ADR-145** Executor kill never crashes the run handler: under check.sh load `test_fault_injection[hang-stall]`
  failed once because the tree kill did not take, `popen.wait(10)` raised TimeoutExpired and the stall verdict was
  lost (`handler_exception`). `LocalProcessExecutor.kill` now falls back to `platform.process.kill_own_child`
  (SIGKILL to the child's own session group, or the Windows Job Object, then `popen.kill`), which is PID-reuse safe
  because the child is not yet reaped, and returns False instead of raising if it still lingers. Root cause of
  the miss is not reproduced (create_time/boot time are stable here); the regression test simulates it.
- **ADR-146** [BIOMED P2 step 2] `physio_ecg_baseline` 0.2.0 gains `features: "neurokit_hrv"` in a template-local
  `hrv.py` (covered by the template hash; NeuroKit2 pinned to 0.2.13 and checked at run time). Per continuous
  segment: clean + detect (methods recorded, no artifact correction), in-order one-to-one match to the reference
  R peaks within 150 ms, HRV from detected peaks. Domains are gated, never zero-filled: time domain >= 4 peaks,
  Poincaré >= 20 beats, LF/HF only for a >= 270 s peak span with Welch and normalize=False (the NeuroKit2 default
  is not ms^2: a 20 ms, 0.25 Hz RR modulation gave HF 0.0098 vs 189 ms^2, expected 200). Tests: hand formulas
  (Task Force pNN50 denominator = number of NN intervals; Brennan 2001 Poincaré SD1/SD2), the sinusoidal HF check,
  seeded synthetic ECG heart rate, template conformance, and an offline-skippable check on local MIT-BIH records:
  measured sensitivity/PPV (300 s segments) 100: 0.9982/1.0000, 101: 0.9984/0.9989, 103: 0.9986/0.9995
  (neurokit), pantompkins1985 0.9966-0.9987/0.9952-0.9991; the test guards >= 0.995. Peak counts are logged as
  metrics so `stats_diag_metrics` gives CIs (diag_stats stays the single statistics implementation). No core/SDK
  change. Dev note: `uv sync --inexact` keeps the separately installed torch.
- **ADR-147** [BIOMED P3] diag_stats gains `stats_compare_groups` (compare.py + effects.py; same envelope, strict
  input errors, read-only). Deterministic, reported rule: Fisher if 2x2 with an expected count < 5 else Pearson
  chi-square (no continuity correction, Cochran warning); numeric: Shapiro-Wilk (n < 3 = not normal) and
  Brown-Forsythe at `alpha` choose Student t / Welch t / Mann-Whitney, paired t / Wilcoxon, ANOVA / Welch ANOVA /
  Kruskal-Wallis. An explicit test is allowed and warned when it differs from the rule. Wilcoxon uses the exact
  distribution only without ties/zeros, else the tie- and continuity-corrected normal approximation (the exact
  p with ties is wrong: R `sleep` gave 0.0039 vs R's 0.009091). Effect sizes with CIs: Hedges g and d_z (normal
  approximation), rank-biserial (Fisher z), eta^2 (noncentral F inversion), Cramer V (noncentral chi-square
  inversion), conditional odds ratio; omega^2, epsilon^2 and Welch-ANOVA eta^2 without CI (warned). Validation:
  R `sleep` (t.test paired/Welch/Student, wilcox.test paired and two-sample, shapiro.test), Fisher's tea table
  (fisher.test p, OR), hand formulas, and seeded coverage simulations (400 reps, 95% intervals within
  [0.92, 0.98]). Deviation from the plan: results are not routed into `stats_report` (it renders run metrics
  cited in documents; no new channel was invented); multiple comparisons reuse `stats_multiplicity`.
- **ADR-148** [review #21–#23] HRV time domain and Poincaré SD1/SD2 are computed in `hrv.py` from integer peak
  samples instead of NeuroKit2's `hrv_time` / `hrv_nonlinear`: pNN50 tests 1000·|Δsteps| > 50·rate exactly (at
  360 Hz an 18-sample step is exactly 50 ms and float ms made it count, 96.7% instead of 0%); SD1/SD2 (Brennan
  2001, ddof=1) no longer vanish when an unrelated nonlinear index fails. NeuroKit2 stays for cleaning, peak
  detection and LF/HF. Constant RR returns null LF/HF/LFHF with `constant_rr`; LF/HF is null with
  `lfhf_undefined` when HF <= 1e-9 ms^2 (roundoff had produced 1.71). A cross-check test keeps the in-house time
  domain equal to `nk.hrv_time` away from the 50 ms boundary.
- **ADR-149** [review #26] The R-peak match tolerance is the largest whole-sample distance within 150 ms
  (`floor(0.150 · rate + 1e-9)`: 37 samples at 250 Hz, 54 at 360 Hz); `round()` admitted 152 ms at 250 Hz.
  With the review notes: segment reference peaks include every WFDB beat code (B, n, r, ? were missing; labels
  stay AAMI-only), and a segment whose detections disagree with its reference gets the `reference_mismatch`
  quality flag (previously flags were empty on rows with detection errors). MIT-BIH 100/101/103 results unchanged.
- **ADR-150** [review #24–#25] Corrects ADR-145, whose "never crashes the handler" held only for the first wait.
  `kill_own_child` now snapshots and kills every current descendant (psutil handles, identity-checked; this
  includes descendants that left the group via setsid) before killing the child's group, and returns the verified
  outcome (child reaped and no snapshotted descendant alive) instead of the first attempt's result. The Monitor
  records `kill() == False` and a timed-out final wait as `termination_failed` (kept in run extra) instead of
  raising; the run then fails with `termination_failed`, checked before cancel/success and keeping the original
  stop reason in the message. Limits: descendants already reparented away from the child are not found (no cgroup
  containment on POSIX; Windows uses the Job Object), and a completed run's survivor is not swept automatically
  (the dead-worker sweep covers only lost leases), so the message asks for a manual stop.
- **ADR-151** [review #27–#35] Revises ADR-147 (`stats_compare_groups`). (#27) `test=auto` chooses by design and
  estimand, never by pretests: Welch t (independent), paired t, Welch ANOVA (3+ groups); Student t / ANOVA and
  rank tests only on request (rank tests test a different null). Pretest-based selection rejected 13.8% vs 5.2%
  (Welch) under a true null in Codex's simulation; Shapiro-Wilk / Brown-Forsythe stay as reported diagnostics
  with "non-rejection does not verify". (#28) Welch reports the mean difference with its Welch CI as the effect;
  d_av is a point estimate without CI. (#29) d_z is uncorrected (mean / SD of differences) with a noncentral-t CI;
  Student-model Hedges g has a noncentral-t CI for the population d (SciPy's `nct.cdf` NaN deep in a tail is
  replaced by the mirrored survival function). (#30) Independent rank-biserial = 2·AUC − 1 with Newcombe (2006)
  method-5 interval (coverage 0.94–0.98 incl. AUC = 1); the matched-pairs rank-biserial has no CI (its estimand
  depends on n; bootstrap covered 21–51% at large effects). (#31, #32) p-value method is reported: SciPy exact
  without ties (n <= 50), exhaustive permutation with ties when <= 20,000 relabellings / sign flips, else the
  tie- and continuity-corrected normal approximation; Kruskal-Wallis uses permutation when a group has < 5.
  (#33) degenerate inputs are input errors; non-finite results are rejected. (#34) Welch ANOVA computes only
  descriptive eta^2 / omega^2. (#35) paired differences are computed once (optionally rounded to `decimals`)
  and reused; near-ties are warned. Checked against R `sleep`, Darwin's corn (W = 24, p = .041259765625), Cohen's
  d_z example (−1.38873), an independent sign-flip enumeration, and seeded coverage at several magnitudes. The
  table branch moved to `tables.py`, rank tests to `ranks.py` (compare.py stays the dispatcher).
- **ADR-152** [review #36–#37] Descendant enumeration or status inspection errors cannot verify termination:
  the existing fallback still attempts cleanup but returns False for unverified descendants, reaching the
  executor/monitor's `termination_failed` outcome; NoSuchProcess and confirmed zombie/absent handles remain
  successful disappearance checks. MIT-BIH reference peaks now include WFDB isqrs code 31 (`!`), with AAMI
  labels unchanged. Regressions cover both AccessDenied paths through the monitor, the complete official
  WFDB beat-symbol set (hardcoded with source URL), and a synthetic `!` reference peak.
- **ADR-153** [BIOMED P4] diag_stats gains `stats_survival` (lifelines 0.30.3, MIT, extra `survival`; root installs
  it; dependency licences checked: lifelines/autograd/autograd-gamma/formulaic/interface-meta MIT, wrapt BSD-2).
  Analyses: Kaplan-Meier with Greenwood variance and log(-log) CI (curve returned only up to 200 steps, else
  estimates at `times`), log-rank (multi-group), Cox PH with Efron ties, hazard-ratio CIs, LR test, concordance,
  per-covariate Schoenfeld check against KM-transformed time (warned at 0.05) and an events-per-variable warning
  (< 10), and Harrell's C with its pair rule stated (event vs censoring at the same time is comparable; tied scores
  count 1/2; no CI). Validation: Cox coefficients, LR = 33.27 (df 7, p = 2.362e-05) and C = 0.64 on Rossi vs
  R `coxph` (Fox & Weisberg 2011), the documented age / wexp PH violations; KM + Greenwood log(-log) CI,
  two-group log-rank and Harrell's C against independent implementations in the tests. Missing extra, no events,
  constant covariates and non-convergence are input errors. Deferred: censoring-aware evaluation (IPCW).
- **ADR-154** [review #30, #31, #38–#40] Second pass on `stats_compare_groups` after Codex re-verification; corrects
  ADR-151's coverage claim. (#30) Newcombe alone covered 76.5% / 80.3% with unequal spread and imbalance (n 5 vs 50,
  10 vs 100, SD 5:1); the independent rank-biserial CI is now the union of Newcombe method 5 and the DeLong logit
  interval (reusing `roc.delong`), covering 0.93–0.99 over the tested grid (conservative where both hold). (#31)
  Beyond exhaustive enumeration, samples with the smaller group / nonzero differences < 50 get a seeded Monte Carlo
  permutation p (20,000 resamples, SE <= 0.0035) instead of the normal approximation (.0058 vs exact .0848);
  sleep's Mann-Whitney p is now checked against the full 184,756-relabelling enumeration (R's .0693 is the normal
  approximation). (#38) the paired t uses the same once-computed, `decimals`-rounded differences as Wilcoxon.
  (#39) a zero cell's infinite odds ratio / bound is null with a warning. (#40) noncentrality searches scale with
  the observed statistic; a failed inversion drops only the CI (with a note), never the test.
- **ADR-155** Core contracts 1.5.0 (additive): `contracts.files.LocalReadContext` (`list_files`, `read_bytes`;
  PermissionError / FileNotFoundError / ValueError) and `DatasetBuildContext.local`, set by the host only for
  plugins whose manifest declares `files:read` (`Extensions.has_capability`). The host implementation
  (`effects.local_read.RootsReader`) resolves every path through `roots.resolve(read)`, so plugin reads obey the
  owner's file roots, the hard-deny list and symlink/junction refusal; listing skips symlinks. No write access, no
  tool-context access (AgentRun tools stay rights-free). SDK: `FakeLocalRead(root)`. Needed by BIOMED P5 (local
  DICOM folders); also the extension point for future local clinical-data adapters.
- **ADR-156** [BIOMED P5] New plugin `medimg_dicom` (no imaging module existed; pydicom 3.0.1, MIT) with dataset
  provider `medimg_dicom_folder`: reads only through core 1.5 `ctx.local` (`files:read`, owner roots). PHI
  preflight (`deid.py`, a subset of PS3.15 Annex E Table E.1-1 + private tags + overlays + BurnedInAnnotation)
  reports keywords and counts, never values; default `phi_handling: "refuse"` fails the build when anything is
  found, `"pseudonymize"` (owner's explicit, recorded choice) builds a pixels-only table whose groups and sample ids
  are HMAC-SHA256 pseudonyms with a discarded per-build salt (builds are unlinkable); BurnedInAnnotation = YES is
  always refused. Pixels: uncompressed + RLE only (other syntaxes skipped and counted, no licence-varying
  decoders), rescale applied with units (RescaleType, HU for CT), frames split, nearest-neighbour `resize_to` with
  scaled spacing; the source path is not recorded (aggregate content hash instead). Deviation from the plan: no
  `dicom_phi_preflight` agent tool, because AgentRun tools carry no rights and a model-callable local reader would
  widen them; the preflight runs in the owner-initiated build. SDK: `DatasetProviderConformance.make_local()`.
  Tests: pydicom's bundled files in a temporary root (no header value in table, manifest or source; same patient
  one group; CT rescale/resize/spacing checked independently; refusals). Research use only.
- **ADR-157** [review #30, #41] Third pass on `stats_compare_groups`. (#30) The union rank-biserial interval
  covered 64.3% at n = 2 vs 50 (SD 5:1); a grid over the smaller group n = 2..8, the other n in {equal, 20, 50},
  SD ratio {0.2, 1, 5} and shift {0, 1} (2000 reps each) gave worst coverage 0.64 / 0.78 / 0.88 / 0.93 / 0.95 /
  0.96 for n = 2 / 3 / 4 / 5 / 6 / 8, so no CI is reported below 6 per group (null with the reason). (#41) The
  Monte Carlo permutation p now carries `p_monte_carlo_se` {estimate, bound}: two-sided p = 2q gives
  SE = 2 sqrt(q(1-q)/B) <= 1/sqrt(B) (0.0071 at B = 20,000; the earlier 0.0035 bound was for one tail), one-sided
  Kruskal-Wallis SE <= 0.5/sqrt(B). Tests now also cover the paired mean difference and d_z on rounded
  differences and the ANOVA CI-omitted fallback (eps = 1e-5).
- **ADR-158** Core contracts 1.6.0 (additive): privacy ports `contracts.privacy.PhiInspector` (-> `PhiFindings`:
  keyword and risk-signal counts, never values) and `Pseudonymizer` (namespaced, with an explicit `linkable` flag).
  Import needs no new port: clinical sources are `DatasetProvider`s with `files:read` / `network:` capabilities.
  `medimg_dicom` implements both ports (`DicomPhiInspector`, `EphemeralPseudonymizer` with a never-stored key and
  patient / series namespaces), so the interfaces are exercised, not dead. Ports only, no hospital features
  (ADR-158 in docs/DECISIONS.md); a linkable pseudonymizer would need its own ADR on key custody.
- **ADR-159** [V1 item 4] Egress control per dataset licence, one gate. Core 1.7.0 (additive):
  `DatasetDescriptor.egress` in `EGRESS_POLICIES` (`local_only` default, `cloud_redacted`, `cloud_ok`), stored in the
  existing `datasets.governance` JSON at registration (manifest `egress`; missing = `local_only`, invalid = 422), and
  `ModelProvider.location` read with getattr default `cloud` (mock = local; OpenAI-compatible = local only on a
  loopback URL; the relay and vendors are cloud). The single gate is `Gateway.call` -> `gateway.egress.check`,
  before any provider attempt, from (1) declared `data_refs` (dataset / plan@rev / run, resolved to datasets;
  unresolvable = restricted) and (2) detection: rendered messages are scanned for fingerprints of restricted
  datasets (id, manifest hash, sample and group ids >= 6 chars; table `dataset_fingerprints`, migration 0010).
  Restricted content may only use local providers; otherwise 403 `egress_blocked` before anything is sent, and a
  `gateway.egress_restricted` event names the datasets (never content). `cloud_redacted` is restricted until a
  redactor exists. Providers declare: physio_signals cloud_ok only for open licences (ODC-By, ODbL, CC-BY-4.0,
  CC0), medimg_dicom always local_only, har_datasets owner-stated (`egress` setting, default local_only),
  hello synthetic cloud_ok. Tested with declared refs, a planted sample id in a question, plan/run resolution.
  Limits: datasets registered before migration 0010 have no fingerprints (declared refs still apply); detection
  cannot see paraphrased or aggregated content, so callers that put dataset-derived text into prompts must declare.
- **ADR-160** slides_export = extend `report_export`'s `report_slides` (docs/SLIDES_EXPORT.md): one rendering path
  (ReportSnapshot -> resolve -> exporter -> provenance) already serves docs and runs, so no parallel plugin. Steps:
  move slide rendering into `slides.py`; academic layout (title slide, slide numbers/footer, native tables paged
  by rows, captioned figures; portable features only); run snapshots gain image-artifact figures; `paper_card`
  docs accepted; UI buttons on run and paper-card pages. PowerPoint/WPS acceptance is NOT RUN here.
- **ADR-161** [review #42–#46] Privacy ports hardened before they settle. (#42) No header free text crosses the
  boundary: burned-in flag YES/NO/absent/invalid, labels from closed vocabularies (Modality defined terms;
  BodyPartExamined only with an owner `label_values` list; others -> `other`), units from RescaleType defined terms;
  sentinel-value tests over table, manifest and refusal messages. (#43) inspection visits nested sequence items,
  counts each keyword once per record, adds PatientBirthName, AcquisitionDateTime, IssuerOfPatientID,
  OtherPatientIDsSequence, ReferencedPatientSequence, and states its coverage. (#44) `PhiFindings` gains
  `uncertain` and `coverage` (additive) and `clear()`; burned-in unknown on a risky modality or an invalid flag
  refuses the build unless the owner sets `accept_burned_in_unknown`. (#45) pseudonyms length-prefix the namespace.
  (#46) `Pseudonymizer` semantics: key lifetime = instance, one per build; `linkable=False` = no intended identifier
  stability, not anonymity (pixels can link records).
- **ADR-162** [review #47–#52] Egress gate second pass (corrects ADR-159's limits). (#47) restrictions follow
  derived content: `GatewayResult.restricted` names the local_only datasets a call carried; the QA verifier
  inherits the writer's, answers store `egress_restricted` and `("answer", id)` references resolve to it, and an
  `AgentRun` keeps every restriction for the rest of the run (`data_refs` at start, union after each step). Text
  detection stays supplementary. (#48) HTTP providers are cloud whatever their URL; local inference only for
  providers the owner lists in `trusted_local_providers`; the relay is always cloud. (#49) detection matches every
  contiguous separator-delimited part of identifier tokens (prefixes, paths, extensions), case-insensitively and
  for any script. (#50) a marker row records a complete index; the gate and re-registration rebuild missing
  indexes (pre-0010 datasets; `gateway.egress_index`). (#51) a fingerprint shared with a declared public dataset is attributed to it; unique
  ids and hashes still restrict. (#52) reference kinds are validated (dataset, plan, run, artifact, answer);
  unknown or unresolvable references fail closed. Blocks emit `gateway.egress_blocked`; events carry project and
  trace ids. Limit: content from restricted data that enters a prompt without any reference or identifier (e.g.
  typed by hand) is not detectable; callers that place dataset-derived text in prompts must declare it.
- **ADR-163** Containment review of ADR-155 local reads (done by Claude: Codex's provider refused this security
  review). Already held: `..` and absolute escapes (containment on the resolved path), a root that is itself a link
  (roots store resolved paths; protected-location check on the resolution), Windows case and 8.3 names (resolve),
  UNC / `\\?\` / drive-relative / ADS syntax (rejected), FIFOs and devices (not regular files). Fixed: (1) TOCTOU -
  the read now opens from the root's directory handle component by component with O_NOFOLLOW (POSIX), or re-checks
  the opened handle against the real path (Windows), so a component swapped for a symlink after the check is not
  followed; (2) hard links (st_nlink > 1) are refused, since a link inside a root can name an outside file;
  (3) reads stop at max_bytes + 1 even if the file grows after fstat; (4) listing skips junctions as well as
  symlinks. Regression tests cover each POSIX case; the Windows branch is NOT RUN here (ACCEPTANCE).
- **ADR-164** [slides_export step 2] Academic layout in `report_slides`: title slide (title, date, provenance note),
  12 pt footer with short title and "n / N" on every later slide (the only text under 24 pt), native tables with
  the built-in "No Style, Table Grid" style (bold header row, numbers right-aligned, wrapped cells, paged by
  wrapped-line budget so a row never splits, header repeated), figures with their caption on the same slide, and
  `paper_card` docs accepted. Empty default sections no longer produce "No content supplied." slides; they are
  reported as `empty_section` info diagnostics instead (changes the ADR-132 default-section behaviour). Rendered
  through LibreOffice and checked visually; PowerPoint/WPS NOT RUN (ACCEPTANCE).
- **ADR-165** [slides_export step 3] One click from experiment results: run-directory images (png/jpg/jpeg) are
  ingested as `figure` artifacts, and `snapshot_from_run` adds a "Figures" section (one captioned figure block per
  image, ordered by path) so `POST /api/v1/exports/report_slides {run_id}` puts the run's plots into the deck next
  to its native metrics table. Fixes a latent bug: the host's export context reported every artifact as
  `application/octet-stream`, so exporters refused all run images; the MIME now follows the file suffix.
- **ADR-166** Containment review, part 2 (medimg_dicom folder import; part 1 is ADR-163). Errors name files by
  position only - listing and read failures, oversize files and the new total cap never echo paths, which may
  contain patient names; truncated or malformed DICOM (at parse or at lazy pixel decode) is skipped and counted
  (`unreadable_dicom`, `undecodable_pixels`) instead of failing the build with a library message; `max_total_mb`
  (2048) bounds memory next to `max_files` and `max_file_mb`. The plugin logs nothing. Tested under a name-bearing
  folder.
- **ADR-167** [slides_export step 4] One click in the UI: the run page has "Export slides" (POST
  `/api/v1/exports/report_slides` with the run id), and every export result - doc or run - is shown by one shared
  `ExportResult` component with download links. Download is a new owner-authenticated `GET /api/v1/exports/download
  ?path=` that serves only regular files under `<data>/exports` reached without links (anything else 404), so the
  deck can be fetched on the iPad. Paper cards already open in the doc editor, whose Slides button now covers them.
- **ADR-168** Next-experiment advisor = extend the study module (docs/ADVISOR.md): one `feasible()` filter (failure
  avoid rules + new protocol `constraints`, validated at creation) for every sampler, a new opt-in `gp_ei` sampler
  (sklearn GP + expected improvement over a seeded Sobol pool, log-aware scaling), and a read-only advice report
  (sensitivity from the screen ANOVA, seed-vs-configuration uncertainty decomposition, proposed batch, failure
  memory, explicit stop rules with reasons). The advisor never launches runs and never touches the test set.
- **ADR-169** [advisor step A] Constraints and failure memory everywhere, plus BO. Protocol `constraints` are box
  bounds ("batch <= 64"), validated at study creation; if they narrow the approved space the study starts on an
  immutable narrowing revision (existing `plans.revise`, covered by the approval), so screen corners respect them
  too; integer bounds round inwards; an empty range is a 422. Every sampler (QMC, TPE, new `gp_ei`) filters through
  `sampling.feasible()` (failure-region avoid rules + constraints); TPE previously ignored failure memory. `gp_ei`
  (`execution/bayes.py`): sklearn GP (Matern 5/2 + white noise, log-aware unit scaling, standardized objective) +
  expected improvement over 1024 seeded feasible Sobol candidates, distinct top-n per batch, Sobol fallback below 4
  successes. Tests: feasibility for all samplers, determinism and EI ranking, GP beats Sobol on a smooth objective
  at equal budget, end-to-end gp_ei study within a constraint, protocol validation.
- **ADR-170** [advisor step B] Read-only advice: `GET /api/v1/studies/{id}/advice` (`execution/advisor.py`) reports
  sensitivity (screen ANOVA partial eta^2 ranking with its caveats), uncertainty decomposition (pooled seed SD vs SD
  of configuration means -> "add seeds" or "explore configurations"), failure memory and constraints, the batch the
  protocol's sampler would run next (with GP mean +- SD and EI for gp_ei), explicit stop rules (budget, patience,
  max EI below the pure-error SD, failure rate > 50%) and a continue / stop recommendation. It reuses
  `study.propose` and `study.stalled` (extracted from the search stage, so the proposal shown is the one that will
  run) and launches nothing. StudyDetail shows it (`StudyAdvicePanel`), numbers rounded to 3 significant digits.
- **ADR-171** [review #47, #53–#55] Egress gate third pass; each fix tested on the failing path of Codex's repro
  (all four repros now fail). (#47) Core 1.8.0: `ToolSpec.derived_from_args` (default False). An agent step whose
  tool output has unknown provenance adds a `("tool_output", name)` reference, which fails closed, so every later
  step of the run is local-only (blocked if no local model); diag_stats declares its pure tools. The real QA
  verifier path is tested: with only a cloud vendor left besides the writer, nothing is sent and the answer is
  `unverified`. (#53) the completeness marker is written only after the table's content ids were read; incomplete
  indexes are retried on every check, and meanwhile a restricted dataset with an incomplete index restricts every
  call ("index incomplete"). (#54) migration 0011: fingerprint kinds; `identity` (dataset id, manifest hash) always
  restricts, only `content` ids can be attributed to a declared public dataset. (#55) answers without recorded
  provenance fail closed; every new answer stores `egress_restricted` ([] = verified none).
- **ADR-172** [review #56] Export download by record, not by path: `GET /api/v1/exports/{export_id}/files/{name}`
  serves a file only if the `export.created` record exists, its status is not `failed`, the name is one of its
  recorded files, the path stays in `<data>/exports` without links, and the bytes still match the recorded SHA-256;
  everything else is 404. Export records now carry `project_id` (doc's project; run -> plan's project). Authorization
  model stated: single-owner host, every principal is one of the owner's paired devices, so there is no
  cross-user project boundary to enforce; the record check is the boundary. Replaces ADR-167's path route.
- **ADR-173** [review #57–#61] Advisor/sampler fixes. (#57) open float bounds tighten to the nearest representable
  inside value (`math.nextafter`), contradictory constraints are a 422, and `_enqueue` refuses any configuration
  violating the constraints whatever produced it. (#58) fixed dimensions (low == high, one choice) are left out of
  the GP; fixed values are reproduced exactly (no exp(log(x)) drift). (#59) failure memory moves to
  `execution/search.py` and is rebuilt from every finished run before each batch: failure regions inferred from
  all results become avoid rules, exact failed configurations are never proposed again by any sampler, and TPE is
  told failures as failed trials (not objective values). (#60) noise-aware EI: latent posterior SD (white noise
  removed) against the best denoised GP mean at observed points; the advice reports the noise SD. (#61) an empty
  feasible pool returns no points with a reason; the study then stops searching ("search_stopped") and moves to
  confirmation instead of crashing.
- **ADR-174** [review #62] Slide tables are laid out by each row's own wrapped height (16 pt lines at 1.25 + cell
  margins) inside the content box (1.2-6.9 in, above the footer); a row taller than the space under the header
  continues on the next slide in line-aligned pieces, nothing dropped; each table row's height is set explicitly.
  Checked with a 600-word cell (python-pptx geometry and a LibreOffice render).
- **ADR-175** [review #65 + test gaps] An unconditional failure region ("always": the root leaf of the failure
  tree, i.e. failures wherever runs were tried) is understood by `in_region` as the whole space and skipped when
  `_shrink` tightens bounds; the search then proposes nothing and says so, and the study moves on to confirmation.
  Added the tests Codex asked for on the real paths: study integration that no search run repeats an already
  failed configuration (#59), the study transition when nothing is feasible (#61), the denoised incumbent reported
  by gp_ei (`incumbent`, #60), and project propagation into the export record (#56).
- **ADR-176** [review #63, #64] medimg_dicom: every element (nested too) and the values used later are converted
  once right after reading; a file with a malformed value (e.g. free text in InstanceNumber) is skipped and
  counted as `malformed_metadata` instead of raising later with its content in the message; and the provider
  boundary turns any unexpected exception into a fixed message without the library text. Decoded memory is
  bounded from the header before decoding (`max_decoded_mb`, default 1024: rows x columns x samples x frames x 8
  bytes, cumulative), next to the source-byte caps, so a few-KB deflated file cannot expand without limit.
- **ADR-177** Simulation lab step 1 (docs/SIMULATION_LAB.md): EEG analysis/decoding = a `mne_bandpower` feature
  option on the existing physio baseline template (template-local `eeg.py`, MNE 1.10 BSD-3), reusing its models,
  metrics and the host's subject-wise splits and leakage detectors; artifact checks reported, never silently
  dropped (optional training-only exclusion); per-subject balanced accuracy; a model card (basis, verification,
  validation, applicability limits) for every run; per-row sampling rate in EEG tables. Forward-model simulation
  is deferred and must use real solvers.
- **ADR-178** [simulation lab step 2] `physio_ecg_baseline` 0.3.0 gains `features: "mne_bandpower"` (`eeg.py`, MNE
  1.10.2 pinned and checked at run time): FIR band-pass, Welch PSD, log10 band power for resolvable bands only,
  artifact / flat-channel checks reported and optionally excluded from training only; physio_chbmit rows carry
  `sampling_rate_hz`; mixed rates and filters above Nyquist are errors. Every run of the template (all feature
  modes) writes `model_card.json` and `per_subject.json` (`cards.py`). Tests: 10 Hz -> alpha on synthetic
  rhythms, artifact/flat detection, band resolution and rate errors, per-subject balanced accuracy, conformance on
  synthetic CHB-MIT tables. No real EEG used yet (V1 item 3 needs the owner's dataset decision).
- **ADR-179** [V1 item 3 preparation] `physio_eegmmi` provider for the candidate public EEG acceptance dataset
  (PhysioNet eegmmidb 1.0.0, ODC-By -> egress cloud_ok via the licence rule): EDF+ annotations (new
  `edf.read_annotations`, TAL parsing) give T1/T2 = left/right fist trials; windows start at each onset; an explicit
  subject list is required (downloads are deliberate); records at a sampling rate other than the majority, lacking a
  channel or with malformed EDF+ are skipped and listed; subject-level seeded split. Tested only on synthetic EDF+
  files (planted contralateral alpha decoded end to end through the MNE template). Nothing is downloaded: the
  owner has not chosen the acceptance dataset yet.
- **ADR-180** [V1 item 3: methods checklist] The paper-card machinery becomes a shared `writing/cards.py`
  (`CardSpec`: doc kind, title, cited QA fields, deterministic tail sections, owner section); `paper_card` is one
  spec, `methods_checklist` the second (13 reproduction items, each a verified cited answer on this work's full
  text whose evidence carries the page, plus a computed "Missing conditions" list of every item without verified
  evidence). Route `POST /works/{work_id}/methods-checklist` shares the idempotent, resumable card route. Tested with
  the mock provider only.
- **ADR-181** [owner order a: topic feasibility] Project-scope cards: `cards.CardSpec.scope` (work | project) and a
  `subject` dict replace the work-only arguments. `writing/feasibility.py`: cited literature answers (prior work,
  datasets, difficulties) + recorded facts (datasets, template, installed modules, GPU probe, completed-run
  durations, see ADR-183) observed once per intent; status per dimension by fixed rules, never an overall score or a model
  verdict. Route `POST /projects/{project_id}/feasibility`, doc kind `feasibility`. Mock provider only.
- **ADR-182** [owner order b: evidence-gap map] `research/gaps.py` + `POST /claims/gap-map`: owner-named axes (1-2,
  <= 12 terms, alternatives allowed) over the project's verified claims; whole-word matching on claim text and
  evidence quotes; per-cell status contested | gap | thin | weak | covered from works, evidence-weight labels and
  non-rejected contradiction relations. Deterministic, no model call; failed-trust claims excluded and counted.
- **ADR-183** [review #66, #67, #68] Research-feature review fixes. #66: exports and QA passage labels say
  "PDF p. N" (the PDF page index); the parser does not keep printed page labels, so they are never claimed. #67: the
  methods checklist's missing conditions say "not established by retrieved, verified evidence" (absence of support,
  not proof the paper omits it) and list items whose question could not be checked (e.g. `not_configured`)
  separately as unresolved. #68: the feasibility time estimate uses only a comparable workload - succeeded runs of
  an owner-named reference plan revision (fixed template, dataset, parameters, limits) with the template hash
  installed now, a selected dataset and a single device label; other runs of the template are shown as history and
  the time status is `unknown` with the reason.
- **ADR-184** [owner order c: decision records] Owner-written `decision` entities with `based_on` relations to
  evidence, claims, answers, runs, plan revisions, studies and docs (existence + same-project checked at write),
  immutable, revised only through `supersedes` (linear). Support is recomputed on read from live links
  (supported | owner_judgement) and broken links are listed; no model involvement.
- **ADR-185** [owner order d: advisor finish - ablation] Opt-in pre-registered `ablation` study stage after the
  shuffled-label control (`execution/ablation.py`): one factor at a time reset to its reference (protocol value or
  screen centre), on the confirm seeds (validation only), paired contribution with a 95% t interval and a verdict
  limited to what the interval shows; skipped factors listed with reasons; summary in study data and the advice
  report. `study._enqueue` -> `study_data.enqueue` (no duplicate). AI-Scientist-v3 is a design reference only (idea
  of the ablation loop); no code taken, so no licence obligation.
- **ADR-186** [owner order e: simulation lab, EEG/BCI first] `physio_ecg_baseline` 0.4.0 gains `features:
  "mne_csp"` (MNE 1.10.2 CSP on 8-30 Hz band-passed windows, log-variance features; filters fit on the training
  split only, optional artifact exclusion from the fit; `csp_components` default min(4, channels), `csp_reg`).
  Model card entries for basis/verification/limits. Tests on synthetic EEGMMI windows: train-only fit (evaluation
  changes do not alter training features), explicit errors (components, single class, Nyquist), end-to-end decoding
  of the planted lateralisation. The template hash changes, so the owner re-reviews it before real runs.
- **ADR-187** [owner order e + approved addition: synthetic known-truth EEG] `physio_synth_eeg` provider:
  seeded sensor-space generator (1/f background, mu rhythm, planted contralateral ERD, non-responders, planted
  artifacts) with the planted truth in the manifest; labelled synthetic, CC0, cloud_ok, no network. Honest limit:
  no head/forward model (MNE forward simulation would need template anatomy downloads; deferred). Tests check
  recovery of every planted element and chance-level decoding without an effect.
- **ADR-188** [approved addition: fixed regression self-test, before f] `scripts/research_selftest.json`
  names 21 existing tests as numbered items (ST-01..21) with what each proves; `scripts/research_selftest.py` runs
  them (core and plugin directories) and reports pass/fail per item, unreported items count as missing; the guard
  test keeps the list in step with the code. No duplicated test code: the self-test is a curated, stable index.
- **ADR-189** [owner order f step 1: EEGMMIDB local subset] `fetch.LocalCopy` (Upstream interface over the core 1.5
  read-only `ctx.local`) and `physio_eegmmi` `local_dir`; physio_signals declares `files:read`. Checksums verified
  only against a local SHA256SUMS.txt (else unverified, reported), licence only from the owner or a LICENSE.txt,
  `subjects` minimum 3. No network in local builds (tested with a no-host HTTP fake); the real subset is read in
  place and never copied into the repo.
- **ADR-190** [order f, coordinator decision 10/17 21:55 item 2] A local copy without its own SHA256SUMS.txt is
  verified against PhysioNet's public `eegmmidb/1.0.0/SHA256SUMS.txt`, fetched through the plugin's granted
  physionet.org host (one request, no data download); the manifest names the checksum source. Unreachable or
  denied -> the files stay "unverified"; a mismatch aborts the build.
- **ADR-191** [order f: budgeted comparison with effect sizes and power] `execution/paired.py` + `POST
  /runs/{id}/paired`: two succeeded runs on the same dataset and split hash, identical windows and labels in their
  saved predictions -> McNemar 2x2 table; McNemar exact / mid-p from the diag_stats `stats_paired_tests` tool and the
  minimum detectable Cohen's h (80% power) from `stats_power`, both called through the tool registry (no
  reimplementation; 503 if the plugin is absent); accuracy difference with a paired 95% interval (Newcombe, ADR-193) and Cohen's h.
  The output states that windows of one subject are not independent (optimistic with few subjects).
- **ADR-192** [order f / V1 item 7: reproducible bundle] `execution/repro_bundle.py` + `POST /plans/{id}/bundle`:
  one zip with every plan revision and approval, every run directory (failed runs included, materialised inputs and
  run home excluded) plus task outcome, the template source only if its installed hash equals the one the runs used,
  the dataset manifest and provider build settings (never the data), `env/uv.lock`, REPRODUCE.md and a sha256
  index. Published as an `export.created` record, so the existing hash-checked download serves it. Size caps per
  file (50 MB, skipped with a reason) and per bundle (1 GB, refused).
- **ADR-193** [review #69, #70, #71] Paired run comparison (review_1017_order_f_mid.log): fewer than two windows is
  a 422 `too_few_windows` instead of an uncaught error (#69); the difference interval is Newcombe's (1998) hybrid
  score interval for paired proportions (method 10), which stays inside [-1, 1] and does not collapse to a point at
  0 / n or at perfect agreement, replacing the Wald interval (#70; agrees with Wald at large n); runs with different
  seeds are not comparable (#71). Regression tests on the reported triggers.
- **ADR-194** [order f / V1 item 7: figures] Host-drawn run figures (`execution/run_figures.py`): after every
  classification run the worker draws a confusion matrix and per-subject balanced accuracy (with the chance level)
  for each non-train split from the saved predictions and the host-materialised sample -> subject mapping, into
  `host_figures/`, registered as `figure` artifacts (so reports and slides pick them up). Not in the template:
  reviewed templates stay unchanged and every classification template gets them. Predictions are untrusted input
  (row/class caps, unparseable files skipped, drawing errors never fail the run). Deterministic PNG. matplotlib is
  declared in the `experiments` extra (already locked through mne; uv.lock gains only the declaration).
- **ADR-195** [order f: leakage check outside studies] `POST /plans/{id}/revisions/{rev}/runs` accepts
  `control: "shuffled_labels"` (trial stage only; 422 otherwise): the worker shuffles the training labels, as the
  study's control stage already does, so a single baseline can carry its own negative control. The control is
  recorded in run.json and is comparable with the baseline through the paired comparison.
- **ADR-196** [order f: acceptance driver] `scripts/v1_acceptance.py` drives a live instance over the real API
  (resumable state outside the repo): file root, dataset build from the local copy, owner review record, decision
  records written before any result (including the pre-registered rule that picks the single test evaluation),
  plan + approval, baseline / shuffled-label control / two justified variants, paired comparisons, one final
  evaluation, bundle, report and slides, feasibility with a comparable reference plan. Behind a fake-IP proxy the
  acceptance instance sets `network_allow_fake_ip` (OPS.md) so PhysioNet checksums verify. Results: ACCEPTANCE.md.
- **ADR-197** [order f, coordinator cost rule: <= $1 per acceptance run, <= $2/day enforced by the ledger] Optional
  gateway policy caps `daily_budget_cny` (Asia/Shanghai calendar day) and `per_project_budget_cny` (one acceptance
  run = one project; with this cap set, a paid call without a project is refused). Both are checked atomically in
  `ledger.reserve` next to the monthly and per-task caps, count settled + open (reserved/unknown) entries, and
  reject with 402 before any provider call. The acceptance sets them from the USD caps at a recorded, verified FX.
- **ADR-198** [V1 acceptance finding: QA and export gate disagreed on numbers] The PDF text read "colin2 7"; a kept
  cited answer said "colin27": the QA number check (evidence-scanner rule, digits after letters ignored) kept it, the
  final export gate (prose rule) refused the document. The gate's rule (`PROSE_NUMBER_RE` + label exemptions) moved
  to `knowledge.text` and `prose_numbers_missing` is now the cited-QA rule too, so every kept sentence passes the
  export gate. Gate behaviour unchanged. Regression on `check_answer` with the real quote.
- **ADR-199** [V1 acceptance finding: absence statements counted as evidence] Methods-checklist items are established
  only by a verified, cited `source_fact` sentence; model inferences and statements about the passages ("the
  passages do not specify ...", once mislabelled `author_conclusion`) stay visible in the item but no longer remove
  it from "Missing conditions". Cards record the sentence kinds per field.
- **ADR-200** [order g: UI polish, first pass] `JsonDetails` renders API data as labelled, nested definition lists
  with formatted numbers (4 significant digits, grouped integers), folded long lists and the raw JSON on demand
  (every page that showed raw JSON benefits); run lists show the 20 latest with "show all" and readable labels
  (tag/stage + seed); distinct navigation icons; buttons no longer stretch inside grid layouts.
- **ADR-201** [order f: paid part of the V1 acceptance] `scripts/v1_acceptance.py --steps paper`: gateway set from
  verified sources (CFETS USD/CNY parity 2026-10-14; official DeepSeek / Z.ai prices equal to the relay's ratios),
  cheap aliases only (DeepSeek writer, GLM verifier from another vendor; premium and top disabled), ledger caps from
  ADR-197; labelled certification override recorded as a decision because no owner-verified G3 set exists; paper
  chosen for an explicit open licence (the arXiv candidate was correctly refused by the import gate) and uploaded
  via the owner path (the OA resolver needs an e-mail setting that stays unset); methods checklist accepted,
  gate-checked and exported. Results and limitations in ACCEPTANCE.md.
- **ADR-202** [order g: UI] Run metrics show formatted values (exact value as tooltip); the library offers "Paper
  card" and "Methods checklist" per work for a chosen project, behind a confirmation that names the paid calls,
  then opens the new document.
- **ADR-203** [review #72, #73, #74] Reproducible bundle is allow-list based: a run contributes only top-level JSON /
  JSONL / log records up to 5 MB, predictions/*.csv and figure images; every other file (e.g. a stray
  `raw-copy.npz`) is left out and listed with the reason (#72). `env/uv.lock` is included only when it equals the
  `env_lock` every run recorded, else skipped with both hashes (#73). The experiment.run payload schema allows
  `control` only with `stage: trial` and the worker re-checks it at claim time, so the generic `POST /tasks` route
  cannot run a control on confirm / final_eval (#74). Regression tests on the reported triggers.
- **ADR-204** [order f: limitations + report] `scripts/v1_acceptance.py --steps report` writes the acceptance report
  as a project doc (numbers only as `{{metric:}}` placeholders of the runs; labels such as "V1" and electrode names
  declared `{{lit:}}`), updates it through the normal revision route when the text changes, and exports it through
  the final gates as Markdown and slides. The paper's own model is not reproduced; the report says so.
- **ADR-205** [order g: UI for the a-f features] Plan page: "Build bundle" (reproducible bundle, shared export
  result with hash-checked download; left-out files listed). Project page: read-only Decisions card (support badge,
  rejected alternatives, broken links). Study advice: ablation table (frozen -> reference, n, contribution with 95%
  interval, verdict) and skipped factors with reasons. Each with a component test.
- **ADR-206** [order g: UI] Project page "Research planning" card: topic feasibility (topic, dataset, template;
  confirmation that names the paid cited-QA calls; status per dimension with reasons and a link to the document)
  and the evidence-gap map (axes typed as "name: term, term | alternative", no model call; cells with status badges
  and the note that a gap means no verified claim in this library, not absence from the literature).
- **ADR-207** [order g: UI] Run page "Compare with another run" (succeeded runs only): other run id + split ->
  windows, accuracies, difference with the Newcombe interval, McNemar exact / mid-p, Cohen's h, minimum detectable
  h at 80% power, with the non-independence caveat and power note shown next to the numbers.
- **ADR-208** [review #75, #76] Reservation input tokens are an upper bound (UTF-8 bytes + per-message allowance;
  byte-level tokenizers emit at most one token per byte), so a call that could cross a cap is refused at
  reservation (Codex repro: 6.7185 + one 2,000-char call against 6.7249 per project). Usage reported above the
  reservation (e.g. output beyond max_tokens) is still settled at its real cost and raises a `budget.overshoot`
  event. Gateway policy `allowed_models` (model-id allow-list, checked during routing next to tier and egress) makes
  cheap-only independent of tier labels; the acceptance driver sets it to its two cheap models.
- **ADR-209** [order g / V1 item 7: figures visible] `GET /runs/{run_id}/figures/{name}` serves a registered
  `figure` artifact of that run inline (by file name, confined to the run directory, no links, bytes equal to the
  recorded hash; anything else 404). The run page shows the run's figures (host-drawn confusion matrix and
  per-subject accuracy, template figures) through it.
- **ADR-210** [review #77, #78] The attempt normalizes the request to the provider's effective minimum output limit
  (the relay sends at least 16) before the context check and the reservation, so the reserved ceiling and the cap
  checks see what will be billed; Codex's repro is now refused before HTTP (#77). Research planning results carry
  the project they were made for and show only under it (also late responses), and the project page remounts the
  card per project (#78).
- **ADR-211** [found while recording the release video] The bundle reports the by-design exclusions `inputs/`
  (materialised data) and `home/` (process caches, e.g. matplotlib's font cache) once per run instead of once per
  file; any other file outside the allow-list is still listed individually (ADR-203).
- **ADR-212** [V1.1 packaging: install like ordinary Windows software] NSIS setup
  `packaging/windows/ResearchOS-Setup.nsi` (Unicode, per-user, no admin): default directory D:\AI\ResearchOS, else
  %LOCALAPPDATA%\ResearchOS, or the earlier install's directory on update; a directory page; runs the existing
  install.ps1 (now with `-LogFile`, `-NoShortcuts`; output in the progress log, transcript in <dir>\install.log,
  failures shown in a message box and the finish page skipped); "Research OS" Desktop + Start Menu shortcuts to a
  hidden launcher (`scripts/launch.vbs` -> `launch.ps1`: starts the server hidden if it is not answering, waits for
  `/api/v1/health`, opens the browser, shows the first-run setup token in a dialog and copies it); Uninstall.exe and
  an HKCU Add/Remove Programs entry. Uninstall stops the server, removes app\ and the shortcuts and asks before
  deleting data\ (default and silent mode: keep). install.ps1 updates replace the code directories, keep app\.venv
  and never touch data\; it now also copies `plugins` and `examples` (needed by `uv sync --extra plugins`; the
  copy list had missed them). check.sh compiles the setup with `makensis -V2 -WX` when makensis is present.
  Windows execution of the setup, launcher and uninstaller: NOT RUN (compiled and statically checked on Linux).
- **ADR-213** [V1.1 packaging: release zip layout] `scripts/build_package.py` stages the payload once, compiles the
  setup from it (`makensis -V2 -WX`; `--no-exe` only without NSIS) and writes
  `release/ResearchOS-<version>-Windows-<git>.zip` with exactly `ResearchOS-Setup-<version>.exe`,
  `README_INSTALL.md` ("双击这个 / Double-click this") and `install.bat` at the top, everything else under `files/`
  (install.bat now calls `files\install.ps1`). PACKAGE_MANIFEST acceptance records windows_install NOT RUN and
  setup_exe "NOT RUN on Windows (compiled only)". `tests/test_package_layout.py` builds into a temp dir and checks the
  layout, README marker, manifest hashes, that every item install.ps1 copies is in the payload, and no data/secrets.
  install.sh also copies plugins/examples now; a Linux install from the new zip (install.sh, uv sync, migrate,
  serve) was verified on the dev box.
- **ADR-214** [review #79, #80] Setup calls `InitPluginsDir` before extracting to `$PLUGINSDIR` (empty in silent
  mode otherwise, #79). The uninstaller stops the server with `stop.ps1 -DataDir "<dir>\data"` via `-File` and
  double-quoted arguments (any install path, including apostrophes, #80); a failed stop asks the user and cancels by
  default before anything is removed; if app\ cannot be removed completely the user is told and the uninstaller and
  its Add/Remove entry stay for a retry. data\ is still deleted only after an explicit yes. Static regression tests
  (`tests/test_windows_setup_static.py`) fail on the previous script; Windows execution NOT RUN.
- **ADR-215** [v0.1.2: install like ordinary software, offline] The deliverable is one file,
  `release/ResearchOS-Setup-<v>.exe`. It bundles python.org's embeddable CPython 3.12.10 win_amd64 (size and MD5
  checked against python.org's published values; `python312._pth` enables site-packages and puts the app source
  `services/api` and `workers` on the path, since the core locates its files relative to the source tree) and the
  win_amd64/cp312 wheels for exactly the packages uv.lock pins for Windows (markers evaluated for
  x86_64-pc-windows-msvc without re-resolution), the plugin wheels and pip. Setup installs them with
  `pip --no-index --find-links --no-deps` (no network, log in install.log), creates data\ and its config once,
  migrates, and keeps shortcuts / launcher / uninstaller / keep-data behaviour (ADR-212/214); an update replaces app\
  entirely after stopping the server. Pinned packages without a Windows wheel are built from their sdist only if the
  result is pure Python and are listed in the build report (autograd-gamma 0.5.0, bibtexparser 1.4.4); anything
  else stops the build. Completeness: the bundled wheels resolve offline for win_amd64 and equal the lock
  (`scripts/win_runtime.py`). install.ps1/install.bat remain for source checkouts; they are not shipped. Windows
  execution NOT RUN.
- **ADR-216** [found by listing the first 0.1.2 exe] install.txt names the plugins as `name==version` (resolved
  through `--find-links`) instead of wheel file names, which pip would have resolved against its working directory
  (the install dir) and not found. The build now also dry-runs the exact setup command (install.txt, `--no-index
  --no-deps`, win_amd64) against the shipped wheel directory.
- **ADR-217** [review #81, #82] Update: `STOP_SERVER` always yields an exit code (0 when there is nothing to stop) and
  a failed stop aborts setup with "Nothing was changed" before app\ is touched (#81). install.log is opened by setup
  itself from the first step; every subprocess runs through a `RUN` macro that records its label, output and exit
  code ("error" if it cannot start), and the Python steps (pip, migrate) go through `scripts/run_logged.py`, which
  appends their complete output and exit code (nsExec's stack output is limited to 1024 characters); `FAIL` also
  writes its message (#82). Static regression tests fail on the previous script; Windows execution NOT RUN.
- **ADR-218** [review #83, #84] Every setup subprocess runs with `nsExec::ExecToLog` (complete output in the details
  list, no 1024-character stack limit) and the details list is copied into install.log at the end and on failure,
  independent of Python (#83); exit codes / start failures are still logged directly. A silent install has no
  details list, so it logs exit codes and the run_logged.py output only. install.log has one encoding, UTF-16LE with a
  BOM: the setup writes `FileWriteUTF16LE`, run_logged.py appends UTF-16LE (BOM only if it creates the file), so
  non-ASCII user names and paths survive on any code page (#84). Static tests fail on the previous script; Windows
  execution NOT RUN.
- **ADR-219** [review #85, #86, #87] One capture mechanism for every setup subprocess: `cmd.exe /d /s /c "<cmd> >
  step.out 2>&1"`, then the whole file is appended to install.log with raw ReadFile -> MultiByteToWideChar(UTF-8) ->
  WriteFile. It needs no details window (silent installs, #85), no Python, and no NSIS string buffer (lines of any
  length, #86). Python writes UTF-8 (PYTHONUTF8=1) and stop.ps1 sets UTF-8 console output; cmd's own messages (e.g.
  "not recognized", exit 9009) may be in the OEM code page and show as replacement characters, the exit code is
  logged regardless. An install.log from an earlier setup is renamed to install.prev.log before the first write, so
  the new log is UTF-16LE with BOM from its first byte (#87). `scripts/run_logged.py` and the details dump
  (ADR-217/218) are removed, superseded by this mechanism. Static tests fail on the previous script; Windows NOT RUN.
- **ADR-220** [review #88] If the earlier install.log cannot be renamed to install.prev.log (held open), setup stops
  before writing any log line or changing anything, with a clear message; it never appends to the old log. Static
  test; Windows NOT RUN.

## UI language (2026-10-27)
- **ADR-221** [owner: Chinese / English UI switch] The web UI is bilingual (zh-CN, en) with i18next +
  react-i18next, bundled into dist (resources are two JSON files, `apps/web/src/i18n/locales/{en,zh-CN}.json`,
  imported at build time; no runtime fetch, no language-detector dependency). Keys are type-checked against en.json
  (`CustomTypeOptions`), so `tsc` rejects a missing key. Language choice: a stored choice (`localStorage` `ros-lang`)
  wins; on first run `navigator.languages[0]` decides (zh* -> zh-CN, else en). Switching (Settings > General
  selector, top-bar toggle) applies immediately without reload, persists, and sets `<html lang>`. Dates, times,
  relative times and grouped numbers use Intl with the current language; scientific notation stays locale-neutral.
  Backend errors: the protocol is unchanged; `describeError` translates only known FIXED messages, matched on
  (code, exact message) in `i18n/apiErrors.ts`, and shows any other (dynamic, unknown, or changed) server message as
  sent. Not translated by design: data and model output (titles, abstracts, reasons, detector rules, task stage /
  error text from the host), protocol values (split names, exporter ids, doc kinds, enum states other than task
  states), proper nouns (Research OS, provider and source names). Select options keep the protocol value as `value`;
  only the label is translated. Tests run in English (`src/test/setup.ts`); vitest checks key parity, no empty
  values, matching `{{placeholders}}`, detection, error mapping, a live language switch, and scans all non-test
  sources with the TypeScript parser for hard-coded English JSX text / UI attributes / toast, confirm and Error
  messages (`// i18n-exempt` marks developer-only text).

## Updates and release (2026-10-27)
- **ADR-222** [owner: one-click update] One source of truth for the version: `[project] version` in pyproject.toml.
  `researchos.__version__` reads it from the source tree (dev checkout and the Windows install, which ships
  pyproject.toml in app\), falling back to the wheel metadata. apps/web/package.json, packages/contracts/openapi.json
  and the researchos entry of uv.lock are derived copies, rewritten only by `scripts/release/bump_version.py`;
  `tests/test_version.py` fails when any copy differs or a literal `__version__` reappears.
- **ADR-223** [owner: one-click update like CC Switch / Clash Verge] `services/ops/updater.py` + `/api/v1/update`
  (status, `check`, `download`, `install`, `settings`). Network access happens only when the owner clicks "Check for
  updates"; nothing checks at startup or in the background (`auto_check: false` in the status; test asserts no
  request before the click) and installing stays fully offline (the setup is the ADR-215 offline exe). Feed: the
  latest GitHub release's `latest.json` asset (`update_feed_url`, default
  `https://github.com/Aporia0918/research-os/releases/latest/download/latest.json`; no API token, no rate limit)
  = `{version, asset: ResearchOS-Setup-<version>.exe, sha256, url, notes}`; the asset name must match the version,
  the URL must be on the feed's host and end with the asset, https only (plain http only to loopback: local mirror /
  tests). Optional mirror prefix (`update_mirror_prefix` or the UI choice in `<data>/config/update.json`, e.g.
  `https://ghfast.top/`) is prepended to the feed and installer URL; the API process has no proxy env (HARDENING #5),
  so the prefix is the proxy mechanism. `update_timeout_s` per connect/read. Only a newer version (PEP 440 compare)
  is offered; same or older = up to date (never a downgrade). The installer is streamed to
  `%TEMP%\ResearchOS-update\` (the app's redirected temp), hashed while streaming, renamed from `.part` only if the
  sha256 matches, deleted otherwise; a verified earlier download is reused. Install (Windows, setup-made install
  only: `<dir>\app` + `<dir>\Uninstall.exe`; otherwise `update_unsupported` and the owner runs the downloaded exe)
  copies `scripts/apply_update.ps1` next to the installer and starts it hidden, detached, with a credential-free
  child env: stop.ps1 (worker + API), wait for the server PID to exit, `setup.exe /S /RUNAFTER`; on a non-zero exit
  it starts the previous version again. Log `data\logs\update.log`. Errors carry stable codes (`update_network`,
  `update_timeout`, `update_http_error`, `update_bad_metadata`, `update_checksum_mismatch`, `update_bad_mirror`,
  `update_not_available`, `update_busy`, `update_not_ready`, `update_unsupported`, `update_launch_failed`) with fixed
  English messages; the UI translates by code. Tests: local fake release HTTP server. Windows execution NOT RUN.
- **ADR-224** [silent update + rollback] The setup's native `/S` is the silent mode (every message box has `/SD`;
  static test); new `/RUNAFTER` starts Research OS after a successful silent setup. An update no longer deletes the
  previous `app\` first: it is renamed to `app.prev` (a failed rename stops with "Nothing was changed"), the new
  version is installed, and `app.prev` is removed only after the last failable step (migrate). Any `FAIL` while
  `$Rollback` is set removes the partial `app\` and renames `app.prev` back (logged; if that rename fails the log
  names `app.prev` for a manual restore). data\ is never touched; the registry / shortcuts / uninstaller are written
  only after success, so a failed update leaves the earlier entries. Limit: if `migrate` itself fails after changing
  the schema, the code is rolled back but the database keeps the migrator's pre-migration backup in data\backups
  (restore with `researchos-api restore`). The uninstaller also removes a leftover `app.prev`. Windows NOT RUN.
- **ADR-225** [release prep v0.1.3] `scripts/release/` (Python, stdlib + project deps; run with `.venv/bin/python`):
  `bump_version.py <v>` rewrites the ADR-222 source and its derived copies (each text rewrite must hit exactly one
  field, including the researchos entry of uv.lock: `uv lock --offline` cannot re-resolve without
  every wheel cached, `uv lock --check` confirms the edit); `manifest.py --notes|--notes-file` hashes
  `release/ResearchOS-Setup-<v>.exe` and writes `<exe>.sha256` (`<hex>  <name>`) and `latest.json` in the ADR-223 feed
  schema, url `https://github.com/<owner>/<repo>/releases/download/v<v>/<asset>`; owner/repo are parsed from the
  default `Settings.update_feed_url` (the only place they are written) and the output is accepted by
  `updater.parse_release` before anything is written; `publish.py` preflights (files, feed, version, both hashes,
  clean worktree, new tag) and prints `git tag -a v<v>`, `git push origin v<v>`, `gh release create v<v> --repo
  <owner>/<repo> --verify-tag --latest` with the three files and the feed's notes: **dry run by default**, `--yes`
  executes; `e2e_check.py [--exe]` serves a GitHub-like layout from http.server on 127.0.0.1:<random port>, points
  `update_feed_url` there and drives the real Updater (installed version presented as 0.0.0): check -> available,
  download -> sha256 -> ready, tampered sha256 -> `update_checksum_mismatch` with the file deleted; the install step is
  always NOT RUN (Windows-only, it replaces the installed copy). `updater.asset_name()` is the single installer-name
  helper; the updater reuses `kernel.backup.file_sha256`. check.sh fails first when the venv drifts from uv.lock
  (`uv sync --inexact --extra dev --extra experiments --extra plugins --frozen --check`): the three pre-0.1.3 tpe
  sampler test failures were optuna missing from such a venv. Tests: `tests/test_release_scripts.py` (offline).

## Open-source hygiene (M7.1; 2026-10-28)
- **ADR-226** [public export in the repo] The public-export tooling moves from an external folder into
  `scripts/public/` (maintainer-only; the directory is itself on the deny list, so the export never contains the deny
  list, the scan patterns or their tests). `build_export.py <src> <dst>` copies `git ls-files`, drops the one deny list
  `DELETE` (now incl. every `docs/*PLAN*.md` internal plan), applies the neutral `RULES` rewrites and adds the public
  project files from `scripts/public/files/` (README en/zh-CN, CONTRIBUTING, SECURITY, LICENSE, .gitignore, issue
  templates); rewrite rules that match nothing are printed as `WARN unused rewrite rule` so the list cannot silently
  rot. `scan.py` scans a tree (git repo: tracked + untracked-not-ignored; other dirs: every file) or `--history`;
  secrets are masked in its output. Generic patterns (secrets, relay host, e-mail, user paths, ip:port, internal
  document markers incl. `V<n>_PLAN`) live in the repo; patterns that would themselves identify the owner (names, ids,
  school, lab, acceptance-paper markers, private hosts) live only outside the repo in `$RESEARCHOS_LEAK_PATTERNS`
  (default `~/.config/researchos/leak_patterns.json`); without that file only the generic patterns run and the gate
  says so. check.sh runs the tooling tests and `scan.py --export-from .` (build into a temp dir + scan) and fails on any
  hit. Tests: `scripts/public/tests/` (planted leak fails the gate, masked output, private patterns, allow list needs a
  full match, history scan); they are run by check.sh, not by the exported pytest suite.
- **ADR-227** [daily bug check] `scripts/public/daily_check.py` (beside the export tooling, so it is not exported)
  runs check.sh on the current checkout (warns when that is not master; it never switches branches), rebuilds and
  leak-scans the export, diffs it against the local public clone (= what the next sync would publish) and, only if
  api.github.com is reachable, reads the public repo's open issues/PRs with one unauthenticated GET. Triage is a
  label in the report only: `leak` (the leak scanner matches title/body; the title is withheld and the day FAILs),
  `feature`, `bug repro` (a version and repro steps/diagnostics), else `needs info`. The dated report goes outside the
  repo (`$RESEARCHOS_DAILY_DIR`, default `~/.local/share/researchos/daily/`; a path inside the repo is refused) and
  lists leak locations without excerpts. It never pushes, comments, labels or closes. Offline the network section is
  NOT RUN; tests use a local fake issues feed. Scheduling: cron line in OPS.md (no cron daemon on this box: NOT RUN).

## Update hardening (M7.2; 2026-10-28)
- **ADR-228** [authenticity of the update feed; extends ADR-223/225] The sha256 came from the same feed as the URL, so
  whoever controls the release account could ship any exe. `latest.json` is now signed: the detached release asset
  `latest.json.sig` holds one line `ed25519 <key id> <base64 signature>` over the exact feed bytes
  (`services/ops/update_signing.py`; `cryptography` was already a dependency). The public halves of a release key and
  of a backup key are compiled in (`TRUSTED_KEYS`, key id = first 16 hex of sha256(raw public key)); the private keys
  were generated on the release box with `scripts/release/keygen.py` (refuses paths inside the repo, never
  overwrites, mode 0600) under `~/.config/researchos/keys/` and are never committed; backing them up is an owner
  action (M9). Rotation: embed the new public key in a release signed by a still-trusted key, then drop the old one
  in a later release; a lost release key is replaced by the backup key the same way. Feed parsing, URL rules and the
  error codes move from updater.py to `services/ops/update_feed.py`; `parse_release(raw, feed_url, signature,
  trusted)` verifies before it parses, so an unsigned (`update_unsigned`) or badly signed (`update_bad_signature`)
  feed is never offered. `manifest.py --key` signs, validates with the embedded keys and only then writes
  `.sha256`, `latest.json`, `latest.json.sig` (optional `notes_zh` from `--notes-zh-file`); `publish.py` uploads the
  signature and its preflight refuses an unsigned or tampered feed. New stable failure codes for the download:
  `update_incomplete` (connection cut or fewer bytes than announced; retryable), `update_disk_full` (ENOSPC on the
  `.part` file, HTTP 507), `update_write_failed`, `update_asset_missing` (the feed names a newer version whose
  installer answers 404), `update_mirror_failed` (any failure through the mirror prefix; separate from
  `update_bad_mirror`, which stays the validation error of the setting). A mirror failure is never retried by itself:
  the page shows "Retry without the mirror", which sends `{"direct": true}` to `/update/check` or `/update/download`
  for that one request; the saved prefix is unchanged. Two racing download clicks start one download (`update_busy`,
  tested with a barrier). "What's new": `install()` stores the release's notes in `<data>/config/whats_new.json`;
  `status.whats_new` returns them only while the running version equals theirs; the app shell shows them once in a
  dialog (zh UI: `notes_zh` when present; notes are release data, not translated) and
  `POST /update/whats-new/dismiss` deletes the file. `e2e_check.py` runs signed / unsigned / tampered-signature /
  tampered-sha256 / mirror-down (+ retry without it) against the local fake release server with an ephemeral key;
  the install step stays NOT RUN.
- **ADR-229** [post-update health check; extends ADR-224] The updater passes `-Version` and `-HealthUrl` (its own
  loopback `/api/v1/health`) to `apply_update.ps1`, which runs `setup.exe /S /RUNAFTER /KEEPPREV`; the new setup
  switch leaves `app.prev` in place after a successful silent setup (any other run still removes it). The helper then
  waits up to 120 s for health to report the new version: healthy -> `app.prev` removed; otherwise the reason is
  logged to update.log, the new version is stopped, `app\` becomes `app.failed`, `app.prev` becomes `app\` again and
  the previous version is started; the log names the migrator's pre-migration backup in data\backups for the case
  that the new version already migrated the database (same limit as ADR-224). data\ is never touched. Static tests
  only; makensis compiles the switch here; PSScriptAnalyzer and every Windows execution: NOT RUN (no pwsh on this
  box).

## Diagnostics bundle (M7.5; 2026-10-28)
- **ADR-230** [one-click Windows feedback] Settings > About > "Export diagnostics" downloads
  `GET /api/v1/diagnostics/bundle` (session required; built on demand, nothing stored or sent) =
  `ResearchOS-diagnostics-<version>-<utc time>.zip` from `services/ops/diagnostics.py`. Only the allow-listed entries
  can be written (`ALLOWED`; any other name raises): `logs/install.log` + `logs/install.prev.log` (the setup-made
  install dir; UTF-16LE decoded), `logs/launcher.log`, `logs/update.log` (each the last 3000 lines of at most 4 MB),
  `version.json`, `system.json` (OS, machine, Python, CPU count, memory, free disk, installed copy / TLS / dev mode;
  no host or user name), `task_errors.json` (last 200 tasks with an error code or a failed / interrupted / blocked
  state: id, kind, state, stage, attempt, code, message, time) and a README. api.log / worker.log and anything from
  the library are deliberately not included. Every entry passes the existing log redaction (`kernel.logsetup.redact`:
  key patterns + registered secrets), then this install's data / install / home paths (both separators, any case)
  become `<data>` / `<install>` / `<home>`, the name in a user-profile path becomes `<user>` and e-mail addresses
  `<email>`. The bug-report template names the button by its UI labels (test). Windows: NOT RUN.

## Deep research follow-ups (M7.4; 2026-10-28)
- **ADR-231** [stage compare-and-swap; extends ADR-106] Two `research.deep_advance` tasks for one run (trigger ticks,
  retries, a second worker) could both run a stage (duplicate searches, imports, model calls) and both move it.
  Core migration 0012 adds `advance_owner` / `advance_until` to `deep_research`: `deep.advance` first claims the run
  with one conditional UPDATE (free or expired claim; lease 900 s, longer than a stage; a dead worker's claim
  expires and the next tick continues); a concurrent advance gets no claim and returns the stage it found without
  doing anything. Every stage change goes through `deep_store.move(frm, to)`, `UPDATE ... WHERE id=? AND stage=?`
  (rowcount 1 or `StageConflict`), so even a late advance whose claim expired cannot move a stage twice; `save()`
  refuses `stage` and only writes outputs. The claim is released in `finally` by its owner only; the claim columns
  are not part of the API output. Tests: two threads with separate connections (one runs the stage, the other
  returns at once; one event), CAS conflict, late advance, expired claim takeover.
- **ADR-232** [K3 egress per literature source; reuses ADR-159/162] Literature sources are remote services, so what
  they receive is egress like a model prompt. `discovery._run_source` (every search and citation-chaining call, incl.
  deep research and library organisation) first passes exactly what the source would receive - query text and
  filter values, or the chaining seed's title, identifiers and authors - through the central `egress.check` with the
  caller's `Ctx.data_refs` (new, default empty): a local_only dataset declared there or detected by its fingerprints
  blocks that source (`per_source` error `egress_blocked: ...`, event `gateway.egress_blocked` naming datasets and
  source, never content; the source is not called; the other sources' results stand). Sources are remote unless they
  declare `location = "local"` (read with getattr, the ADR-159 provider convention; additive, no contract change).
  OA resolvers and retraction checks send only public identifiers of external works and are not gated.
- **ADR-233** [title-based identification; library organisation matched by exact identifier only] Imported PDFs without
  DOI / arXiv used to stay unidentified. Now library organisation reads a title guess from page 1
  (`identify_title.title_guess`: the first of the first 15 lines with 4-40 words / 15-300 chars and no
  journal/DOI/URL/copyright marker), searches it on the configured sources through `discovery.search` (so it is
  logged and egress-gated, ADR-232) and stores up to 3 candidates with normalised title similarity >= 0.85
  (difflib ratio on NFKD-casefolded word tokens) in `doc_identifications` (core migration 0013) as `suggested`.
  The file is still planned into `_unsorted` and its document keeps its placeholder work: nothing is matched
  silently. `GET /api/v1/library/identifications` lists open suggestions (the owner's review queue);
  `POST .../{id}/confirm` links the stored document to the candidate's work (`upsert_work` + `attach_original`,
  which re-links the same bytes) and rejects the other suggestions for that document in the same decision (event
  `library.identified`); `POST .../{id}/reject` drops one; a second decision is 409 `already_decided`. Tests on
  local reportlab fixture PDFs. Limit: the review-queue UI is not built yet (API only; M8 UI pass).

## zh/en for generated documents (M7.3, first slice; 2026-10-28)
- **ADR-234** [extends ADR-221 to the server] Fixed text in generated documents comes from one catalog per package,
  rendered in a per-export `language` option (`en` default - the owner wants English academic slides - or `zh-CN`),
  independent of the UI language. `researchos.sdk.texts` (plugin-facing, contracts-only like the rest of the SDK):
  `Catalog({language: {code: text}})` refuses at build time a catalog whose languages differ in codes, have empty
  texts or differ in `{placeholders}`; `export_language(options)`; `LANGUAGE_OPTION` for option schemas. Catalogs:
  core `services/content/texts.py` (run report snapshot: title, summary, headings, metrics table header, figure
  captions, provenance labels; Markdown exporter: references heading, unknown authors, evidence count) and
  `report_export/texts.py` (slide kind labels, title-slide note and date format, slide section titles, references,
  claim label; Word and LaTeX use the same catalog). `snapshot_from_run(..., language)` builds the run report in the
  export language (ReportSnapshot.language `en` / `zh`); `publish()` validates `options.language` for every exporter
  (422 `bad_language`); the plugins' option schemas accept it. Slide grouping also recognises common Chinese
  manuscript headings (and a full-width colon). Not translated, as ADR-221: data, model output, protocol values
  (ids, hashes, split names, verification labels, gate markers such as `[missing]`), proper nouns, Word style names.
  The web adds a "Document language" select (English default) next to the run-slides and document export buttons.
  `tests/test_backend_i18n_scan.py` (Python AST, the twin of the web scanner) fails on English passed to a document
  sink (TextSpan, Word / slide text calls) or a Markdown heading literal in the template modules
  (`TEMPLATE_MODULES`; `# i18n-exempt` for markers); scope grows package by package. Accept test: the same run
  exported as Markdown and .pptx in both languages has identical numbers with their verification labels and passes
  the number gate in both, and the zh export carries no English catalog heading. Still open (later slices): task
  stage text, gate and diagnostics messages by code, methods-checklist labels, deep research report headings and
  limitations boilerplate (a stored K8 doc), the remaining fixed API error messages, and the Playwright zh text scan.

## Codex review of M7, findings #89-#95 (2026-10-28)
- **ADR-235** [review #89; fixes ADR-230] The diagnostics bundle redacted `system.json` / `task_errors.json` after
  `json.dumps`, which doubles backslashes and escapes quotes, so a Windows path (`D:\...\data\...`) or a secret
  containing a quote no longer matched. `Redactor.tree()` now redacts every string (keys too) of the data before it
  is serialised; log tails are plain text and stay redacted as text. Test: a backslash data path and a registered
  secret with a quote in a task error come out as `<data>` / `[REDACTED]`.
- **ADR-236** [review #90; fixes ADR-232] Citation chaining checked only the seed's title, identifiers and authors but
  hands the whole `BibRecord` to the source (OpenAlex sends `source_id`; other plugins may use the abstract or URLs).
  The egress check now sees every string of `asdict(record)` (`discovery._strings`, nested values included). Test:
  a local_only sample id in any one of source_id / abstract / venue / url / oa_pdf_url / license / license_source /
  kind blocks the source; the earlier "allowed" case had kept the id in the abstract and is corrected.
- **ADR-237** [review #91; fixes ADR-226/227] Without the private pattern file the leak gate printed a note and could
  pass, so a fresh checkout or a misconfigured cron never checked owner names or acceptance-paper markers. Now
  `load_scanner()` raises `PrivatePatternsError` unless the file exists and holds a non-empty `patterns` object of
  valid, non-empty regexes (`allow` an object); `scan.py` then exits 2 ("CANNOT RUN THE GATE"), and the daily check
  adds a FAIL section `private leak patterns` (it still triages with the generic patterns). `--generic-only` is the
  explicit non-gating mode (labelled "not a publication gate"; hits still exit 1). Tests: missing / bad JSON / empty /
  invalid-regex files refuse the gate; generic-only is labelled; the daily report FAILs.
- **ADR-238** [review #92; fixes ADR-226] The tree scan skipped any file that was not UTF-8 while the exporter copied
  it, so a UTF-16 file with a secret passed. `scan.decode_text` decodes UTF-8, BOM-marked UTF-8/16/32 and BOM-less
  UTF-16 (recognised by its NUL layout; NUL counts as binary otherwise, since it is valid UTF-8); a file that still
  cannot be read is an `uninspectable` hit unless it matches `APPROVED_BINARY` (png/ico and the two plugins' fixture
  archives / WFDB files, scanned by name only). Tests: a planted secret in utf-16 / -le / -be / utf-32 / utf-8-sig is
  found; an unknown binary and a Latin-1 text file fail; approved binaries pass.
- **ADR-239** [review #93; fixes ADR-231] The 900 s claim was never renewed and keyed by the actor, so a slow stage
  could overlap its replacement, a stale `save()` could overwrite the winner's outputs before the final CAS, and a
  retried task (same actor) could free the replacement's claim. Now `claim()` returns a unique token (`adv_...`,
  stored in `advance_owner`); `save()`, `move()` and `renew()` require it (`WHERE advance_owner=<token>`; a takeover
  raises `LeaseLost`, a subclass of `StageConflict`, so `advance` ends and returns the winner's stage) and every
  write renews the lease; long stages also `renew()` before each search query, each chaining seed and each
  sub-question's answer; `release()` frees only its own token. Side effects already done between two renewals by
  a stale advance (a logged search run) are not undone: they are logged and idempotent at the candidate level. Tests:
  new token per claim even for the same actor, stale save / move / renew refused and the winner's data intact,
  renewal blocks a takeover, a stage that loses its lease mid-way ends without writing.
- **ADR-240** [review #94; fixes ADR-233] Confirm checked the suggestion's status, then created the work and relinked
  the document in separate commits, and only then recorded the decision, so two confirms of different candidates
  could both succeed (two confirmed suggestions, the document linked to whichever finished last) and a reject could
  race a confirm. Now the decision comes first in one `BEGIN IMMEDIATE` transaction (`identify_title._decide`):
  status check, refusal while another suggestion of the document is confirmed, the update, and for a confirm the
  rejection of the document's other open suggestions; the loser gets 409 `already_decided`. Only the winner then
  creates the work and relinks; if that fails, the suggestions it decided are re-opened (`_undo`) and the error is
  raised. Tests: two threads with separate connections (two confirms; confirm vs reject) - exactly one wins, the
  document is linked to the winner's work; a failing link re-opens both suggestions.
- **ADR-241** [review #95; fixes ADR-228] `latest.json` and `latest.json.sig` were read whole (`c.get`) before their
  size limits applied, so a compromised mirror could exhaust memory before verification. Both are now streamed by
  `updater._bounded(client, url, limit, code)`: an announced content-length above the limit is refused before
  reading, and reading stops as soon as the received bytes pass it (feed: `MAX_FEED_BYTES`, `update_bad_metadata`;
  signature: `MAX_SIG_BYTES`, `update_unsigned`, the code `verify` already gives an oversized signature); error
  bodies are not read. The installer download was already streamed with `MAX_INSTALLER_BYTES`. Tests: oversized
  feed / signature by content-length against the fake release server; an endless chunked body (httpx MockTransport)
  is abandoned one chunk past the limit.

## M7 completion (2026-10-28)
- **ADR-242** [M7.2 failure paths end-to-end; extends ADR-225/228] `e2e_check.py` now also runs the download failure
  paths against the local fake release server (a stdlib handler with per-scenario `Faults`): `truncated` (the
  server announces the full installer, sends half and closes -> `update_incomplete`, nothing left), `asset-missing`
  (signed feed, installer 404 -> `update_asset_missing`), `racing-clicks` (slow server, two clicks behind a barrier
  -> one download, `update_busy`, then ready). Disk full on the `.part` file stays a unit test (it needs a patched
  file write). The install step stays NOT RUN.
- **ADR-243** [M7.3 slice 2: deep research report; extends ADR-234] The deep research report (a stored K8 `report`
  doc) gets its fixed text - title, intro, PRISMA method lines, "insufficient material", trust line, contradiction
  and sources headings, RETRACTED / metadata-only markers, limitations boilerplate - from the core catalog
  (`content/texts.py`, codes `dr_*`; one catalog per package) in the run's `language` setting: `POST
  /research/deep` accepts `language` (`en` default, `zh-CN`; 422 `bad_language` otherwise), stored in the run's
  settings (part of the plan checkpoint hash, so it is approved with the plan); runs created earlier render in
  English. Sub-questions, statements, titles, aspect/status values and recorded error text are data and stay as
  written; `{{lit:...}}`, `{{cite:...}}` and `{{evidence:...}}` markers are identical in both languages. The
  backend scanner covers `research/deep_report.py` and now also flags Markdown bullet / italic-paragraph literals.
  Test: the end-to-end deep research run in en and zh-CN; the zh report has no English catalog text and passes the
  final-mode gates (numbers, citations) like the en one. The web has no deep-research create form yet (API only).
- **ADR-244** [M7.3 slice 3: fixed API error messages; extends ADR-221] Every literal message the API raises -
  `ApiError(status, code, "text")`, `not_found("what")` (= "what not found") and `conflict(code, "text")` - must
  have a row in the web's `i18n/apiErrors.ts` table: `tests/test_backend_i18n_scan.py` collects them from the
  Python AST and fails with the file:line of any missing one (the vitest locale-parity test then forces both
  translations). The scan found the 25 `not_found` subjects untranslated (projects, works, docs, runs, deep research
  runs, ...); they are added in en + zh-CN. Dynamic messages (f-strings, details) stay as sent, as in ADR-221.
- **ADR-245** [M7.3 slice 4: task stage codes; extends ADR-221] A task's `stage` is a code the host, the worker or a
  plugin sets (`ctx.progress("parsing", ...)`), not display text. The web (`i18n/taskStages.ts` `stageLabel`, used by
  the Tasks page) translates a known code under `taskStages.<code>` and shows any other stage (e.g. one a template
  reports, `epoch_7`) as sent; the protocol is unchanged. `tests/test_backend_i18n_scan.py` collects every literal
  first argument of `.progress(...)` in `services/api/researchos`, `workers` and `plugins` (plus the monitor's
  default `running`) from the AST and fails if one is missing in either locale. Test: `taskStages.test.ts` (known
  codes in en and zh-CN, unknown code raw).
- **ADR-246** [M7.3 slice 5: cited cards; extends ADR-234] The fixed text of the paper card, the methods checklist
  and the feasibility card - title prefix, field / tail / owner headings, "insufficient material" lines, the owner
  placeholder, the missing-conditions lines, the feasibility dataset lines and status-table header - comes from the
  core catalog (`card_<kind>_<key>`, `card_*`, `mc_*`, `fs_*`) in a per-request `language` (`CardIn.language`,
  `FeasibilityIn.language`; `en` default, `zh-CN`; part of the idempotent request payload). `CardSpec` no longer
  carries English headings: fields are `(key, question)`, tail sections and the owner section are keys, and
  `CardSpec.heading(T, key)` looks the text up, so the catalog is the one source. A field's `cited` flag now comes
  from whether a cited answer was inserted, not from the English prefix of the inserted text. Not translated:
  questions (model prompts), answers (model output), dimension names / status values and the computed feasibility
  reasons (recorded-fact messages; still English - open). The backend scanner covers cards.py, methods_checklist.py,
  paper_card.py and feasibility.py. Tests: the methods checklist end to end in en and zh-CN (same cited item,
  same gap order, no English catalog text in zh), the zh missing-conditions lines.
- **ADR-247** [M7.3 slice 6: gate diagnostics by code; extends ADR-221] Gate / export diagnostics already carry
  `{severity, code, message, ref}`. The web (`i18n/gateDiagnostics.ts`, used by the doc gate panel and the export
  result) shows the server message as sent in English (it has the most detail) and, in another language, translates
  a known code with its `ref` (`gateDiagnostics.<code>`) and the severity label; a code it does not know (e.g. a
  plugin's own diagnostic) falls back to the server message. The protocol is unchanged. `test_backend_i18n_scan.py`
  collects every literal code of the core gates (`gates.py`: `add(...)`, `Diagnostic(...)`, plus
  `evidence_missing` / `evidence_stale` from the f-string) and fails if one is missing in either locale. Plugin
  diagnostics (report_export, slides) are not in the table yet (raw fallback).
- **ADR-248** [M7.3 slice 7: zh-CN text scan; extends ADR-221] The UI review tooling has a scan mode
  (`scripts/ui_review.sh <out> --zh-text-scan`): it opens every page of the seeded instance in the zh-CN UI and lists
  visible Latin-script words (text nodes outside code/pre, placeholder, aria-label, title) that are neither data -
  a word seen in an API JSON response of that page (records, protocol values, model output) - nor in the
  `PROPER_NOUNS` list (product names, formats, units; ADR-221 keeps proper nouns untranslated). It writes
  `<out>/zh-text-scan.txt` and exits 1 if any word remains. It is a dev tool, not part of `check.sh` (needs Chrome
  and a running instance). Its first run found the toast region and close-button aria labels in English (the
  library defaults); `LocalizedToaster` now passes `common.notifications` / `common.close`.

## Codex review of M7b, findings #96-#100 (2026-10-28)
- **ADR-249** [review #96; fixes ADR-241] The update client followed redirects itself (`follow_redirects=True`), and
  httpx reads every intermediate redirect body whole before returning the final response, so a redirect with an
  endless body bypassed `_bounded`'s limit. The client no longer follows redirects; `updater._get(client, url)`
  follows at most `MAX_REDIRECTS` (5) by hand, closing each redirect response unread, and more raise
  `httpx.TooManyRedirects` (`update_network` / `update_mirror_failed` via `_mapped`). Feed, signature and installer
  all go through it. Tests: two redirects with endless bodies give the final 200 body with nothing pulled from them;
  six redirects end as `update_network`, nothing pulled.
- **ADR-250** [review #97; fixes ADR-230/Review #89] The path redaction matched only the literal, `/` and `\` forms of
  the data / install / home folders, so a Windows path whose backslashes were already escaped inside the text -
  `str(FileNotFoundError(...))` quotes the file name with `repr`, which doubles them, and JSON text does the same -
  reached the bundle unchanged. `Redactor` now builds one case-insensitive pattern per folder from its parts joined
  by `[\\/]+` (any run of either separator), so the plain, forward-slash, once- and twice-escaped forms all become
  `<label>`; the rest of the path keeps its separators. Tests: the four separator forms of one path; a real
  `FileNotFoundError` string with the Windows form of the data folder in `task_errors` leaves no trace of it in the
  bundle.
- **ADR-251** [review #100; fixes ADR-240] A failed confirm re-opened every suggestion of the document whose
  `decided_at` equalled its own, so a separate rejection taken in the same millisecond was re-opened too. Every
  decision now has a unique id (`dec_...`, new column `doc_identifications.decision_id`, core migration 0014),
  written on the decided suggestion and, for a confirm, on the open siblings it rejects; `_undo(decision_id)`
  re-opens exactly those rows. Test: with a fixed clock, reject A, then confirm B with failing linking - B is open
  again, A stays rejected.
- **ADR-252** [review #99; fixes ADR-240] The confirm decision was committed before the document was linked, so a
  process that ended in between left the suggestion confirmed and its siblings rejected while the document stayed
  unidentified, and every retry got 409 (the exception-path `_undo` cannot run in a terminated process). A confirmed
  suggestion is now final only once linked: new column `doc_identifications.linked_at` (core migration 0015), set
  together with the `library.identified` event in one transaction after the linking. A confirmed suggestion with
  `linked_at` NULL stays in the review queue (`pending` returns it with `status: confirmed`) and confirming it again
  returns its existing decision and finishes the linking, whose writes are idempotent per suggestion
  (`identify:<id>`, `identify:pdf:<id>`); reject still gets 409. The event is written once even if two retries
  race, and `_undo` leaves a decision alone once its linking finished. The migration backfills `linked_at` from the
  earliest `library.identified` event of the version; confirms stuck by this bug before the upgrade have none and
  so become finishable. Test: decide a confirm, then on a fresh connection the suggestion is queued, confirm links
  the document (siblings stay rejected), a further confirm is 409 and the event exists once.
- **ADR-253** [review #98; fixes ADR-239] Importing consumed the import approval and then ran the whole (possibly
  long, PDF-downloading) import without renewing its lease, so a replacement advance could take over, found the
  approval consumed and stayed `awaiting_import_approval`, while the original's fenced `move()` dropped the imports
  it had done. Now the approval is consumed and recorded in the run (`data.import_authorized`) in one transaction
  (`consume_approval` joins the caller's transaction; `store.save(join=True)`, a lost lease rolls both back), and the
  selection is imported one candidate at a time with a `renew()` before and a progress `save()` (`data.imported`)
  after each. An advance that finds `import_authorized` skips the approval and imports only the candidates not yet
  in `imported`; a candidate imported but not yet saved when the lease was lost is imported again idempotently
  (`cand:<id>` work key, "reused"; its open-access PDF may be fetched again). Test: the lease expires during the
  first candidate and a replacement advance takes over - it finishes the import to `reading` without a second
  approval (one approval consumed, each candidate once), the original ends on its lost lease, and the run
  completes.

## Codex review of the M7b fixes, findings #101-#102 (2026-10-28)
- **ADR-254** [review #101; fixes ADR-252] A confirm and its retry (ADR-252) share one decision, so when one of two
  overlapping attempts failed before the other finished, its `_undo` re-opened the suggestion and its siblings, and
  the other then set `linked_at` on a suggestion that was `suggested` again (open to a conflicting decision while
  the document was linked). Every confirm now takes a new attempt id on the suggestion (`attempt_id`, core
  migration 0016; a retry takes the linking over); `_undo(ident, attempt)` re-opens the decision only while that
  attempt owns it and the linking has not finished. A successful linking ends in `_finish`: once, with the
  `library.identified` event; if an attempt that owned the linking failed meanwhile and re-opened the suggestions,
  the success takes the decision again (siblings rejected) since the document is linked, and gets 409 only if the
  owner decided the document otherwise in between (the link then stays as made - not undone). Tests: two
  threads, same suggestion - the first attempt fails while the retry is still linking (nothing re-opened, the
  retry finishes), and the retry fails while the first is still linking (re-opened, then taken again by the
  first); both end confirmed + linked, sibling rejected, one event.
- **ADR-255** [review #102; fixes ADR-251/252] A confirm interrupted before core 0014 kept `decision_id` NULL;
  0015 made it retryable, but a failed retry ran `_undo` on a NULL decision, which matched nothing: the suggestion
  stayed confirmed, reject was 409 and no other candidate could be chosen while the linking kept failing. Core
  migration 0017 gives each unfinished confirm without a decision id its own (`dec_legacy_<id>`), and the same id to
  the rejected siblings of the same document with the same `decided_at` and `decided_by` (before 0014 a confirm
  wrote one timestamp and actor on the suggestion and on the siblings it rejected); a rejection with another time
  or actor was a separate decision and stays rejected. As a fallback, `_decide` gives a resumed confirm that still
  has no decision id a new one (the suggestion alone can then be re-opened). Test: the pre-0014 state (confirmed +
  same-decision sibling, plus an older independent rejection) upgraded with 0017, the resumed linking fails - both
  of that decision are open again, the older rejection stays; then reject works and the other candidate can be
  confirmed and linked.

## M8 UI polish (2026-10-29)
- **ADR-256** [M8 tooling; fixes ADR-248] The review tooling signed in and reloaded at once, but the query cache
  (auth state included) is persisted to IndexedDB at most once a second and restored on reload within its 15 s
  staleTime, so the first pages after sign-in reloaded into the signed-out state: the zh text scan reported the
  sign-in screen as "clean" for them (ADR-248's 14 clean pages were partly that) and screenshots showed it. `login()`
  now waits 1.5 s after sign-in, every scanned / captured page asserts the sign-in form is absent, and the scan pools
  data words over every API response from sign-in on (a page restored from the cache fetches nothing itself) and
  skips textarea content (JSON the user edits). New `--matrix` mode: every page in en and zh-CN at 1440x900,
  1024x768 and 768x1024 (`<lang>-<view>-<page>[-full].png`) plus an overflow check - the page must not scroll sideways
  and no visible element may extend past the viewport unless a scrolling / clipping ancestor holds it; it writes
  `overflow.txt` and exits 1 on any overflow. Still a dev tool outside `check.sh` (needs Chrome + an instance).
- **ADR-257** [M8 layout + labels; extends ADR-245] Found by the matrix and the fixed zh scan. (1) Between md and lg
  (iPad portrait, 768) the sidebar is a 4.5 rem icon rail - labels stay for screen readers (`sr-only`) and as the
  link title, the product name moves to the header - so the content gets 696 px instead of 552; lg and up keep the
  full sidebar. (2) Key/value details (`JsonDetails`) use `minmax(6rem,12rem)` label columns (`5rem..10rem` when
  nested) and a `minmax(0,1fr)` value column with `overflow-wrap: anywhere`, and the plan's content hash wraps, so
  hashes and ids no longer push the plan page sideways at 768. (3) `PageHeader` drops its bottom margin inside a grid
  parent (the gap was doubled on the plan, run, study and literature pages). (4) `codeLabel(group, code)` (the ADR-245
  helper, generalised) translates document kinds (`docKinds`; project page, document editor) and answer sentence
  kinds (`sentenceKinds`; research page) with a raw fallback; `test_backend_i18n_scan.py` keeps every core doc kind
  and every `qa_validate.KINDS` value in both locales. (5) Format examples that must be typed as they are - the gap
  map axes and the venue tier JSON - are shown as `<code>` after a translated explanation instead of as the whole
  zh hint. Tests: `taskStages.test.ts` (doc / sentence kinds in zh, unknown raw), the backend scan test.

## Codex review of the #101-#102 fixes, findings #103-#104 (2026-10-29)
- **ADR-258** [review #103; fixes ADR-254] The ownership check (`_finish`) ran after the relink: attempt A paused
  before attaching, its retry failed and re-opened the suggestions, the owner confirmed candidate B (linked), and A
  then moved the document to A's work (and, its work emptied, deleted B's work and moved its identifiers) before
  `_finish` answered 409 - B confirmed with its event while the document pointed to A. `DbKnowledgeWriter.
  attach_original` takes an optional `guard` (host only, not in the plugin contract) that runs first inside the
  relink transaction; `confirm` passes `_finish` (now `tx(join=True)`), so the decision check, `linked_at`, the
  `library.identified` event and the relink commit together or not at all - a 409 leaves B's link untouched. The
  `_finish` after the attach stays for a linking replayed (idempotency key) from before this fix; it is a no-op once
  linked. The work A's `upsert_work` created may stay without a document (as on any failed link). Test: that
  interleaving with threads - A gets 409, the document stays on B's work, B confirmed + linked, A's suggestion
  rejected, one event.
- **ADR-259** [review #104; fixes ADR-255] Core 0017 gave a legacy unfinished confirm's decision id also to every
  rejection of the document with the same `decided_at` and `decided_by`, but a separate rejection by the same actor
  in the same millisecond looks exactly like a sibling the confirm rejected, so a failed retry could re-open a
  rejection the owner made on purpose. Before 0014 nothing recorded which rejections a confirm made (no event, no
  id), so there is no reliable provenance: 0017 now gives the decision id to the unfinished confirm only and leaves
  every legacy rejection rejected. A failed resumed linking re-opens just the confirmed suggestion (reject then
  works, as in ADR-255); its former siblings stay rejected, so such a document's other candidates are not offered
  again (it stays unidentified in `_unsorted`). 0017 is changed in place: 0014-0017 were added after the last
  installer build (0.1.3, 2026-10-28 01:40) and never shipped. Test: the pre-0014 state with the sibling and an
  independent rejection at the same timestamp and actor - after 0017 only the confirm has a decision id; the failed
  resumed linking re-opens only it; both rejections stay rejected (confirming them is 409).

- **ADR-263** [macOS build, step 1; owner scope: Apple Silicon only] Platform layer for a bundled Mac install.
  `platform.IS_MACOS`; `platform/macos.py` holds pure path rules: an app root of `<X>.app/Contents/Resources/app` is a
  bundled install, whose data defaults to `~/Library/Application Support/ResearchOS` and logs to
  `~/Library/Logs/ResearchOS` (both outside the bundle, so replacing the .app on update keeps them); a dev checkout
  on a Mac keeps `<repo>/data` as on Linux. The home comes from the password database (`pwd`), not `$HOME`, because
  the trusted processes point HOME into the data dir after start. Settings gets `log_dir` ("" = `<data_dir>/logs`,
  env `RESEARCHOS_LOG_DIR`); `logs_dir` follows it. To let `kernel.config` use these rules, import-linter now layers
  `kernel > platform` (platform imports nothing from kernel; before, the two were independent siblings).
  `process.detached_kwargs()` is the one place for "own process group": Windows hidden + new group (+ breakaway from
  the job for the update helper), POSIX `start_new_session=True`; `spawn()` and the update helper use it, so the
  Windows flags are unchanged. Tested on Linux with a fake home; macOS NOT RUN.
- **ADR-264** [macOS build, step 2] `scripts/build_mac_app.py` assembles `ResearchOS.app` for Apple Silicon only
  (owner scope; no x86_64 pin): `Contents/Info.plist` (no LSUIElement, so a Dock icon), `MacOS/ResearchOS` =
  `packaging/macos/launcher.sh`, `Resources/python` = python-build-standalone CPython 3.12.15 `install_only`
  (release 20261021, sha256 pinned from the release's SHA256SUMS and checked on download), `Resources/app` =
  `build_package.stage_app()` (the Windows file list, one source; its manifest carries the Mac acceptance status),
  `Resources/ResearchOS.icns` built from the PNGs inside the .ico (stdlib only). Like Windows, the app is source on
  the path (a relative `.pth` in site-packages), not an installed wheel. Dependencies: `win_runtime.requirements()`
  (now parametrized by target triple) for `aarch64-apple-darwin` plus the plugin wheels (`win_runtime.
  project_wheels()`, shared), installed with `uv pip install --python <bundled> --no-deps`; the build fails unless
  the newly installed set equals them. Bytecode is compiled at build time (checked-hash) and the launcher sets
  PYTHONDONTWRITEBYTECODE, so nothing writes into the signed bundle. Then `codesign --force --deep -s -` (ad-hoc, no
  account, not notarized), `ditto -c -k --keepParent` -> `ResearchOS-<v>-mac-arm64.zip` (update asset), `hdiutil`
  -> `.dmg` with an /Applications link, a `.sha256` per asset and a `.build.json`. The launcher reuses
  `scripts/start.sh` (which now takes `RESEARCHOS_PYTHON` and `RESEARCHOS_LOG_DIR`) and `stop.sh`: already
  answering -> `open` the URL; else start detached, wait up to 90 s for `/api/v1/health`, show the first-run setup
  token in a dialog (copied with pbcopy), open the browser; errors -> dialog + `launcher.log`.
  `RESEARCHOS_HEADLESS=1` skips dialog and browser (CI smoke). The URL is fixed at http://127.0.0.1:8443 in this
  first version. Tests stub codesign/ditto/hdiutil/the bundled Python; the launcher was run once on Linux with a
  fake bundle (server up, data/logs in the Library paths, second start only opens). macOS NOT RUN.
- **ADR-265** [macOS build, step 3] `.github/workflows/mac-build.yml`: `workflow_dispatch` + push of a `v*` tag, one
  job on `macos-15` (arm64; no matrix, no Intel runner, owner scope), `permissions: contents: read`, no secrets, no
  release step. Steps: web build (pnpm 10.34.6, node 20.19.2, frozen lockfile), `build_mac_app.py`, then a smoke
  test of the built zip as a user would get it: `ditto -x -k`, `codesign --verify --deep --strict`, the launcher
  with `RESEARCHOS_HEADLESS=1` and a temporary HOME, `/api/v1/health` must report the built version, `doctor`
  (fails only on FAIL items), the database exists, `stop.sh`; logs are printed even on failure. Uploads zip, dmg,
  `.sha256` and the build json as workflow artifacts only; the maintainer downloads and verifies them, signs
  latest.json on the maintainer machine and uploads (the Ed25519 key never reaches CI). Third-party actions are
  pinned to the commit of their current release tag (resolved with `git ls-remote` on 2026-10-30). The export is a
  deny list, so the workflow ships with the public export; it passes the leak scan (a test asserts it is not
  denied). Pushing it is the owner's step. Static tests on Linux; the workflow itself is NOT RUN (macOS NOT RUN).
- **ADR-266** [macOS build, step 4] Multi-platform update feed, backward compatible. latest.json keeps its top level
  exactly (`version, asset = ResearchOS-Setup-<v>.exe, sha256, url, notes, notes_zh`, same key order; a Windows-only
  release is byte-identical to before) and may add `platforms: {"darwin-arm64" | "darwin-x86_64": {asset, sha256,
  url}}` (the schema keeps the x86_64 key; only arm64 is built). The one Ed25519 signature still covers the whole
  file. `parse_release(..., platform)`: the top level and every known entry must pass the same rules (sha256 hex,
  https or loopback http, the feed's own host, path ending in the asset, asset = `asset_name(v, platform)` =
  `ResearchOS-<v>-mac-<arch>.zip` for Mac); unknown keys are ignored so a later feed can add platforms. A Mac client
  (`current_platform()` = `darwin-<arm64|x86_64>` from the CPU) returns its entry; a missing entry is the new code
  `update_platform_missing` (HTTP 409, en/zh UI strings) and never falls back to the .exe; every other platform
  reads the top level as before. A regression test parses new feeds with a frozen verbatim copy of the 0.1.4
  parser (`tests/fixtures/update_feed_v0_1_4.py`, from release/v0.1.4 d9434ff): it still gets the exe; 0.1.3 reads
  the same top-level keys without a signature. `manifest.py --mac-zip <zip>` (next to the exe; name gives the key)
  fills `platforms`, writes a .sha256 per asset and checks the signed feed for every platform; `publish.py`
  uploads the zips the feed names with their .sha256 and checks each against the feed. Signing stays on the
  maintainer machine.
- **ADR-267** [macOS build, step 5] One-click install on a Mac. `platform.macos.updatable_bundle()` gives the `.app`
  the updater may replace: an app root of `<X>.app/Contents/Resources/app`, not under `/Volumes` (run from the dmg)
  or `…/AppTranslocation/…` (Gatekeeper's read-only copy), with a writable parent folder; otherwise `can_install` is
  false and install answers `update_unsupported` (the owner drags the new version into Applications). The updater
  dispatches the helper by platform (Windows command unchanged) and on a Mac copies `scripts/apply_update.sh` next
  to the verified zip and starts `/bin/sh apply_update.sh <zip> <app> <server pid> <version> <health url> <data dir>
  <log>` detached (own session, `child_env`: no keys; the data dir is an argument because the helper's environment
  carries no RESEARCHOS_* variables). The helper mirrors ADR-229: stop the app (its stop.sh with the data dir), wait
  up to 60 s for the server PID, `ditto -x -k` into `<parent>/.ResearchOS-update-<v>`, refuse unless the unpacked
  app's pyproject version is the expected one (nothing changed, current app reopened), keep the current app as
  `<app>.prev`, move the new one in, `open` it, poll the health URL for the new version (120 s); healthy -> remove
  `.prev`; else stop, keep the new app as `<app>.failed`, restore `.prev`, reopen; log `<logs>/update.log` (the
  diagnostics bundle already collects it). A zip the app downloaded itself carries no quarantine flag, so the
  replaced app opens without the Gatekeeper prompt (macOS NOT RUN). `e2e_check.py` gains mac-signed /
  mac-tampered / mac-rollback: a fake .app (version file + the real stop.sh) in a temp Applications folder, a fake
  app server, stand-ins for `ditto` (unzip) and `open` (starts the fake server), the real Updater and the real
  apply_update.sh; the captured command's server PID is the fake server's (in the app the updater runs inside the
  server). The Mac scenarios live in `e2e_mac.py`, shared parts in `e2e_common.py` (the 400-line limit). Runs on
  Linux in the test suite; the real ditto/open/Gatekeeper path is macOS NOT RUN.
- **ADR-270** [macOS build, Codex review of steps 4-6] Hardening of the Mac update helper (`apply_update.sh`) and
  the Mac CI log. (1) Zip integrity at unpack time: the downloaded zip was verified once, but the helper unpacked
  whatever file lay at that path later. `Updater` now passes the signed feed's sha256 as the helper's 8th argument;
  the helper copies the zip into a private `mktemp -d` dir (mode 700), hashes the copy (`shasum -a 256`, the e2e
  box's `sha256sum`) and unpacks only that copy, and only if the digest equals the argument. A missing or malformed
  digest, or a different one, gives up before `ditto` runs: nothing unpacked, nothing changed, the current app is
  reopened (exit 1). The check runs after the server stopped (the existing "any failure before the swap" path), so
  the app restarts with a fresh update state instead of sitting in "installing". The helper is copied from the
  installed app, so old and new argument lists never mix. e2e: `mac-zip-swapped` (the verified zip replaced after
  the download by a same-version zip with one extra file) and `mac-no-digest`: exit 1, `ditto` never called (the
  stand-in logs its calls), no extra file anywhere, the old app intact and answering, update.log says why.
  macOS NOT RUN: real `shasum`/`ditto` only on a Mac; on Linux the stand-ins and `sha256sum` are used.
  (2) Rollback waits for the failed version: `stop.sh` only sends SIGTERM and drops the pid files, so a slow server
  could still answer health requests and make the restored app's launcher skip starting it. The helper reads the
  API + worker pids first, runs stop.sh and waits until all have exited (`STOP_TIMEOUT_S`, 60 s; the first stop
  also waits for the worker now). Never SIGKILL (a server killed mid-write could damage the database): still
  running after the timeout -> nothing is moved, update.log says so and names the pids, exit 3. After the restore
  the helper polls the health URL for the previous version (read from the app before the swap) and logs "health
  check after rollback OK" (exit 2) or that it does not answer (exit 3). Exit codes: 0 updated, 1 nothing changed,
  2 rolled back and answering, 3 needs a look. e2e `mac-rollback-slow`: the new fake app answers with a wrong
  version and exits 3 s after SIGTERM; the restore waited >= 2 s and the old version answers (with the previous
  script the restored app could not bind the port and nothing answered). The plain rollback also checks the
  restored version's health line.
  (3) Every move is checked and the log tells the real state. Swap: if moving the new app in fails, the current app
  is moved back and only then is it "nothing changed" + reopen; if that recovery move fails too, update.log names
  where the old app (`<app>.prev`) and the new one (the unpack dir, kept) are, says nothing is at `<app>`, asks to
  move `.prev` back by hand, and nothing is opened (exit 3). Rollback: a failed move of the new app aside, or of
  `.prev` back, logs "rollback failed: ..." with the same facts, never "previous version restored", opens nothing
  and keeps `.prev` / `.failed` (exit 3). e2e: `mac-rollback-mv-fail` and `mac-swap-mv-fail` inject the failure with
  an `mv` stand-in on PATH (`E2E_MV_FAIL` source globs); the `open` stand-in logs its calls, so "not opened" is
  checked by count; with the previous script both scenarios fail (false "restored", extra `open`, unpack dir gone).
  (4) Mac CI log: start.sh prints the smoke instance's first-run setup token into launcher.log, which the
  always-run "Logs of the smoke test" step dumped into the public Actions log. The step now prints the logs through
  `sed -E 's/([Ss]etup [Tt]oken:).*/\1 [redacted]/'` (BSD and GNU sed); start.sh is unchanged because on Linux its
  output is the owner's way to get the token. `tests/test_mac_app.py` runs the step's own command on fake logs and
  checks the token is gone and the other lines stay; the existing test keeps every `uses:` pinned to a 40-hex
  commit. macOS NOT RUN: the step itself only runs on the macos-15 runner (here: sh + GNU sed).
  (5) The 0.1.3 parser, found: 0.1.3 has no `update_feed.py` (the review looked for that file); its feed parser is
  `parse_release(raw, feed_url)` in `services/ops/updater.py` at 2400c6c "chore(release): version 0.1.3", and it
  checks no signature (signing came with ADR-228, 626d697, later the same day). Evidence that this is what shipped:
  there is no v0.1.3 tag or release branch; ADR-259 records the last installer build as 0.1.3 at 2026-10-28 01:40;
  2400c6c is from 01:17 and the next commit on master (76c24a3) from 08:42, so the build can only be 2400c6c.
  `tests/fixtures/update_feed_v0_1_3.py` is a verbatim copy of its lines 38-120 (constants, UpdateError, Release,
  URL rules, `asset_name`, `parse_release`, `is_newer`; only the imports reduced). It reads `version, asset, sha256,
  url, notes` and ignores other keys. Tests: a feed with both `platforms` entries and the feed `manifest.py
  --mac-zip` writes both give 0.1.3 (and the frozen 0.1.4 parser) the .exe, same asset / sha256 / url as today's
  win32 reading, within 0.1.3's 256 KiB feed limit.
- **ADR-271** [macOS build, first real CI run] The first run of `mac-build.yml` (run 41572280122, macos-15 arm64)
  stopped in `build_mac_app.py install_deps()`: "installed set differs from uv.lock" listing all 7 plugin wheels.
  Cause: `uv pip freeze` prints a distribution installed from a local wheel file as `name @ file:///...whl` (no
  `==`; reproduced here with uv 0.13.5 on Linux), and `freeze()` kept only `==` lines, so the plugins were never
  "installed" while `want` had `name==version` for them. The lock pins matched, which is why only the wheels were
  listed. Fix: the installed set is read with `uv pip list --python <py> --format json` and compared as (PEP 503
  normalised name, version) pairs; each lock pin must be an exact `name[extras]==version` (anything else stops the
  build: "not an exact pin"); the newly installed set must still equal pins + wheels exactly, and a mismatch names
  each pair as missing or extra. Tests (`tests/test_mac_app.py`): a fake uv that answers `freeze` in the real
  `@ file://` form for wheels (and `==` for the rest) and `list --format json` with name + version; failing first
  on the old code with the CI message; extra / missing / wrong-version cases still fail; a differently spelled
  installed name (Ruamel.YAML vs ruamel-yaml) matches. Also run for real on Linux: `install_deps` with real uv into
  a fresh venv, 2 lock pins + all 7 plugin wheels built by `uv build --all-packages`: equal.
  Review of the steps after it, by reading and by Linux rehearsal (macOS NOT RUN): the smoke sequence (headless
  launcher -> health version -> `doctor` -> db file -> `stop.sh`) was run with the unchanged launcher in a fake
  bundle (Resources/python -> the dev venv, Resources/app -> the checkout, fresh HOME): launcher 0, health version
  = pyproject version, doctor exit 0 on a fresh install (only WARN / NOT RUN besides PASS: loopback, low-priv
  worker, GPU, torch, gpu_preflight), db at `db/researchos.db`, both processes stopped; the setup token appears
  only in launcher.log and the dump step's sed removes it. `compileall` (non-zero on any syntax error) has nothing
  to fail on in the dev venv's site-packages or the 262 app .py files. No other defect found that could be proved
  without a Mac; nothing else changed.
