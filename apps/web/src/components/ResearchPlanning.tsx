import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { api } from "@/api/client";
import { useExperimentTemplates } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/input";
import { ErrorState } from "@/components/layout/state";
import { newKey } from "@/lib/utils";

type Status = "ok" | "at_risk" | "blocked" | "unknown" | "covered" | "thin" | "gap" | "weak" | "contested";
const TONE: Record<Status, "success" | "warning" | "danger" | "neutral"> = { ok: "success", covered: "success",
  at_risk: "warning", thin: "warning", weak: "warning", contested: "warning", blocked: "danger", gap: "danger", unknown: "neutral" };
interface FeasibilityOut { doc: { id: string }; status: Record<string, { status: Status; reason: string }> }
interface GapCell { terms: Record<string, string>; status: Status; works: string[] }
interface GapMap { cells: GapCell[]; claims_used: number; counts: Record<string, number> }

/** "Name: term, term | alternative" per line -> axes for the gap map (1-2 lines). */
export function parseAxes(text: string): Record<string, (string | string[])[]> {
  const axes: Record<string, (string | string[])[]> = {};
  for (const line of text.split("\n").map(l => l.trim()).filter(Boolean)) {
    const [name, terms] = line.includes(":") ? [line.slice(0, line.indexOf(":")), line.slice(line.indexOf(":") + 1)] : ["", ""];
    if (!name.trim() || !terms.trim()) throw new Error(i18n.t("planning.axisFormat", { line }));
    axes[name.trim()] = terms.split(",").map(t => t.split("|").map(a => a.trim()).filter(Boolean)).filter(a => a.length)
      .map(a => (a.length === 1 ? (a[0] as string) : a));
  }
  return axes;
}

/** A result made for another project is never shown under this one (review #78). */
function forProject<T>(d: { pid: string; out: T } | null | undefined, pid: string): T | null {
  return d && d.pid === pid ? d.out : null;
}

/** Topic feasibility (ADR-181, paid cited QA) and the evidence-gap map (ADR-182, no model) for one project. */
export function ResearchPlanning({ pid }: { pid: string }) {
  const { t } = useTranslation();
  const templates = useExperimentTemplates();
  const datasets = useQuery({ queryKey: ["datasets"], queryFn: ({ signal }) => api.get<{ id: string; name: string; version: string }[]>("/datasets", signal) });
  const [topic, setTopic] = useState(""); const [dataset, setDataset] = useState(""); const [template, setTemplate] = useState("");
  const [axes, setAxes] = useState("");
  // Results carry the project they were made for; a result (or a late response) for another project is never shown
  // under this one (review #78). The project page also remounts this card per project.
  const feas = useMutation({ mutationFn: async () => {
    if (!window.confirm(t("planning.confirmFeasibility"))) return null;
    const out = await api.post<FeasibilityOut>(`/projects/${encodeURIComponent(pid)}/feasibility`, { topic, dataset_ids: dataset ? [dataset] : [],
      template_id: template || null }, { idempotencyKey: newKey() });
    return { pid, out };
  } });
  const gaps = useMutation({ mutationFn: async () => ({ pid, out: await api.post<GapMap>("/claims/gap-map", { project_id: pid, axes: parseAxes(axes) }, { idempotencyKey: newKey() }) }) });
  const feasOut = forProject(feas.data, pid); const gapOut = forProject(gaps.data, pid);
  const sel = "h-11 jelly-field rounded-[14px] px-3";
  return <Card>
    <CardHeader><CardTitle>{t("planning.title")}</CardTitle><CardDescription>{t("planning.description")}</CardDescription></CardHeader>
    <CardContent className="grid gap-4">
      <form className="grid gap-2" onSubmit={e => { e.preventDefault(); feas.mutate(); }}>
        <Field label={t("planning.topic")} htmlFor="feas-topic"><Input id="feas-topic" className="h-11" minLength={3} maxLength={300} required value={topic} onChange={e => setTopic(e.target.value)} /></Field>
        <Field label={t("planning.dataset")} htmlFor="feas-dataset"><select id="feas-dataset" className={sel} value={dataset} onChange={e => setDataset(e.target.value)}>
          <option value="">{t("planning.noneSelected")}</option>{(datasets.data ?? []).map(d => <option key={d.id} value={d.id}>{d.name} {d.version}</option>)}</select></Field>
        <Field label={t("planning.template")} htmlFor="feas-template"><select id="feas-template" className={sel} value={template} onChange={e => setTemplate(e.target.value)}>
          <option value="">{t("planning.noneSelected")}</option>{(templates.data ?? []).map(tpl => <option key={tpl.id} value={tpl.id}>{tpl.id}</option>)}</select></Field>
        <Button type="submit" size="touch" disabled={feas.isPending || topic.trim().length < 3}>{t("planning.check")}</Button>
      </form>
      {feas.error && <ErrorState error={feas.error} />}
      {feasOut && <FeasibilityResult pid={pid} out={feasOut} />}
      <form className="grid gap-2" onSubmit={e => { e.preventDefault(); gaps.mutate(); }}>
        <Field label={t("planning.axes")} htmlFor="gap-axes" hint={<>{t("planning.axesHint")} <code>{t("planning.axesExample")}</code></>}><Textarea id="gap-axes" value={axes} onChange={e => setAxes(e.target.value)} /></Field>
        <Button type="submit" size="touch" disabled={gaps.isPending || !axes.trim()}>{t("planning.map")}</Button>
      </form>
      {gaps.error && <ErrorState error={gaps.error} />}
      {gapOut && <GapResult out={gapOut} />}
    </CardContent>
  </Card>;
}

function FeasibilityResult({ pid, out }: { pid: string; out: FeasibilityOut }) {
  const { t } = useTranslation();
  return <div className="grid gap-2"><ul className="grid gap-1">{Object.entries(out.status).map(([k, v]) =>
        <li key={k}><Badge tone={TONE[v.status]}>{k}: {v.status.replace("_", " ")}</Badge> <span className="text-body-sm">{v.reason}</span></li>)}</ul>
        <Button asChild variant="link"><Link to={`/projects/${encodeURIComponent(pid)}/docs/${encodeURIComponent(out.doc.id)}`}>{t("planning.openDoc")}</Link></Button></div>;
}

function GapResult({ out }: { out: GapMap }) {
  const { t } = useTranslation();
  return <div className="grid gap-1"><p className="text-body-sm text-muted-foreground">{t("planning.gapIntro", { count: out.claims_used })}</p>
        <ul className="grid gap-1">{out.cells.map(c => <li key={Object.values(c.terms).join("|")}>
          <Badge tone={TONE[c.status]}>{c.status}</Badge> {Object.values(c.terms).join(" × ")} <span className="text-body-sm text-muted-foreground">{t("planning.works", { count: c.works.length })}</span></li>)}</ul></div>;
}
