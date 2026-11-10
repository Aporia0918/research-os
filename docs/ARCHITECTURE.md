# Research OS — Architecture v1 (FROZEN)

Status: frozen 2026-10-11 after seven design rounds. Contract version **core 1.8.0** (additive: 1.1 TaskContext.run_id, 1.2 plugin extension protocols, 1.3 `zotero` IdScheme + ToolError + owner-managed secret plugin settings, 1.4 CitationGraphSource / RetractionSource / OaResolver, 1.5 DatasetBuildContext.local (`files:read`), 1.6 privacy ports PhiInspector / Pseudonymizer, 1.7 DatasetDescriptor.egress, 1.8 ToolSpec.derived_from_args; ADR-051, ADR-062, ADR-083…085, ADR-089, ADR-155, ADR-158, ADR-159, ADR-171; plugin guide: PLUGIN_DEV.md).
Authority: this file; changes and rulings are recorded in DECISIONS.md.
Conflicts and their rulings: DECISIONS.md. All numeric thresholds below are **proposed targets, not measured results**.
Windows / GPU / iPad acceptance = NOT RUN.

## 0. Purpose and non-goals

Purpose: a personal, daily-use research agent for one researcher on their own laptop (Windows + Linux, CPU-first,
GPU optional), reachable from desktop browser and iPad via one PWA. Foundation, in priority order:
**data accuracy and scientific rigor** > working end-to-end loop (import → cited QA → plan → controlled run →
diagnosis → report) > stable extensible core > routing/cost control > cross-device polish.

Non-goals (v1): multi-user; public internet exposure; vector DB; unattended execution of unreviewed or LLM-written
code; general sandbox claims; native desktop shell; large local LLMs; hospital/clinical integration (medical work
plugs in later via generic adapters only); scraping services whose terms forbid it (Google Scholar), shadow libraries
(Sci-Hub), or logging into any account on the user's behalf (CNKI etc. = user-exported files only).

## 1. Freeze rules

- K1-K9 below are the only core contracts. Each has a semver version; the core version is their max.
- **Additive-only**: new registry entries, new optional fields, new entity/doc/artifact types and new plugins never
  require an ADR. Any removal, rename, semantic change or new required field = breaking = ADR in DECISIONS.md +
  major version bump + migration + updated conformance suite.
- "Zero core change" is the goal for features; "no breaking core change" is the measurable guarantee.
- Plugins declare the core contract versions they target; incompatible plugins are refused at startup.

## 2. Core contracts K1-K9

Layering: `contracts` (pydantic types + Protocols, no I/O) ← `kernel` (K1) ← `services` (K2-K9) ← `api` ← `app`.
Plugins import only `researchos.contracts` and the template/plugin SDK.

### K1 Store & Domain
- Responsibility: the SQLite store (WAL, FKs on, explicit `BEGIN IMMEDIATE` write transactions), numbered migrations,
  typed kernel tables, generic entities/relations, identifiers, quantities, trust status, event log, provenance index.
- Key types: `Project`, `Work` (kind via registry: article, review, preprint, thesis, patent, report, book, dataset…),
  `Identifier(scheme, value)` (doi, arxiv, pmid, isbn, cnki, zotero, lens…), `DocumentVersion`, `Dataset`
  (`license`, `governance` JSON validated by schema, `storage` = internal blob | external reference + manifest hash),
  `EntityType` registry (JSON Schema per type; Claim, ClaimRelation, Author, Venue, Concept, Todo,
  ScreeningDecision, SavedSearch, Diagnosis… are registered types), `Relation(src, type, dst, attrs)`,
  `Quantity(value, unit, source_ref)` (pint units), `TrustStatus`, `Event`, `ProvLink`.
- Invariants: every state change writes its Event in the same transaction; events are append-only with monotonic
  `seq` and are the sole source of truth for sync/audit; `ProvLink` (wasDerivedFrom / wasGeneratedBy /
  attributedTo) is an index materialized in the same transaction; stored file paths are relative to `data_dir`
  (POSIX form); timestamps UTC (Asia/Shanghai only for budget months); plugins never alter core tables; Work merges
  by hard identifier only, fuzzy matches are suggestions.
- Rule for persistence style: facts with invariants (Task, Run, Evidence, Ledger, Approval, Effect) = typed tables;
  everything else = registered entity types.
- NOT in K1: business workflows, HTTP, files outside `data_dir`.

### K2 Orchestration
- Responsibility: the single Task/Run state machine; child tasks; triggers (manual, cron, event); resource queues;
  leases; idempotency; durable event consumers (cursor per subscriber); notifications as a consumer + channel.
- States: draft → awaiting_approval → queued → running → succeeded; cancelling → cancelled; failed; interrupted;
  blocked. Transition table enforced server-side, each transition checks preconditions and emits an event.
- Key interfaces: `TaskKind` registry (`deep_research`, `sweep`, `trial`, `agent_run`, `parse_document`,
  `effect_apply`, …), `Trigger`, `ResourceClass` (gpu = serial, cpu, llm = one paid call in flight, network per-host).
- Invariants: clients can never set success; same idempotency key (generated per user intent and persisted by the
  client) = one logical task; worker lease with monotonic generation fences stale workers; at-least-once claim +
  idempotent artifact publish (no exactly-once claim); worker refuses to start if migrations are pending; DAGs,
  AgentRuns and Sweeps are Task kinds, never separate orchestrators.
- NOT in K2: what a task does.

### K3 Approval & Policy
- Responsibility: one approval mechanism; autonomy rules (§8); capability manifests; data classification + egress.
- Key types: `Approval(subject_type, subject_hash, scope, limits, expires_at, device_id, reauth_required)`;
  `ApprovalSubject` registry (plan, plan_revision_widening, final_eval, effect_plan, spend_over_budget,
  premium_call, plugin_install, connector_enable, external_publish, research_checkpoint, …); `Capability`
  (network domains, file roots, model tiers, executor kinds, cost); `DataClass` registry (public, private,
  sensitive, phi, … extensible) with egress rules (cloud model, remote executor, export).
- Invariants: changing the subject changes its hash and voids the approval; offline approvals never auto-apply;
  agents/models can never change budgets, permissions or policies; `human_checked` can only be set by a user action.
- NOT in K3: UI, the actions themselves.

### K4 Effects
- Responsibility: every side effect outside `data_dir` (local file operations, external publishing, write-back to
  external systems such as Zotero).
- Lifecycle: `EffectPlan` (typed ops with preconditions) → deterministic validation → dry-run diff → approval (K3)
  → journaled apply (intent row before, result row after, in SQLite) → post-condition verification → undo or
  compensation from the journal.
- Invariants: never overwrite; never permanently delete (trash only); every op re-checks preconditions immediately
  before running; undo validates current state against the journal and reports conflicts instead of forcing.
- NOT in K4: writes inside `data_dir` (K1), executing programs (K5).

### K5 Execution & Experiments
- Responsibility: `Executor` protocol (`prepare / start / poll / cancel / collect`), Platform adapter (§9),
  `RunBundle`, template registry with reviewed hashes, template SDK (§6.2), search strategies and experiment designs,
  the 6-stage study protocol (§6.4), split contract.
- `RunBundle`: the materialized input directory + manifest (data hashes, split hash, params, seed, template hash).
  **Executors never receive raw dataset paths**; test data are never materialized before freeze.
- Invariants: only reviewed templates run (hash match, else `blocked`); honest device label (cpu / cuda:<name> /
  remote:<host>), CPU fallback flagged `degraded`; resource guard, wall-clock limit (≤90 min/task) and cancel live
  outside the experiment process; experiment processes cannot write the control-plane DB or see API keys; widening
  a search space, changing metric/data/code = new plan revision + new approval; narrowing inside the approved space is
  allowed automatically; `final_eval` executes once.
- Low-privilege identity: `run_as` setting (separate OS user) + doctor check; status shown as NOT CONFIGURED until
  the owner creates the account. Always-on guards regardless: test data not materialized, sample-ID provenance check,
  reviewed templates.
- NOT in K5: statistics and diagnosis (K9).

### K6 Model Gateway
- Responsibility: provider adapters (DeepSeek, Zhipu/GLM, Qwen/DashScope, Anthropic, OpenAI), router, budget ledger, prompt-template
  registry (versioned, hashed), tool registry, model/prompt certification, bounded `AgentRun`.
- Tiers by **cost class**: routine = DeepSeek V4 + GLM (incl. GLM OCR / vision); premium = Claude + OpenAI/Codex;
  emergency fallback per MODEL_ROUTING_SPEC only; global premium switch; per-task manual "use highest model".
- Router: rule table over task type, validation failures, evidence complexity, remaining budget and a **composite
  confidence** (deterministic validators, retrieval coverage, optional self-consistency, capped self-report).
  Thresholds 0.60/0.85 apply to the composite only. Hard rules override: 2 validation failures → escalate;
  self-report alone never triggers premium nor bypasses a failed validator; budget can veto escalation (downgrade);
  task type caps escalation level; manual force-top allowed. Before/after routing records persisted with components.
- Ledger: cost items of kind `model_call | compute | other`, each `reserved → settled | unknown | released`, reserved
  in a DB transaction; available = monthly cap − settled − open reservations; unknown price, unknown FX or effective
  price > 1.3× official → reject; timeouts keep `unknown` (no release + retry); settlement deduplicated by provider
  response id; month boundary Asia/Shanghai; 80% soft warning; at cap only paid calls stop.
- Certification: every (model id, prompt hash) pair starts `unevaluated` and cannot serve evidence-bearing tasks
  (QA, extraction, screening) until an EvalRun passes §5.4 thresholds (owner override is allowed and labeled).
- AgentRun: max steps, max cost, allowed tools; tool calls with side effects go through K4; document/web content is
  data and never widens permissions.
- Invariants: all model calls go through the gateway; keys only in the backend (env or `data/config/secrets.env`),
  never in frontend, git, logs, reports or experiment environments; model IDs and prices are config data marked
  `verify` until the owner confirms.
- NOT in K6: retrieval, document parsing.

### K7 Knowledge
- Responsibility: `DataSource`, `Importer`, `Parser` (versioned; per-page quality flags; `section_role`
  TAIMRD; `chunk_kind` text/figure/table/equation/caption), HTTP fetch service (per-host rate limits, cache,
  SSRF guard blocking localhost/intranet), `Chunk`, `Evidence`, `Retriever`, `Indexer`.
- Evidence selector (W3C Web Annotation style): source + one or more selectors — `TextQuote`, `PageBBox`
  (physical page, printed label, bbox, coordinate system, rotation, page size), `Fragment`, `RunMetric`,
  `TimeRange`. Chunk id = hash(version_id, parser_version, page, offset).
- Invariants: **single validated write path** — an Evidence row exists only if its quote matches the source text
  after normalization (deterministic); numbers in an extracted value must occur in its quote; parser upgrades create
  new chunks and old evidence stays on the old version (flagged possibly stale); FTS uses the `trigram` tokenizer
  (CJK-capable; jieba segmentation = plugin); retrieval = FTS + metadata first, vectors only as an optional plugin.
- NOT in K7: generating prose.

### K8 Content & Artifacts
- Responsibility: authored documents, artifact types, content-addressed blob store, exporters.
- Key types: `DocType` registry (note, note_template, question_set, mindmap, evidence_matrix, report, manuscript,
  deck, cover_letter, review_response, …), `Doc` (typed blocks, revisions, suggestion mode, embedded citations
  `{{cite:citekey}}`, number placeholders `{{metric:…}}` / `{{evidence:…}}`), `ArtifactType` registry (MIME, schema,
  viewer id, validators), `BlobStore` (sha256-addressed, temp → verify → atomic publish), `Exporter`.
- Invariants: export blocked if any citation is unresolvable or any free number lacks a source (configurable to warn
  for drafts); M0 "notes" are Doc kind `note`.
- NOT in K8: verification logic (K9).

### K9 Verification
- Responsibility: `Checker` (docs/artifacts), `Detector` (runs), `Verifier` (metric recomputation / invariants),
  `Analyzer` (statistics, sensitivity, figures as spec + data), eval suites, trust propagation.
- Outputs: `Finding` / `HealthSignal(detector_id@version, severity info|warn|fail, rule, value, threshold, selector)`.
  Severity → gate mapping is policy data (fail blocks downstream use; warn labels).
- Invariants: detectors/checkers are read-only and their only output is signals; statistics are computed only by
  deterministic code (never by an LLM); every detector/verifier is versioned and covered by the canary sweep.
- NOT in K9: acting on findings (K2/K3 do).

## 3. Engineering conventions (not contracts, but CI-enforced)

- Entry-point groups `researchos.*`: routers, entity_types, doc_types, artifact_types, datasources, importers,
  parsers, retrievers, indexers, providers, tools, prompts, executors, templates, search_strategies, designs,
  detectors, verifiers, analyzers, checkers, exporters, effects, approval_subjects, triggers, channels, settings.
- Plugin manifest: name, version, target core contract versions, required capabilities, settings JSON Schema,
  migration namespace. Plugin install/enable needs approval (K3); no auto-install.
- Migrations: `core/NNNN_*.sql` and `plugins/<ns>/NNNN_*.sql` (tables prefixed `p_<ns>_`); only the API/CLI migrates;
  auto-backup before migrating a non-empty DB; no downgrades (restore from backup instead).
- API: `/api/v1`, additive only; breaking → `/api/v2` in parallel; plugin routes under `/api/v1/x/<plugin>/`;
  errors `{code, message, retryable, correlation_id}`; writes carry `Idempotency-Key`; updates carry revision (409);
  long work → 202 + task id; `packages/contracts/openapi.json` snapshot diff reviewed; TS types generated from it.
- Frontend plugins are registered at build time (no runtime JS loading; CSP); generic views render from JSON Schema.
- UI text: every user-visible frontend string goes through i18next `t()` with keys in the bundled zh-CN / en
  resources (parity and hard-coded-text tests in CI); host messages are translated only by known fixed error code,
  otherwise shown as sent; the API stays language-neutral (ADR-221).
- Anti-spaghetti gates (CI fails on any): import-linter layer + independence contracts (no cycles, plugins only see
  `contracts` + SDK); ≤400 lines per file; ruff incl. C901 ≤ 10; mypy strict for `contracts` and `kernel`;
  eslint + `tsc --strict`; per-module test directories; **conformance suites** (abstract pytest suites per extension
  point, e.g. ExecutorConformance, DataSourceConformance, DetectorConformance) run against every installed plugin;
  **arch-health job** reports largest files, cycles, dead code, TODO count, OpenAPI diff.
- Registries are built once at startup and immutable afterwards; no global mutable state.
- Mature libraries preferred; in-house only where justified by ADR (migration runner, SQLite job queue).

## 4. Capability → extension point (v1 = implemented in v1; later = plugin later)

| Stage | Capability | Extension point | When |
|---|---|---|---|
| discover | OpenAlex / Crossref / arXiv / PubMed / Semantic Scholar search | K7 DataSource → K1 Work | v1 |
| discover | Unpaywall OA PDF fetch (opt-in) | K7 DataSource + HTTP fetch | v1 |
| discover | review-first discovery | K7 Retriever ranking + `Work.kind=review` | v1 |
| discover | backward/forward citation chaining | K7 DataSource → K1 Relation `cites` | v1 |
| discover | co-citation / coupling map | K9 Analyzer + FE view slot | later |
| discover | venue quality (OpenAlex metrics; JCR/CAS tables = user import) | K1 Venue entity + K7 importer | later |
| discover | researcher / team tracking | K1 Author entity + SavedSearch kind=author | v1 (author watch) |
| discover | patents (Lens / EPO OPS), Chinese sources (CNKI/Wanfang exports), theses, reports | K7 Importer/DataSource | later |
| read | PDF parse with page anchors, quality flags | K7 Parser | v1 |
| read | OCR (GLM OCR / local) | K7 Parser + K6 `document_ocr` | later |
| read | TAIMRD sections, figures-first reading | K7 `section_role`/`chunk_kind` + FE reader | v1 data, later UI |
| read | main-point extraction (cue phrases) | K6 AgentRun + K7 Evidence | later |
| read | question sets, note templates, highlights | K8 DocType + K7 selectors (Annotation) | v1 (notes, annotations) |
| read | translation keeping anchors | K6 routine + K8 suggestion mode | later |
| think | cited QA with refusal | K6 + K7 + K9 support check | v1 |
| think | deep research pipeline (sub-questions → multi-round search → PRISMA-style screening → page-cited synthesis with contradiction flags) | K2 `deep_research` task + K6 AgentRun + K7 + K8 report | v1 |
| think | claim graph, contradiction flags | K1 Claim/ClaimRelation + K9 | v1 |
| think | evidence matrix / gap finding | K8 DocType evidence_matrix + K9 Analyzer | later |
| think | hypothesis generation + novelty check | K6 AgentRun + K7 Retriever | later |
| think | mind maps | K8 DocType mindmap + OPML exporter | later |
| design | pre-registered plan with predictions & priors | K5 Plan + K3 approval | v1 |
| design | power analysis / DoE / factorial designs | K9 Analyzer + K5 designs | v1 (factorial) |
| design | dataset registry (license, governance) | K1 Dataset | v1 |
| execute | reviewed templates, CPU executor, cancel/recover | K5 | v1 |
| execute | HAR LR/RF/1D-CNN | K5 templates | v1 |
| execute | experiment tracking (manifests, metric series) + run compare | K5 run.json + K1 + FE view | v1 |
| execute | Optuna QMC/TPE bounded search | K5 search_strategies | v1 |
| execute | ODE/physics simulations | K5 templates + verifiers | later (example in §10) |
| execute | paper reproduction | K2 DAG + K5 template (repo reviewed→hash) + K7 RunMetric evidence | later |
| execute | remote GPU executor | K5 executors | later |
| analyze | tests, bootstrap, subject-clustered CI, effect sizes, multiplicity | K9 Analyzer | v1 |
| analyze | ANOVA with interactions, failure-region trees, importances | K9 Analyzer | v1 |
| analyze | Morris / Sobol (SALib), GP surrogate, PDP/ICE, MixedLM | K9 Analyzer | later |
| analyze | reproducible figures (spec + data) | K9 Analyzer + K8 artifact `figure` | v1 |
| verify | detectors D01-D11, metric recomputation | K9 Detector/Verifier | v1 |
| verify | citation existence/support, retraction check | K9 Checker + K7 DataSource | v1 |
| verify | figure/table/formula/unit standards (lecture rules) | K9 Checker | later |
| verify | statcheck-style p-value consistency | K9 Checker | later |
| write | report/manuscript with citekeys, number citations | K8 Doc | v1 (report) |
| write | BibTeX/RIS/CSL export, Zotero import | K8 Exporter / K7 Importer | v1 |
| write | DOCX / LaTeX export | K8 Exporter | v1 |
| write | grammar polish, venue selection, submission formatting, cover letter, reviewer response | K8 DocType + K6 + K9 Checker | later |
| present | deck generation (outline, time→slide count), lecture slide rules, PDF backup | K8 deck + PPTX exporter + K9 Checker | later |
| present | Q&A rehearsal (5-6 predicted questions), speech practice (ASR) | K6 AgentRun/Conversation + K6 modality registry | later |
| publish | arXiv / Zenodo / RO-Crate | K8 Exporter + K4 Effect + K3 per-action approval | later |
| monitor | saved searches, new-paper alerts, retraction alerts | K2 cron trigger + K7 + notifications | v1 |
| monitor | conference deadlines, daily brief | K2 + K8 + channels | later |
| knowledge | tags/collections, backlinks, global search | K1 Relation + K7 Indexer | v1 |
| knowledge | local library organization (dedupe/rename/move) | K4 Effects + K7 | v1 |
| knowledge | Zotero two-way sync, Anki export | K7 + K4 + K8 | later |
| cross | medical imaging / signals / clinical tables | K7 + K5 + K9 + K3 DataClass phi | later (generic points only) |

## 5. Accuracy and rigor guarantees

### 5.1 Entry points for wrong facts
| Entry | Guard | Measure (target) | On failure |
|---|---|---|---|
| file ingest | sha256, stable-size check, magic bytes | re-hash on read = 100% | quarantine |
| PDF text | per-page flags (chars, garbled ratio, word ratio, column order) | G1: anchor locate 100% (v1 requirement); CER ≤1% | page `needs_proofreading`, not machine_checked |
| OCR | per-token confidence, "OCR-derived" label | CER ≤3%; digit accuracy ≥99.5% | OCR numbers need human confirmation before stats |
| tables/formulas | default unverified; jump to source page | cell accuracy baseline first | show "check source" |
| metadata | Crossref × OpenAlex × PDF reconciliation; DOI must resolve | G2: DOI exact ≥99%, author list ≥97% | keep both values with source; flag |
| dedupe/merge | hard identifiers only; fuzzy = suggestion | false merge = 0; false split ≤5% | merges reversible |
| LLM extraction | quote-or-reject; numbers must occur in quote | G4: precision ≥95%, recall reported; fabricated span = 0 (deterministic) | field null "not found" |
| QA / claims | per-sentence evidence; verification by a different model than the writer | G3: locate 100%, support precision ≥90%, refusal ≥90%, contradiction recall reported | drop sentence → "insufficient material" |
| citations in writing | citekey → Reference → Work resolvable; retraction check; support check | unresolvable at export = 0 | block export |
| external facts (venue metrics, counts) | stored as Quantity with source + retrieval date | display "as of" always | hide undated values |
| statistics | deterministic Analyzer only; assumption checks; recomputed from stored data | G6 golden fixtures, rel. error ≤1e-9 | block |
| figures | spec + data hash; units required; caption numbers reconciled | re-render hash equal; mismatches = 0 | fail Finding |
| run metrics | worker recomputation / invariant check (§6.2) | abs(reported − recomputed) ≤1e-6 | run `metrics_unverified` |
| units | pint Quantity for params, metrics, dataset columns | missing unit on physical quantity = 0 | validation error |
| numbers in prose | number citations `{{metric:…}}` | free numbers = 0 | warn (draft) / block (final) |
| splits/leakage | group-key split hash, overlap checks, test-access log | overlap = 0 | block run |
| environment | lockfile hash, git dirty flag | — | run labeled non-reproducible |

Core-guaranteed (cannot be bypassed by plugins): ingest hashing, single validated write path for Evidence, trust
status, Quantity, split contract, metric verification status, ledger, citation/number gates at export.
Checker-level (pluggable): style rules, statcheck, figure standards, slide rules.

### 5.2 Trust levels
`failed < unverified < machine_checked < human_checked`. Deterministic validators set `machine_checked`; only an
explicit user action sets `human_checked` (event records device). Derived outputs display a **composition**
("12 facts: 10 machine_checked, 2 unverified (OCR)") instead of a single min; only `failed` blocks. Retraction of a
source sets dependent evidence/claims to `failed`.

### 5.3 Number citations and metric recomputation
Every number in an exported report is either a placeholder bound to a metric/evidence id or flagged. Headline
metrics are recomputed by the worker independently of template code (classification: from `predictions` with
`sample_id, y_true, y_pred`; simulations: invariant checks or tolerance-tightened rerun).

### 5.4 Gold sets and certification
| Set | Content | Labels | CI |
|---|---|---|---|
| G1 parsing | 8 generator-labeled synthetic PDFs (2-column, rotated, scanned page, corrupt, duplicate, encrypted) + 12 OA PDFs, ~100 anchors | synthetic: ground truth from generator; real: drafted by Claude, verified by owner | synthetic part every commit (100%) |
| G2 metadata | 100 records | Crossref as reference; synthetic conflict fixtures for reconciliation | fixtures every commit |
| G3 QA | 30 items: 20 answerable, 5 unanswerable, 5 conflicting (planted) | owner writes/edits and verifies; double-label a subset | replayed cassettes every commit; live eval on demand |
| G4 extraction | 50 fields from 10 papers | owner-verified | as G3 |
| G5 diagnosis | planted-effect bench + canary sweep | generated (known truth) | every commit |
| G6 statistics | golden numeric fixtures (scipy/statsmodels) | generated | every commit |
| G7 routing | dry-run router cases | deterministic | every commit |

Storage: `tests/gold/` holds labels (JSONL with version, labeler, date) and only files whose license permits
redistribution; others = identifier + sha256 + fetch script. Live model evals: `eval --suite … --model <alias>`
with a cost cap (e.g. ≤2 RMB), stored as EvalRun (model id, prompt hash, date). Certification thresholds: locate
100%, support precision ≥90% and ≥ previous − 2 pp, refusal ≥90%. Honest limit: 30 items give wide Wilson CIs and
only catch large (~15 pp) regressions; sets grow from owner corrections.

## 6. Simulation / experiment QA and diagnosis

### 6.1 Data model
- `Sweep`: space (typed params, units, bounds, log/linear, conditional), design (grid, factorial+center, QMC, TPE,
  Morris/Sobol later), seeds policy, objective (val split only), budget, plausible ranges, template invariants.
- `Trial`: canonical params JSON + hash, seed, replicate index, run id, state, health.
- `MetricSeries`: run, name, unit, split ∈ {train, val, confirm*, test*} (*locked until stage/freeze), step,
  t_wall, value — summaries in DB, full series as hashed columnar file in the run dir; resource series likewise.
- `HealthSignal`: see K9. `Diagnosis`: kind (param_effect, interaction, failure_region, instability), method,
  statistics (effect, CI, q), supporting trials (selectors), evidence ids, trust status, generated_by
  (deterministic | llm_narrated). `Suggestion`: params, rationale, source (sampler | rule | llm | literature),
  in-bounds proof, status.

### 6.2 Template SDK contract (minimal)
Templates read data only via `ctx.data(split)` (access logged), write `metrics.jsonl`
(`name, value, unit, split, step, t_wall`), and declare outputs. The worker writes `run.json` (seed, data/split
hashes, template hash, git commit, env lock hash, device, params). Every headline metric declares `verification`:
`recomputed` (requires `predictions` with `sample_id`) | `invariant_checked` (trajectory + verifier, optional
`verification_overrides`, e.g. rtol/10 rerun) | `self_reported` (allowed, labeled in reports). Cancellation via SDK
cancel-flag file, then hard kill after grace.

### 6.3 Detectors (v1, deterministic, versioned; thresholds live in the plan)
| Id | Fires on | Rule |
|---|---|---|
| D01 nonfinite | NaN/Inf | any logged loss/metric not finite → fail; checked on heartbeat tail → trial cancelled early |
| D02 divergence | exploding training | after 2 warm-up epochs, train_loss > 2× running min for 3 consecutive points → fail |
| D02b overfit | train↓ val↑ | val loss rising ≥3 points while train falling → warn |
| D03 split_integrity | leakage | train/val group sets intersect → fail; shared half-window hashes across splits → fail |
| D04 sample_provenance | wrong split used | prediction `sample_id`s outside the allowed split, or test access in SDK log → fail |
| D05 stall | hang | no progress for max(10 min, 5× median step interval) → warn, then cancel → `interrupted(stalled)` |
| D06 host_suspend | laptop sleep | worker loop wall-clock gap > 60 s → info; timing metrics in that window invalidated |
| D07 metric_recompute | misreport | abs(reported − recomputed) > 1e-6 → fail, run `metrics_unverified` |
| D08 exit/solver | crash, non-convergence | exit ≠ 0 or solver flag → fail |
| D09 plausible_range | implausible result | outside declared range / too-good vs registered baseline → warn (never auto-fail) |
| D10 chance_level | not learning | metric ≤ chance + ε → warn |
| D11 seed_spread | instability | CV across seeds > threshold → warn |
Streaming in v1 is limited to D01 and D05 (heartbeat tail); all others run post-hoc.

### 6.4 Closed loop (one pre-registered study protocol, approved once)
Split for HAR train subjects (21): **13 train / 4 search-val / 4 confirm-val**; official 9 test subjects sealed.
(GroupKFold confirmation is an alternative chosen in the protocol.)
| Stage | Action | Budget | Stop rule |
|---|---|---|---|
| 1 screen | 2^k factorial (k ≤ 4) + 2 center points × 2 seeds (~36 trials) | ~40-110 min (est.) | >50% failures → halt and ask; measure seed noise σ |
| 2 shrink | failure-region tree rules (purity ≥80%, support ≥4) excluded; params with partial η² < 0.01 fixed | no runs | narrowing only (auto) |
| 3 search | QMC (default) or TPE in shrunk space, fixed sampler seed, MedianPruner from epoch 5 | ≤30 trials; ≤90 min/task; ≤4 h total, resumable | no improvement > σ in 10 trials |
| 4 confirm | top-3 distinct configs + default × 5 seeds on confirm-val | ~20 trials | best mean; overlapping CIs → pre-registered simpler/cheaper tie-break |
| 5 freeze | lock plan + config hash; one shuffled-label control | 1 trial | control not near chance → stop |
| 6 final_eval | test once, baselines (LR, RF) in the same event, subject-bootstrap CI | ~3 runs | no rerun except failure without metrics (recorded) |
Total ≈ 90 trials ≈ 1.5-4.5 h CPU (estimate, to be measured), over 2-3 days.
Anti-forking-paths: stage-1 ANOVA is exploratory; one pre-registered confirmatory hypothesis tested once on test
(Holm if several); alpha spending is not used (selection is not interim testing); any deviation = new plan version,
labeled "deviation", confirm rerun with fresh seeds; reports state how many configurations were evaluated.

### 6.5 Analysis methods
- v1: factorial / factorial+center designs; OLS Type II ANOVA `metric ~ C(a)*C(b) + C(seed)` (statsmodels), Holm
  correction, partial η², cell-mean CIs, curvature test from center points; failure-region decision tree (depth ≤3,
  scikit-learn) → readable rules; Optuna importances labeled **exploratory**; seed-noise floor; subject-level
  bootstrap CI.
- Reporting gate: an effect is reported only if it exceeds the seed-noise floor and its CI excludes 0; otherwise
  "not distinguishable from noise". Language: designed sweeps → "effect within this setup"; adaptive samples →
  "association". Seeds do not capture subject variance — always stated.
- Winner's-curse estimate shown beside the best validation score: optimism ≈ σ·√(2 ln N), N = configurations
  evaluated.
- Later (plugins): Morris/Sobol (SALib; Sobol only for cheap sims or surrogates — Saltelli needs N(2D+2) runs),
  GP surrogates (refuse interpretation if surrogate R² < 0.5), PDP/ICE, MixedLM.

### 6.6 Suggestions and literature grounding
Sources: sampler ask, rules (shrink to stable region, avoid failure region), LLM (JSON validated against the
space), literature priors. The rule layer checks space membership, trial and time budget; out-of-space →
plan-revision proposal (approval). Analysis APIs reject `test`/`confirm` metrics while the study is open.
Literature: diagnosis kind → query templates → K7 sources → quote-verified evidence attached via `explained_by`
(method reference vs empirical analog). Narration may cite only attached evidence ids; none → "no literature support
found"; never citations from model memory. Literature hyperparameter ranges only propose bounds for a new plan
revision; they never override local data.

### 6.7 Self-tests
- **Canary sweep**: built-in tiny sweep with all six injected fault types; runs whenever detectors/templates change;
  UI shows which detectors fired as expected.
- **Planted-effect bench**: synthetic response surface with known main effects, an lr×batch interaction and a
  failure region; diagnosis must recover them and must not report absent effects.

### 6.8 HAR fault-injection worked example (CPU; per-trial 1-3 min estimated, unmeasured)
Params lr, batch, dropout, window ∈ {64 center-crop, 128} (UCI HAR windows are fixed at 128; other sizes would
confound sample count/overlap). Tests use tiny fault templates in `tests/fixtures/templates/` (<1 s each) through
the real worker subprocess; the real-HAR variant is `@slow`. Values below are illustrative.
| Fault | Detector | HealthSignal (example) | Diagnosis / suggestion | Test |
|---|---|---|---|---|
| (a) lr = 1.0 → NaN | D01 | `{nonfinite@1, fail, train_loss step 3, NaN}` | "6/6 trials with lr=1.0 non-finite within ≤3 epochs; 0/24 at lr≤0.01 (association in this sweep); batch/dropout unrelated." Mechanism text = "model inference (uncited)" unless a source is imported. Suggest narrowing lr ≤ 0.1 (auto) | `test_nonfinite_aborts_trial` |
| (b) divergence | D02 | `{divergence@1, fail, steps 6-8, 2.7×, thr 2.0}` | "lr=0.1 & batch=32 diverged 3/3; lr=0.1 & batch=256 0/3" → interaction, see below | `test_divergence_rule` (+ boundary at exactly 2×) |
| (c) random-window split | D03 | `{split_integrity@1, fail, shared_half_hashes 2311}` | "validation shares 2311 half-windows with training; metrics inflated and void" → use SDK subject split | `test_random_window_split_detected` (+ negative control) |
| (d) test used as val | D04 | `{sample_provenance@1, fail, test_ids_seen 2947}` | study contaminated; runs voided; new split hash required | `test_test_ids_in_predictions_fail` |
| (e1) hang | D05 | `{stall@1, fail, idle 640 s}` | no auto-retry; check loader/deadlock | `test_stall_cancels` (threshold 2 s) |
| (e2) laptop sleep | D06 | `{host_suspend@1, info, gap 1840 s}` | latency metrics void, others valid; lease reclaimed if generation unchanged | `test_suspend_gap` (fake clock) |
| (f) metric misreport | D07 | `{metric_recompute@1, fail, 0.97 vs 0.91}` | recomputed value authoritative; run `metrics_unverified` | `test_misreport_detected` |
Interaction example: lr ∈ {1e-3, 1e-2} × batch ∈ {32, 256} × 3 seeds = 12 runs (~15-35 min est.; 3×3 levels = 27
runs, ~30-80 min). Detected when Holm-adjusted p < 0.05 AND partial η² ≥ 0.06 AND cell-mean CIs show non-parallel
lines. Report example: "lr×batch: F(1,6)=9.8, p_holm=0.04, partial η²=0.31; at batch 32 raising lr lowers F1 by
0.08, at batch 256 raises it by 0.02 (illustrative)". With 3 seeds power is low → "inconclusive" when CIs are wide;
≥5 seeds recommended for interaction claims.

## 7. Local file agent and Effects safety model
- Roots: owner-configured allowlist `{path, read|write, cloud_allowed}`; default empty. Hard deny: OS dirs,
  Program Files, `~/.ssh`, browser profiles, the app DB.
- Path rules: canonicalize, per-component lstat; refuse reparse points (symlinks, junctions, mount points) unless
  allowlisted; Windows: case-insensitive + NFC comparison, 8.3 names expanded, `\\?\` for long paths, reserved
  names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, also with extensions), trailing dot/space, invalid characters, ADS
  `:stream`, drive-relative `C:foo` all rejected; UNC/network paths off by default. TOCTOU: re-check size, mtime and
  hash right before each op (directory-handle operations deferred; residual risk documented).
- Ops (closed set): list, stat, hash, read, mkdir, copy, move/rename, sidecar metadata, trash (send2trash). No
  in-place edits, no execution, no permanent delete. Max 500 ops per plan.
- Flow: agent proposes `EffectPlan` → validator (roots, conflicts, case-collisions, move cycles, free space) →
  dry-run tree diff → approval (password re-entry when applied from a remote device such as the iPad) → journaled
  apply → hash verification at destination → done; undo from journal with state validation.
- **Copy-by-default** for library organization (moving originals breaks browser history and external links; move is
  opt-in). Cross-volume move = copy to `*.ros-partial` → verify → rename → source to trash.
- Locked file (Windows sharing violation, winerror 32): op `blocked:sharing_violation`, plan pauses, later ops not
  run; user closes the program and resumes or skips; never kill other processes. Linux advisory locks do not block
  renames (cannot be detected there).
- Crash recovery (example: op1 same-volume `os.replace` done, crash before result row): on restart op1 is in
  `intent`; source absent + destination hash == recorded hash → mark done. Partial `*.ros-partial` files are ours →
  removed, op back to pending. Resumption needs the owner's confirmation in a recovery dialog.
- Library workflow (v1): scan Downloads (read-only) → copy into `raw/` CAS → identify (hash; DOI/arXiv from XMP and
  first pages; Crossref/OpenAlex; title+author bibliographic query with threshold; else review queue) → versions
  (same bytes = one version; same DOI different bytes = versions; preprint vs published linked via Crossref
  `is-preprint-of`/OpenAlex, else fuzzy ≥0.95 → suggestion only; Chinese thesis without DOI → `kind=thesis`,
  quote-verified LLM metadata + review) → citekey `author+year+word` (+a/b; pinyin via plugin, fallback
  `zhang2023-<hash4>`) → EffectPlan into `Library/<year>/<citekey>.pdf`, unknowns to `_unsorted/`. OneDrive
  placeholders are treated as slow reads.
- File contents are data; they never change roots, capabilities or plans. Contents go to cloud models only from
  roots marked `cloud_allowed` and data classes that permit it.

## 8. Autonomy (bound to K3)
| Class | Without asking | Must ask | Never |
|---|---|---|---|
| read | library, allowlisted read roots, free public APIs within rate limits | sending private/sensitive content to cloud models | read secrets |
| compute | local recomputation, analysis, detectors, indexing | — | run unreviewed code |
| internal writes | CAS import, AI drafts (labeled), events | — | bypass the gateway |
| spend | routine calls within per-task + monthly budget; premium when global switch ON and within per-task cap | over per-task budget; premium with switch OFF | change budgets |
| experiments | narrow space; queue trials within approved space/budget; stop own runs on failure signals | widen space, change metric/data/code (new plan revision); `final_eval` | access test before freeze |
| files | dry-run | apply writes/moves/renames/trash (re-auth from remote devices) | permanent delete |
| identity/trust | propose Work merges | confirm merges; set `human_checked` (user only) | — |
| external | — | every publish/upload, individually | change permissions/policies |
| system | — | install plugins/dependencies; enable connectors | — |

## 9. Platform adapter (Windows / Linux)
| Concern | Windows | Linux |
|---|---|---|
| paths | `\\?\`, reserved names, case-insensitive + NFC, reparse points | realpath + lstat |
| spawn | `CREATE_NEW_PROCESS_GROUP \| CREATE_NO_WINDOW` + Job Object (KILL_ON_JOB_CLOSE) | `start_new_session` |
| cancel | SDK cancel flag → `TerminateJobObject` after grace | cancel flag → `killpg` |
| limits (v1) | Job Object memory limit, psutil RSS watchdog, wall timeout, `OMP_NUM_THREADS`, BELOW_NORMAL priority | psutil RSS watchdog, wall timeout, nice (no RLIMIT_AS: PyTorch VM size); cgroups optional |
| sleep | `SetThreadExecutionState`; power source | `systemd-inhibit` optional; psutil battery |
| GPU | nvidia-smi | nvidia-smi |
| trash | send2trash | send2trash |
| locks | sharing-violation detection | not detectable |
| autostart | Task Scheduler at logon, hidden (pythonw) | `systemd --user` |
| encoding | force `PYTHONUTF8=1`; decode subprocess output explicitly (cp936 consoles) | UTF-8 |
| misc | `os.startfile`; `os.replace` fails if target open; dir fsync no-op | `xdg-open` |
| low-priv worker | `run_as` local user (owner creates, admin) | `run_as` system user |
CI: Linux runs everything; GitHub Actions `windows-latest` can run unit + adapter tests (Job Object kill-tree, long
paths, reserved names, exclusive-open locks, trash) and an `install.ps1` smoke test — **pushing to GitHub needs the
owner's authorization**; alternative `scripts/selftest.ps1` on the laptop.
Honestly untestable without the owner's machine: RTX 5070 Ti / driver / CUDA (Blackwell needs CUDA ≥12.8 torch
builds), thermals, Modern Standby sleep/resume, battery events, iPad Safari CA trust + service-worker offline,
home LAN + Windows Defender firewall prompts, OneDrive placeholders, Defender scan locks, cp936 locale, real CPU speed.

## 10. Extensibility proofs (all: no breaking core change)
- **ODE/physics template**: `templates/ode_oscillator/{template.json, run.py}` (params with units, metrics with
  `verification: invariant_checked`, `verification_overrides: {rtol: /10}`), reviewed hash added to the registry
  data; new verifier (if needed) via `researchos.verifiers`.
- **New detector**: plugin package registers `researchos.detectors` entry (id, version, applicable template tags,
  threshold schema); read-only inputs (run manifest, metric series, split manifest, predictions); output only
  HealthSignal; passes DetectorConformance + canary.
- **CNKI import**: `researchos.importers` for RefWorks/NoteExpress/EndNote exports; `Identifier(cnki, …)`;
  `Work.kind=thesis|article`, language zh; trigram FTS makes Chinese searchable; CAJ files = unsupported format with
  recovery action (get PDF). Never logs in.
- **PPT generator**: `doc_types` deck schema (outline → background → objectives → methods → results → discussion
  → conclusion; time budget → slide count at 0.5-2 min/slide), `exporters` pptx (python-pptx) + PDF backup,
  `checkers` slide rules (≥24 pt body, ≤10 lines, ≤4 colors, ≤3 animations, units/formula style), `prompts` for
  drafting; generic schema editor or one build-time FE slot.
- **Deep research agent**: Task kind `deep_research` = AgentRun (K6) with tools over K7 (plan sub-questions →
  multi-round search → screening with ScreeningDecision entities and PRISMA-style log → page-cited synthesis with
  contradiction flags) → K8 report Doc; human checkpoints are K3 `research_checkpoint` approvals.
- **Zotero two-way sync**: importer + `p_zotero_` mapping tables; `Identifier(zotero, lib/key)`; write-back is a
  K4 Effect using Zotero version preconditions, undo = write previous version. Zotero locks its sqlite while open →
  use the Zotero 7 local API or web API.
- **Remote GPU executor**: `researchos.executors` "ssh"; SSH credentials in the connector store; egress check on
  the RunBundle (K3); remote probe gives the device label; compute cost booked as ledger kind `compute`.
- **Medical imaging (later)**: DICOM importer (pydicom); `Dataset.governance` (license, ethics/IRB status) and
  `storage` external reference; de-identification as an Analyzer producing a derived dataset version with
  provenance; DataClass `phi` blocks cloud models, remote executors and exports; patient-level group key in the
  split contract; ROC/AUC, calibration, clustered CIs as Analyzers; viewer as build-time FE slot.

## 11. Milestones (new numbering; baseline M0-M3 map to M0-M3, baseline M4 → M4+M5, baseline M5 deferred)
| M | Delivers | Hard gate (tests) | Est. LOC py+ts |
|---|---|---|---|
| M0 skeleton | K1 store/migrations/events, auth+devices, K2 state machine+leases+worker, K3 approvals, plugin registry, basic Platform, scripts, FE shell | double submit → one task; stale worker fenced; kill worker → recovery; import-linter + 400-line gate | 4.5k + 2k |
| M1 evidence | Work+identifiers, CAS import, pypdf parse+flags, trigram FTS, quote-verified evidence, QA (mock providers), ledger, router | G1 synthetic 100%; G7 pass; concurrent reservations never overspend; refusal without evidence | 5k + 1.5k |
| M2 experiments | SDK, local executor, HAR LR/RF/CNN, D01-D11, verification, manifests, MD/HTML report, cancel/recovery | 6 injected faults detected; cancel ends child tree; misreport caught | 5k + 1.5k |
| M3 cross-device/ops | PWA offline+sync, TLS, pairing UI, backup/restore, Windows package, doctor | restore hashes match; offline reconnect no duplicate start; install smoke on Linux; Windows NOT RUN | 3k + 2k |
| M4 diagnosis loop | factorial+ANOVA, failure regions, QMC/Optuna, 6-stage protocol, winner's curse, canary, planted bench | planted effects recovered, no false effects; final_eval once | 3k + 1k |
| M5 literature agent | 5 data sources, saved searches + scheduler, retractions, screening, deep research pipeline, BibTeX/RIS/CSL + Zotero import, Effects + library organization | 30-PDF fixture: correct plan, crash recovery, undo restores identical hashes | 4.5k + 1.5k |
| M6 writing | Doc editor, DOCX/LaTeX export, citation + number gates | unresolvable citations = 0; free numbers = 0 | 3k + 1.5k |
Total ≈ 28k Python + 11k TS + ~15k tests (estimates). Each milestone ends with REVIEW_Mx.md (incl. code health) and
updates STATUS/DECISIONS/ACCEPTANCE/NEXT. The bottleneck is owner time (gold labeling, Windows/GPU/iPad acceptance,
approvals), not agent coding time; no calendar promise.

## 12. Top risks
| # | Risk | Mitigation |
|---|---|---|
| 1 | scope explosion for a solo owner | hard milestone gates, plugin-later list, per-module LOC budgets |
| 2 | pypdf quality on scientific 2-column PDFs (PyMuPDF is AGPL) | measure G1 in M1; pdfminer.six / pdfplumber (MIT) as swappable parser plugins |
| 3 | Windows/GPU untested | selftest.ps1 + owner checklist; GPU preflight; CI windows only if authorized |
| 4 | model IDs/prices are placeholders | reject until verified; mocked tests; certification-before-use |
| 5 | statistical over-claiming by an inexperienced user | language templates, exploratory labels, winner's-curse estimate, safe defaults |
| 6 | data loss (file agent, migrations) | copy-by-default, trash-only, journal, pre-migration backup, restore rehearsal tests |
| 7 | LAN exposure for iPad access | loopback default, TLS, pairing, origin/host checks, re-auth for effects, doctor |
| 8 | small gold sets → false confidence | Wilson CIs reported; sets grow from owner corrections |
