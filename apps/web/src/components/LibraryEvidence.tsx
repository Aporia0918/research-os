import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { literature, useLibraryWorks } from "@/api/knowledge";
import { useProjects } from "@/api/queries";
import { createCard, type CardKind } from "@/api/writing";
import type { VenueTiersInput } from "@/api/types";
import { ErrorState, QueryView } from "@/components/layout/state";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { newKey } from "@/lib/utils";

export function LibraryEvidence() {
  const { t } = useTranslation();
  const works = useLibraryWorks(); const [source, setSource] = useState(""); const [year, setYear] = useState("");
  const projects = useProjects(); const [project, setProject] = useState(""); const navigate = useNavigate();
  async function card(kind: CardKind, workId: string) {
    if (!project) throw new Error(t("evidence.chooseProject"));
    const what = kind === "card" ? t("evidence.paperCard") : t("evidence.methodsChecklist");
    if (!window.confirm(t("evidence.confirmCard", { what }))) return;
    const out = await createCard(kind, workId, project, newKey());
    navigate(`/projects/${encodeURIComponent(project)}/docs/${encodeURIComponent(out.doc.id)}`);
  }
  const [entries, setEntries] = useState(""); const [notice, setNotice] = useState("");
  const action = useMutation({ mutationFn: async (fn: () => Promise<void>) => { setNotice(""); await fn(); } });
  async function replace() {
    const data: unknown = JSON.parse(entries); const y = Number(year);
    if (!source.trim() || source.length > 100 || !Number.isInteger(y) || y < 1900 || y > 2100) throw new Error(t("evidence.badSourceYear"));
    if (!Array.isArray(data) || !data.length || data.length > 50000 || data.some(e => !e || typeof e !== "object" || Array.isArray(e) || !Object.values(e).every(v => typeof v === "string") || !e.tier?.trim() || !(e.venue?.trim() || e.issn?.trim()))) throw new Error(t("evidence.badEntries"));
    if (!window.confirm(t("evidence.confirmReplace", { source: source.trim() }))) return;
    await literature.tiers({ source: source.trim(), year: y, entries: data as VenueTiersInput["entries"] }, newKey());
    await works.refetch(); setNotice(t("evidence.tiersReplaced"));
  }
  return <section className="grid gap-3 [&_button]:min-h-11 [&_input]:min-h-11"><h2>{t("evidence.title")}</h2>
    <p>{t("evidence.intro")}</p>
    <Field label={t("evidence.projectField")} htmlFor="card-project"><select id="card-project" className="h-11 jelly-field rounded-[14px] px-3"
      value={project} onChange={e => setProject(e.target.value)}><option value="">{t("evidence.chooseProjectOption")}</option>
      {(projects.data ?? []).map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></Field>
    <QueryView q={works}>{rows => <>{!rows.length && <p>{t("evidence.noWorks")}</p>}{rows.length === 1000 && <p>{t("evidence.limit")}</p>}
      {rows.map(w => <article key={w.id} className="grid gap-2"><h3>{w.title || w.id}</h3><ul>{w.weight.map(label => <li key={label}>{label}</li>)}</ul>
        <Button disabled={action.isPending} onClick={() => action.mutate(async () => { const result = await literature.checkRetraction(w.id, newKey()); await works.refetch(); setNotice(t("evidence.retractionResult", { result: JSON.stringify(result) })); })}>{t("evidence.checkRetraction", { title: w.title || w.id })}</Button>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={action.isPending || !project} onClick={() => action.mutate(() => card("card", w.id))}>{t("evidence.paperCardButton")}</Button>
          <Button variant="outline" disabled={action.isPending || !project} onClick={() => action.mutate(() => card("methods-checklist", w.id))}>{t("evidence.methodsChecklistButton")}</Button>
        </div>
      </article>)}</>}</QueryView>
    <form className="grid gap-3" onSubmit={e => { e.preventDefault(); action.mutate(replace); }}>
      <h3>{t("evidence.replaceTitle")}</h3><p>{t("evidence.replaceIntro")}</p>
      <Field label={t("evidence.tierSource")} htmlFor="tier-source"><Input id="tier-source" required maxLength={100} value={source} disabled={action.isPending} onChange={e => setSource(e.target.value)} /></Field>
      <Field label={t("evidence.tierYear")} htmlFor="tier-year"><Input id="tier-year" type="number" required min={1900} max={2100} value={year} disabled={action.isPending} onChange={e => setYear(e.target.value)} /></Field>
      <Field label={t("evidence.tierEntries")} htmlFor="tier-entries" hint={<>{t("evidence.tierEntriesHint")} <code>{t("evidence.tierEntriesExample")}</code></>}><Textarea id="tier-entries" required value={entries} disabled={action.isPending} onChange={e => setEntries(e.target.value)} /></Field>
      <Button type="submit" disabled={action.isPending}>{t("evidence.replaceButton")}</Button>
    </form>
    {action.isPending && <p role="status">{t("evidence.updating")}</p>}{action.error && <ErrorState error={action.error} />}{notice && <p role="status">{notice}</p>}
  </section>;
}
