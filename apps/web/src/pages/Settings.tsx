import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, CircleDashed } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import type { ParseKeys } from "i18next";
import { describeError } from "@/api/client";
import { authCalls, qk, useHost, useKeys } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/misc";
import { PageHeader } from "@/components/layout/AppShell";
import { QueryView } from "@/components/layout/state";
import { LanguageSelect } from "@/components/layout/language";
import { DevicesCard } from "./SettingsDevices";
import { FoldersCard } from "./SettingsFolders";
import { UpdatesCard } from "./SettingsUpdates";

type Tier = "routine" | "premium";
const PROVIDERS: { id: string; name: string; tier: Tier }[] = [
  { id: "deepseek", name: "DeepSeek", tier: "routine" }, { id: "zhipu", name: "GLM / Zhipu", tier: "routine" },
  { id: "qwen", name: "Qwen / DashScope", tier: "routine" },
  { id: "anthropic", name: "Anthropic (Claude)", tier: "premium" }, { id: "openai", name: "OpenAI", tier: "premium" },
];
const TIER_LABEL: Record<Tier, ParseKeys> = { routine: "settings.tierRoutine", premium: "settings.tierPremium" };

function KeyRow({ id, name, tier, configured, source }: { id: string; name: string; tier: Tier; configured: boolean; source: string | null }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  const save = async (v: string | null) => {
    setBusy(true);
    try {
      await authCalls.setKey(id, v, `key:${id}:${Date.now()}`);
      setVal("");
      toast.success(v ? t("settings.keySaved", { name }) : t("settings.keyRemoved", { name }));
      await qc.invalidateQueries({ queryKey: qk.keys });
    } catch (e) { toast.error(describeError(e)); } finally { setBusy(false); }
  };
  return (
    <li className="grid gap-2 py-3 md:grid-cols-[14rem_1fr_auto] md:items-center">
      <div className="flex items-center gap-2">
        {configured ? <CheckCircle2 className="size-4 text-success" /> : <CircleDashed className="size-4 text-muted-foreground" />}
        <span className="font-medium">{name}</span><Badge tone={tier === "premium" ? "primary" : "neutral"}>{t(TIER_LABEL[tier])}</Badge>
      </div>
      <Input type="password" autoComplete="off" placeholder={configured ? t("settings.keyConfigured", { source }) : t("settings.keyPaste")}
        value={val} onChange={(e) => setVal(e.target.value)} aria-label={t("settings.keyAria", { name })} />
      <div className="flex gap-2">
        <Button size="sm" disabled={!val} loading={busy} onClick={() => void save(val)}>{t("common.save")}</Button>
        {configured && source === "file" ? <Button size="sm" variant="ghost" onClick={() => void save(null)}>{t("common.remove")}</Button> : null}
      </div>
    </li>
  );
}

function KeysCard() {
  const { t } = useTranslation();
  const q = useKeys();
  return (
    <Card>
      <CardHeader><CardTitle>{t("settings.providersTitle")}</CardTitle>
        <CardDescription>{t("settings.providersDescription")}</CardDescription></CardHeader>
      <CardContent>
        <QueryView q={q}>{(k) => (
          <ul className="divide-y">{PROVIDERS.map((p) => <KeyRow key={p.id} {...p} configured={!!k[p.id]?.configured} source={k[p.id]?.source ?? null} />)}</ul>
        )}</QueryView>
      </CardContent>
    </Card>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2 text-body-sm">
      <span className="text-muted-foreground">{label}</span>
      {tone ? <Badge tone={tone}>{value}</Badge> : <span className="text-right font-mono text-caption">{value}</span>}
    </div>
  );
}

function HostCard() {
  const { t } = useTranslation();
  const q = useHost();
  return (
    <Card>
      <CardHeader><CardTitle>{t("settings.hostTitle")}</CardTitle><CardDescription>{t("settings.hostDescription")}</CardDescription></CardHeader>
      <CardContent>
        <QueryView q={q}>{(h) => {
          const g = (k: string) => (h[k] ?? {}) as Record<string, unknown>;
          const w = g("worker"); const db = g("db"); const disk = g("disk"); const net = g("network"); const gpu = g("gpu");
          return (
            <div className="divide-y">
              <Row label={t("settings.worker")} value={w.alive ? t("settings.workerRunning") : t("settings.workerStopped")} tone={w.alive ? "success" : "warning"} />
              <Row label={t("settings.database")} value={db.ok ? t("settings.dbOk", { version: String(db.schema_version) }) : t("settings.dbProblem")} tone={db.ok ? "success" : "danger"} />
              <Row label={t("settings.freeDisk")} value={t("settings.freeDiskValue", { gb: String(disk.free_gb ?? "?") })} tone={disk.low ? "warning" : undefined} />
              <Row label={t("settings.network")} value={net.loopback_only ? t("settings.networkLocal") : net.tls ? t("settings.networkLanTls") : t("settings.networkLanPlain")} />
              <Row label={t("settings.gpu")} value={gpu.detected ? t("settings.gpuYes") : t("settings.gpuNo")} tone={gpu.detected ? "success" : undefined} />
              <Row label={t("settings.lowPriv")} value={String(h.low_priv_worker)} tone={h.low_priv_worker === "configured" ? "success" : "warning"} />
            </div>
          );
        }}</QueryView>
      </CardContent>
    </Card>
  );
}

function GeneralCard() {
  const { t } = useTranslation();
  return <Card><CardHeader><CardTitle>{t("settings.generalTitle")}</CardTitle></CardHeader><CardContent><LanguageSelect /></CardContent></Card>;
}

export function SettingsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const logout = async () => { await authCalls.logout(`logout:${Date.now()}`).catch(() => undefined); qc.clear(); await qc.invalidateQueries({ queryKey: qk.auth }); };
  return (
    <>
      <PageHeader title={t("settings.title")} actions={<Button variant="outline" onClick={() => void logout()}>{t("settings.signOut")}</Button>} />
      <Tabs defaultValue="devices" className="grid gap-4">
        <TabsList className="w-fit"><TabsTrigger value="devices">{t("settings.tabDevices")}</TabsTrigger><TabsTrigger value="models">{t("settings.tabModels")}</TabsTrigger>
          <TabsTrigger value="folders">{t("settings.tabFolders")}</TabsTrigger>
          <TabsTrigger value="host">{t("settings.tabHost")}</TabsTrigger><TabsTrigger value="general">{t("settings.tabGeneral")}</TabsTrigger>
          <TabsTrigger value="about">{t("settings.tabAbout")}</TabsTrigger></TabsList>
        <TabsContent value="devices"><DevicesCard /></TabsContent>
        <TabsContent value="models"><KeysCard /></TabsContent>
        <TabsContent value="folders"><FoldersCard /></TabsContent>
        <TabsContent value="host"><HostCard /></TabsContent>
        <TabsContent value="general"><GeneralCard /></TabsContent>
        <TabsContent value="about"><UpdatesCard /></TabsContent>
      </Tabs>
    </>
  );
}
