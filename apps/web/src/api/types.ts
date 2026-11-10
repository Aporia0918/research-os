// Contract aliases from the generated FastAPI OpenAPI schema (scripts/gen-contracts.sh).
// Dynamic experiment read responses are documented separately below.
import type { components } from "./schema";

type S = components["schemas"];
export type AuthState = S["AuthState"];
export type Device = S["DeviceOut"];
export type Project = S["Project"];
export type Note = S["Note"];
export type Task = S["Task"];
export type Approval = S["Approval"];
export type KeyStatus = S["KeyStatus"];
export type PairingCode = S["PairingCodeOut"];
export type EventRecord = S["Event"];
export type PluginInfo = S["PluginInfo"];
export type TaskState = Task["state"];
// File roots: the owner's read/write folders (PUT replaces the whole list; the response is the cleaned list).
export interface FileRoot { path: string; access: "read" | "write"; cloud_allowed?: boolean }

export type ExperimentPlanInput = S["PlanIn"];
export type ExperimentRunInput = S["RunIn"];
export type StudyInput = S["StudyIn"];
// Experiment endpoints expose dynamic dicts in OpenAPI. These read-side fields mirror the router/service
// responses; request contracts above remain generated. Never infer scientific results in the browser.
export interface ExperimentTemplate {
  id: string; version: string; hash: string; status: string; description: string;
  resource_class: string; params_schema: Record<string, unknown>; requires: string[];
}
export interface ExperimentPlan { id: string; title: string; latest_revision: number }
export interface PlanRevision {
  plan_id: string; revision: number; content_hash: string; approved_by_revision?: number | null;
  content: Record<string, unknown> & { params?: Record<string, unknown> };
}
export interface RunAttempt { id: string; attempt: number; state: string }
export interface ExperimentRun extends RunAttempt {
  task_state: string; error_message: string | null;
  metrics: { name: string; split: string; value: number | null; verification: string }[];
  signals: { id: string; detector: string; severity: string; rule: string; value: unknown; selector: unknown }[];
  artifacts?: { path: string; sha256: string; size: number; kind: string }[];
}
export interface StudyEffect {
  term: string; df: number; f: number | null; p: number | null; p_holm: number | null;
  partial_eta2: number | null; reported: boolean; statement: string;
}
export interface Study {
  id: string; plan_id: string; base_revision: number; current_revision: number; stage: string;
  configs_evaluated: number; protocol: Record<string, unknown>;
  data: {
    screen?: {
      anova?: { effects: StudyEffect[]; curvature: Record<string, unknown> | null; sigma: number | null; notes: string[] };
      failure_rules?: { rule: string; failed: number; support: number; purity: number }[];
      avoid?: string[];
    };
    stop_reason?: string; search_stopped?: string | null; search_batches?: number;
    frozen?: Record<string, unknown>; final?: Record<string, unknown>;
    confirm?: Record<string, unknown>[]; control?: Record<string, unknown>;
    surface?: Record<string, unknown>;
  };
}

export type LiteratureSearchInput = S["researchos__api__routers__literature__SearchIn"];
export type CitationChainInput = S["ChainIn"];
export type ReviewInput = S["ReviewIn"];
export type ReviewItemsInput = S["ItemsIn"];
export type ScreeningInput = S["researchos__api__routers__reviews__DecisionIn"];
export type VenueTiersInput = S["TiersIn"];
export interface LiteratureCandidate { id: string; record: { title?: string; abstract?: string; year?: number; venue?: string }; }
export interface LiteratureRun { id: string; candidates: LiteratureCandidate[]; per_source: Record<string, { error?: string; warnings?: string[]; returned?: number; total?: number | null }>; }
export interface LiteratureReview { id: string; title: string; question: string; criteria: Record<string, unknown>; items: { candidate: LiteratureCandidate; screening: Record<string, { decision: string | null; suggestion: string | null }> }[]; }
export interface SavedSearchInput { name: string; kind: "query" | "author"; query: { text?: string; author?: string }; sources: string[]; cadence: "manual" | "daily" | "weekly"; }
export interface SavedSearch extends SavedSearchInput { id: string; enabled: boolean; last_run_at: string | null; }
export interface LibraryWork { id: string; title: string; weight: string[]; }

export type CompareInput = S["CompareIn"];
export interface CompareResult {
  run_id: string; plan_id: string; revision: number; plan_hash: string; tolerance_units: string;
  items: {
    metric: string; split: string; evidence_id: string; number_index: number;
    tolerance: { kind: "absolute" | "relative"; value: number };
    status: "match" | "deviation" | "not comparable";
    reported_value: number | null; reproduced_value: number | null;
    canonical_unit?: string; threshold?: number; reason?: string;
    candidate_causes: { label: string; name: string; paper_value: unknown; plan_value: unknown; run_value: unknown; [key: string]: unknown }[];
    parameter_notes?: string[]; [key: string]: unknown;
  }[];
}

/** GET /studies/{id}/advice (ADR-168): read-only next-experiment advice. */
export interface StudyAdvice {
  study_id: string; stage: string; objective: string; direction: string; recommendation: string; caveat: string;
  sensitivity: { ranking: { term: string; partial_eta2: number | null; p_holm: number | null; reported: boolean; statement: string }[]; basis: string; notes: string[] };
  uncertainty: { seed_sd: number | null; config_sd: number | null; configurations: number; replicated_configurations: number; advice: string };
  failure_memory: { rules: { rule: string; failed: number; support: number }[]; avoided_regions: string[]; constraints: string[] };
  proposals: { params: Record<string, number | string>; mean?: number; sd?: number; ei?: number }[];
  model: { model?: string | null; reason?: string; max_ei?: number };
  stop_rules: { rule: string; met: boolean; detail: string }[];
  ablation?: { results?: { factor: string; frozen: unknown; reference: unknown; n: number; mean: number | null;
    ci95: [number, number] | null; verdict: string; failed_runs: number }[];
    plan?: { skipped: { factor: string; reason: string }[] }; data?: string } | null;
}

// One-click update (ADR-223/228). The /update routes return plain dicts, so this mirrors services/ops/updater.py.
export type UpdateState = "idle" | "checking" | "up_to_date" | "available" | "downloading" | "ready" | "installing" | "error";
export interface UpdateStatus {
  current_version: string;
  state: UpdateState;
  latest: { version: string; asset: string; sha256: string; url: string; notes: string; notes_zh: string } | null;
  progress: { received: number; total: number } | null;
  error: { code: string; message: string } | null;
  mirror_prefix: string;
  feed_url: string;
  can_install: boolean;
  auto_check: false;
  installer: string | null;
  /** notes of the update that is now running, until dismissed once */
  whats_new: { version: string; notes: string; notes_zh: string } | null;
}
