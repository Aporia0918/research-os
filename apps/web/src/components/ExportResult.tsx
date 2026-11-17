import { Download } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ExportOut } from "@/api/writing";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { diagnosticMessage, severityLabel } from "@/i18n/gateDiagnostics";

/** Result of an export (doc or run): status, downloadable files and diagnostics. One component for every export. */
export function ExportResult({ label, result }: { label: string; result: ExportOut }) {
  const { t } = useTranslation();
  return <Card><CardHeader><CardTitle>{t("export.resultTitle")}</CardTitle></CardHeader><CardContent className="grid gap-2">
    <p role="status">{label} · {result.status}</p>
    <ul className="grid gap-1">{result.files.map((file) => <li key={file.path}>
      <a className="inline-flex min-h-11 items-center gap-2 text-primary underline-offset-4 hover:underline"
        href={`/api/v1/exports/${encodeURIComponent(result.id)}/files/${encodeURIComponent(file.path.split("/").pop() ?? "")}`} download>
        <Download className="size-4" />{file.path.split("/").pop()}</a>
    </li>)}</ul>
    <ul>{result.diagnostics.map((d, i) => <li key={i} className={d.severity === "error" ? "text-destructive" : "text-muted-foreground"}>
      {severityLabel(d.severity)}: {d.code} — {diagnosticMessage(d)}{d.ref && ` (${d.ref})`}</li>)}</ul>
  </CardContent></Card>;
}

export type ExportLanguage = "en" | "zh-CN";
const EXPORT_LANGUAGES: readonly ExportLanguage[] = ["en", "zh-CN"];

/** Language of the exported document's fixed text (headings, captions; ADR-234). Content and numbers are unchanged.
 * English by default (academic slides), independent of the UI language. */
export function ExportLanguageSelect({ id, value, onChange }: { id: string; value: ExportLanguage; onChange: (v: ExportLanguage) => void }) {
  const { t } = useTranslation();
  return <label htmlFor={id} className="flex items-center gap-2 text-body-sm">{t("export.languageLabel")}
    <select id={id} className="h-11 jelly-field rounded-[14px] px-3" value={value}
      onChange={(e) => onChange(e.target.value === "zh-CN" ? "zh-CN" : "en")}>
      {EXPORT_LANGUAGES.map((l) => <option key={l} value={l} lang={l}>{t(`language.${l}`)}</option>)}
    </select></label>;
}
