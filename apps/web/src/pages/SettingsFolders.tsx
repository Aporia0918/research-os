// The folders this computer may read or write (file roots). The owner sets them here; nothing outside them is ever
// opened, and the null-world exam only runs scripts that live inside a read folder.
import { useState } from "react";
import { FolderOpen, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { describeError } from "@/api/client";
import { qk, rootCalls, useFileRoots } from "@/api/queries";
import type { FileRoot } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { QueryView } from "@/components/layout/state";
import { newKey } from "@/lib/utils";

export function FoldersCard() {
  const { t } = useTranslation();
  const q = useFileRoots();
  const qc = useQueryClient();
  const [path, setPath] = useState("");
  const [access, setAccess] = useState<FileRoot["access"]>("read");
  const [busy, setBusy] = useState(false);
  const save = async (next: FileRoot[]) => {
    setBusy(true);
    try {
      qc.setQueryData(qk.fileRoots, await rootCalls.set(next, newKey()));
      setPath("");
    } catch (e) { toast.error(describeError(e)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader><CardTitle>{t("folders.title")}</CardTitle><CardDescription>{t("folders.description")}</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        <QueryView q={q}>{(roots) => roots.length ? (
          <ul className="divide-y">{roots.map((r) => (
            <li key={r.path} className="flex items-center gap-3 py-3">
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 break-all font-mono text-body-sm">{r.path}</span>
              <Badge tone={r.access === "write" ? "primary" : undefined}>{t(r.access === "write" ? "folders.write" : "folders.read")}</Badge>
              <Button variant="outline" size="sm" disabled={busy} aria-label={t("folders.remove", { path: r.path })}
                onClick={() => void save(roots.filter((x) => x.path !== r.path))}><Trash2 /></Button>
            </li>))}</ul>
        ) : <p className="text-body-sm text-muted-foreground">{t("folders.empty")}</p>}</QueryView>
        <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => {
          e.preventDefault();
          void save([...(q.data ?? []).filter((x) => x.path !== path.trim()), { path: path.trim(), access }]);
        }}>
          <Input id="folder-path" className="min-w-0 flex-1 font-mono" value={path} onChange={(e) => setPath(e.target.value)}
            placeholder={t("folders.pathPlaceholder")} aria-label={t("folders.path")} />
          <select className="jelly-field h-9 rounded-full px-3 text-body-sm" value={access} aria-label={t("folders.access")}
            onChange={(e) => setAccess(e.target.value as FileRoot["access"])}>
            <option value="read">{t("folders.read")}</option><option value="write">{t("folders.write")}</option>
          </select>
          <Button type="submit" disabled={busy || !path.trim() || !q.data}>{t("folders.add")}</Button>
        </form>
      </CardContent>
    </Card>
  );
}
