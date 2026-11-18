// 思维账本 on the computer: the debts the phone sent (with board, red, kind, where they were used) and the open 召回单.
// Typed here because the ledger returns plain dicts in OpenAPI.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export type Board = "学习" | "科研" | "生活";
export interface Debt {
  id: string; board: Board; kind: "conclusion" | "citation" | null; topic: string; question: string; weight: string | null;
  due_on: string | null; red: boolean; used_in: string; source: string;
}
/** A paragraph of the user's own notes that uses the recalled sentence (matched on the computer, nothing sent out). */
export interface Affected { doc_id: string; project_id: string; title: string; paragraph: string; sentence: string; score: number }
export interface Recall {
  id: string; entry_id: string; claim: string; paper: string; page: number; quote: string; board: Board; topic: string;
  question: string; answer: string; used_in: string; created_at: string; affected: Affected[];
}
/** 多设备推送 to this computer: a 召回单 from the phone, one settled elsewhere, a note that uses an AI answer. */
export interface Push { id: string; kind: "recall" | "recall_settled" | "entry" | "used"; entity_id: string; text: string; created_at: string }

export type Mastery = "own" | "settled" | "shaky" | "untested";
export interface ReportItem { id: string; topic: string; question: string; weight: string | null; status: Mastery; attempts: number; due_on: string | null }
/** 考前真实掌握度报告: independence counts only explanations given without AI. */
export interface Report {
  exam: string; as_of: string; topic: string | null; board: Board | null; total: number; counts: Record<Mastery, number>;
  independence: number | null; repay_before_exam: ReportItem[]; not_reachable_before_exam: ReportItem[];
}

export const useDebts = () => useQuery({ queryKey: ["mind", "due"], queryFn: ({ signal }) => api.get<Debt[]>("/mind-ledger/due", signal) });
/** Asks once a minute (no third-party push service); the caller shows each push and marks it seen. */
export const usePushes = (enabled: boolean) => useQuery({ queryKey: ["pushes"], enabled, refetchInterval: 60_000, retry: 0,
  queryFn: ({ signal }) => api.get<Push[]>("/pushes", signal) });
export const markPushesSeen = (ids: string[]) =>
  api.post<{ seen: number }>("/pushes/seen", { ids }, { idempotencyKey: `seen:${ids[0]}:${ids.length}` });
export const useRecalls = () => useQuery({ queryKey: ["mind", "recalls"], queryFn: ({ signal }) => api.get<Recall[]>("/mind-ledger/recalls", signal) });

export function useReport(exam: string, board: Board, topic: string) {
  const q = new URLSearchParams({ exam, board, ...(topic.trim() ? { topic: topic.trim() } : {}) });
  return useQuery({ queryKey: ["mind", "report", exam, board, topic.trim()], enabled: !!exam,
    queryFn: ({ signal }) => api.get<Report>(`/mind-ledger/report?${q}`, signal) });
}

export function useSettleRecall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, state }: { id: string; state: "accepted" | "dismissed" }) =>
      api.post<Recall>(`/mind-ledger/recalls/${id}`, { state }, { idempotencyKey: `recall:${id}:${state}` }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["mind"] }),
  });
}

/** A text split round a sentence in it, so the page can mark that sentence yellow (标黄): the recalled sentence in the
 * AI's answer, or the user's own sentence in an affected paragraph of their notes. */
export function marked(text: string, sentence: string): [string, string, string] {
  const at = sentence ? text.indexOf(sentence) : -1;
  return at < 0 ? [text, "", ""] : [text.slice(0, at), sentence, text.slice(at + sentence.length)];
}
