// TanStack Query hooks: one place for every server read/write. Writes go through persisted intents.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import type { FileRoot, ExperimentTemplate, ExperimentPlan, PlanRevision, RunAttempt, ExperimentRun, Study, StudyAdvice, ExperimentPlanInput, ExperimentRunInput, StudyInput, AuthState, UpdateStatus, Device, EventRecord, KeyStatus, Note, PairingCode, PluginInfo, Project, Task } from "./types";
import { newKey } from "@/lib/utils";
import { runIntent } from "@/offline/intents";

export const qk = {
  auth: ["auth"] as const,
  projects: ["projects"] as const,
  project: (id: string) => ["projects", id] as const,
  notes: (pid: string) => ["projects", pid, "notes"] as const,
  tasks: (pid?: string) => ["tasks", pid ?? "all"] as const,
  devices: ["devices"] as const,
  keys: ["keys"] as const,
  host: ["host"] as const,
  events: (pid?: string) => ["events", pid ?? "all"] as const,
  plugins: ["plugins"] as const,
  update: ["update"] as const,
  fileRoots: ["file-roots"] as const,
};

export const useAuthState = () => useQuery({ queryKey: qk.auth, queryFn: ({ signal }) => api.get<AuthState>("/auth/state", signal) });
export const useProjects = () => useQuery({ queryKey: qk.projects, queryFn: ({ signal }) => api.get<Project[]>("/projects", signal) });
export const useProject = (id: string) =>
  useQuery({ queryKey: qk.project(id), queryFn: ({ signal }) => api.get<Project>(`/projects/${id}`, signal) });
export const useNotes = (pid: string) =>
  useQuery({ queryKey: qk.notes(pid), queryFn: ({ signal }) => api.get<Note[]>(`/projects/${pid}/notes`, signal) });
export const useTasks = (pid?: string) =>
  useQuery({
    queryKey: qk.tasks(pid),
    queryFn: ({ signal }) => api.get<Task[]>(`/tasks${pid ? `?project_id=${pid}` : ""}`, signal),
    refetchInterval: 3000, // honest live status from the backend; no invented progress
  });
export const useDevices = () => useQuery({ queryKey: qk.devices, queryFn: ({ signal }) => api.get<Device[]>("/devices", signal) });
export const useFileRoots = () =>
  useQuery({ queryKey: qk.fileRoots, queryFn: ({ signal }) => api.get<FileRoot[]>("/settings/file-roots", signal) });
export const rootCalls = {
  set: (roots: FileRoot[], key: string) => api.put<FileRoot[]>("/settings/file-roots", { roots }, { idempotencyKey: key }),
};
export const useKeys = () =>
  useQuery({ queryKey: qk.keys, queryFn: ({ signal }) => api.get<Record<string, KeyStatus>>("/settings/keys", signal) });
export const useHost = () =>
  useQuery({ queryKey: qk.host, queryFn: ({ signal }) => api.get<Record<string, unknown>>("/host/status", signal), refetchInterval: 10000 });
export const useEvents = (pid?: string) =>
  useQuery({
    queryKey: qk.events(pid),
    queryFn: ({ signal }) => api.get<EventRecord[]>(`/events?limit=50${pid ? `&project_id=${pid}` : ""}`, signal),
  });
export const usePlugins = () => useQuery({ queryKey: qk.plugins, queryFn: ({ signal }) => api.get<PluginInfo>("/plugins", signal) });

type Vars<T> = T & { intentId: string };

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ intentId, ...body }: Vars<{ title: string; goal: string }>) =>
      runIntent("project.create", intentId, body, (key) => api.post<Project>("/projects", body, { idempotencyKey: key })),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk.projects }),
  });
}

export function useUpdateProject(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ intentId, ...body }: Vars<{ revision: number; title?: string; goal?: string; next_step?: string; status?: string }>) =>
      runIntent("project.update", intentId, body, (key) => api.patch<Project>(`/projects/${id}`, body, { idempotencyKey: key })),
    onSuccess: (p) => { qc.setQueryData(qk.project(id), p); void qc.invalidateQueries({ queryKey: qk.projects }); },
  });
}

export function useCreateTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ intentId, ...body }: Vars<{ kind: string; payload: Record<string, unknown>; project_id?: string | null }>) =>
      runIntent("task.create", intentId, body, (key) => api.post<Task>("/tasks", body, { idempotencyKey: key })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useTaskAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ intentId, id, action }: Vars<{ id: string; action: "cancel" | "retry" }>) =>
      runIntent(`task.${action}`, intentId, { id }, (key) => api.post<Task>(`/tasks/${id}/${action}`, {}, { idempotencyKey: key })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }),
  });
}

export function useApprove() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ intentId, subjectType, subjectId, expectedHash, onlineOnly }: Vars<{ subjectType: string; subjectId: string; expectedHash?: string; onlineOnly?: boolean }>) => {
      const h = expectedHash ? { hash: expectedHash } : await api.get<{ hash: string }>(`/approvals/subject-hash?subject_type=${encodeURIComponent(subjectType)}&subject_id=${encodeURIComponent(subjectId)}`);
      const body = { subject_type: subjectType, subject_id: subjectId, expected_hash: h.hash };
      if (onlineOnly) return api.post("/approvals", body, { idempotencyKey: intentId });
      return runIntent("approval", intentId, body, (key) => api.post("/approvals", body, { idempotencyKey: key }));
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["tasks"] });
      await qc.invalidateQueries({ queryKey: ["plan-revision"] });
    },
  });
}

export const authCalls = {
  setup: (b: { username: string; password: string; device_name: string; setup_token: string }, key: string) =>
    api.post<AuthState>("/auth/setup", b, { idempotencyKey: key }),
  login: (b: { username: string; password: string; device_name: string }, key: string) =>
    api.post<AuthState>("/auth/login", b, { idempotencyKey: key }),
  pair: (b: { code: string; device_name: string }, key: string) => api.post<AuthState>("/auth/pair", b, { idempotencyKey: key }),
  logout: (key: string) => api.post("/auth/logout", {}, { idempotencyKey: key }),
  reauth: (password: string, key: string) => api.post("/auth/reauth", { password }, { idempotencyKey: key }),
  pairingCode: (deviceName: string, key: string) =>
    api.post<PairingCode>("/auth/pairing-codes", { device_name: deviceName }, { idempotencyKey: key }),
  revokeDevice: (id: string, key: string) => api.post(`/devices/${id}/revoke`, {}, { idempotencyKey: key }),
  setKey: (provider: string, apiKey: string | null, key: string) =>
    api.put<KeyStatus>(`/settings/keys/${provider}`, { api_key: apiKey }, { idempotencyKey: key }),
};

// One-click update (ADR-223): status polls only while a download or install is running; nothing checks by itself.
export const useUpdateStatus = () => useQuery({
  queryKey: qk.update, queryFn: ({ signal }) => api.get<UpdateStatus>("/update", signal),
  refetchInterval: (q) => (q.state.data?.state === "downloading" || q.state.data?.state === "installing" ? 1000 : false),
});
export const updateCalls = {
  // direct: the owner's "retry without the mirror" click (ADR-228); never automatic
  check: (key: string, direct = false) => api.post<UpdateStatus>("/update/check", { direct }, { idempotencyKey: key }),
  download: (key: string, direct = false) => api.post<UpdateStatus>("/update/download", { direct }, { idempotencyKey: key }),
  install: (key: string) => api.post<UpdateStatus>("/update/install", {}, { idempotencyKey: key }),
  setMirror: (prefix: string, key: string) =>
    api.put<UpdateStatus>("/update/settings", { mirror_prefix: prefix }, { idempotencyKey: key }),
  dismissWhatsNew: (key: string) => api.post<UpdateStatus>("/update/whats-new/dismiss", {}, { idempotencyKey: key }),
};

// Experiments and studies extend the same query/client layer. Irreversible execution is online-only;
// these operations are not added to the background offline replay queue.
export const useExperimentTemplates = () => useQuery({ queryKey: ["experiment-templates"],
  queryFn: ({ signal }) => api.get<ExperimentTemplate[]>("/templates", signal) });
export const useExperimentPlans = () => useQuery({ queryKey: ["experiment-plans"],
  queryFn: ({ signal }) => api.get<ExperimentPlan[]>("/plans", signal) });
export const usePlanRevision = (id: string, revision: number) => useQuery({ queryKey: ["plan-revision", id, revision],
  queryFn: ({ signal }) => api.get<PlanRevision>(`/plans/${encodeURIComponent(id)}/revisions/${revision}`, signal), refetchInterval: 3000 });
export const useExperimentTask = (id: string) => useQuery({ queryKey: ["experiment-task", id],
  queryFn: ({ signal }) => api.get<Task>(`/tasks/${encodeURIComponent(id)}`, signal), refetchInterval: 3000 });
export const useRunAttempts = (id: string) => useQuery({ queryKey: ["run-attempts", id],
  queryFn: ({ signal }) => api.get<RunAttempt[]>(`/tasks/${encodeURIComponent(id)}/runs`, signal), refetchInterval: 3000 });
export const useExperimentRun = (id: string) => useQuery({ queryKey: ["experiment-run", id],
  queryFn: ({ signal }) => api.get<ExperimentRun>(`/runs/${encodeURIComponent(id)}`, signal), refetchInterval: 3000 });
export const useStudyAdvice = (id: string, stage: string) => useQuery({ queryKey: ["study-advice", id, stage],
  queryFn: ({ signal }) => api.get<StudyAdvice>(`/studies/${encodeURIComponent(id)}/advice`, signal) });
export const useStudy = (id: string) => useQuery({ queryKey: ["study", id],
  queryFn: ({ signal }) => api.get<Study>(`/studies/${encodeURIComponent(id)}`, signal), refetchInterval: 3000 });

export function useCreateExperimentPlan() {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ intentId, ...body }: Vars<ExperimentPlanInput>) =>
    api.post<PlanRevision>("/plans", body, { idempotencyKey: intentId }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ["experiment-plans"] }) });
}
export function useStartExperimentRun(planId: string, revision: number) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: ({ intentId, ...body }: Vars<ExperimentRunInput>) =>
    api.post<Task>(`/plans/${encodeURIComponent(planId)}/revisions/${revision}/runs`, body, { idempotencyKey: intentId }),
  onSuccess: () => qc.invalidateQueries({ queryKey: ["tasks"] }) });
}
export function useCreateStudy() {
  return useMutation({ mutationFn: ({ intentId, ...body }: Vars<StudyInput>) =>
    api.post<Study>("/studies", body, { idempotencyKey: intentId }) });
}
export function useAdvanceStudy(id: string) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (intentId: string) =>
    api.post<{ stage: string }>(`/studies/${encodeURIComponent(id)}/advance`, {}, { idempotencyKey: intentId }),
  onSuccess: async () => {
    await qc.invalidateQueries({ queryKey: ["study", id] });
    await qc.invalidateQueries({ queryKey: ["tasks"] });
  } });
}

// Read-only comparison: no execution intent or approval is created.
export const useCompareRun = (id: string) => useMutation({
  mutationFn: (body: import("./types").CompareInput) => api.post<import("./types").CompareResult>(`/runs/${encodeURIComponent(id)}/compare`, body, { idempotencyKey: newKey() }),
});
