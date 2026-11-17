import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { ErrorState } from "@/components/layout/state";
import { formatNumber, newKey } from "@/lib/utils";

interface PairedOut { windows: number; accuracy_a: number; accuracy_b: number; difference_b_minus_a: number;
  difference_ci95: [number, number]; difference_ci_method: string; cohen_h: number; minimum_detectable_h_80: number;
  mcnemar: { p_exact?: number; p_mid?: number; b?: number; c?: number }; caveat: string; power_note: string }

/** Paired comparison with another run on the same windows and seed (ADR-191/193): statistics from diag_stats. */
export function PairedRuns({ runId }: { runId: string }) {
  const { t } = useTranslation();
  const [other, setOther] = useState(""); const [split, setSplit] = useState("search_val");
  const cmp = useMutation({ mutationFn: () => api.post<PairedOut>(`/runs/${encodeURIComponent(runId)}/paired`,
    { other_run_id: other.trim(), split }, { idempotencyKey: newKey() }) });
  const f = formatNumber; const d = cmp.data;
  return <section className="grid gap-2"><h2 className="text-title">{t("paired.title")}</h2>
    <p className="text-body-sm text-muted-foreground">{t("paired.intro")}</p>
    <form className="grid gap-2" onSubmit={e => { e.preventDefault(); cmp.mutate(); }}>
      <Field label={t("paired.other")} htmlFor="paired-other"><Input id="paired-other" className="h-11" required value={other} onChange={e => setOther(e.target.value)} /></Field>
      <Field label={t("paired.split")} htmlFor="paired-split"><select id="paired-split" className="h-11 jelly-field rounded-[14px] px-3" value={split} onChange={e => setSplit(e.target.value)}>
        <option value="search_val">search_val</option><option value="confirm_val">confirm_val</option><option value="test">test</option></select></Field>
      <Button type="submit" size="touch" disabled={cmp.isPending || !other.trim()}>{t("common.compare")}</Button>
    </form>
    {cmp.error && <ErrorState error={cmp.error} />}
    {d && <dl className="grid gap-1 text-body-sm sm:grid-cols-[14rem_1fr]">
      <dt>{t("paired.windows")}</dt><dd className="tabular-nums">{d.windows}</dd>
      <dt>{t("paired.accuracy")}</dt><dd className="tabular-nums">{f(d.accuracy_a)} / {f(d.accuracy_b)}</dd>
      <dt>{t("paired.difference")}</dt><dd className="tabular-nums">{f(d.difference_b_minus_a)} ({t("paired.range", { low: f(d.difference_ci95[0]), high: f(d.difference_ci95[1]) })})</dd>
      <dt>{t("paired.mcnemar")}</dt><dd className="tabular-nums">{d.mcnemar.p_exact === undefined ? "—" : f(d.mcnemar.p_exact)} / {d.mcnemar.p_mid === undefined ? "—" : f(d.mcnemar.p_mid)}</dd>
      <dt>{t("paired.cohen")}</dt><dd className="tabular-nums">{f(d.cohen_h)}</dd>
      <dt>{t("paired.mdh")}</dt><dd className="tabular-nums">{f(d.minimum_detectable_h_80)}</dd>
      <dd className="text-muted-foreground sm:col-span-2">{d.caveat}. {d.power_note}. {t("paired.interval", { method: d.difference_ci_method })}</dd>
    </dl>}
  </section>;
}
