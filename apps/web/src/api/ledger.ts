// 思维账本 on the computer: the debts the phone sent (with board, red, kind, where they were used) and the open 召回单.
// Typed here because the ledger returns plain dicts in OpenAPI.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

export type Board = "学习" | "科研" | "生活";
export interface Debt {
  id: string; board: Board; kind: "conclusion" | "citation" | null; topic: string; question: string; weight: string | null;
  due_on: string | null; red: boolean; used_in: string; source: string;
}
export interface Recall {
  id: string; entry_id: string; claim: string; paper: string; page: number; quote: string; board: Board; topic: string;
  question: string; answer: string; used_in: string; created_at: string;
}

export type Mastery = "own" | "settled" | "shaky" | "untested";
export interface ReportItem { id: string; topic: string; question: string; weight: string | null; status: Mastery; attempts: number; due_on: string | null }
/** 考前真实掌握度报告: independence counts only explanations given without AI. */
export interface Report {
  exam: string; as_of: string; topic: string | null; board: Board | null; total: number; counts: Record<Mastery, number>;
  independence: number | null; repay_before_exam: ReportItem[]; not_reachable_before_exam: ReportItem[];
}

export const useDebts = () => useQuery({ queryKey: ["mind", "due"], queryFn: ({ signal }) => api.get<Debt[]>("/mind-ledger/due", signal) });
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

/** The answer split round the recalled sentence, so the page can mark it yellow (标黄) where the user reads it. */
export function marked(answer: string, claim: string): [string, string, string] {
  const at = answer.indexOf(claim);
  return at < 0 ? [answer, "", ""] : [answer.slice(0, at), claim, answer.slice(at + claim.length)];
}
