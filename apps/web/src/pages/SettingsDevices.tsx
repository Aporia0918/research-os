import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Laptop, Smartphone } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { describeError } from "@/api/client";
import { authCalls, qk, useDevices } from "@/api/queries";
import type { Device, PairingCode } from "@/api/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ConfirmDialog, Dialog, DialogContent } from "@/components/ui/dialog";
import { QueryView } from "@/components/layout/state";
import { pairLink } from "@/lib/pairLink";
import { formatTime, newKey, relativeTime } from "@/lib/utils";

function PairingCodeView() {
  const { t } = useTranslation();
  const [code, setCode] = useState<PairingCode | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    authCalls.pairingCode("iPad", newKey()).then(async (c) => {
      if (!alive) return;
      setCode(c);
      if (c.pair_url) {
        const url = await QRCode.toDataURL(pairLink(c.pair_url, c.code), { margin: 1, width: 200 });
        if (alive) setQr(url);
      }
    }).catch((e: unknown) => alive && setErr(describeError(e)));
    return () => { alive = false; };
  }, []);
  if (err) return <p className="text-body-sm text-destructive">{err}</p>;
  if (!code) return <p className="text-body-sm text-muted-foreground">{t("devices.creatingCode")}</p>;
  return (
    <div className="grid justify-items-center gap-3">
      <div className="rounded-lg bg-muted px-6 py-4 font-mono text-display tracking-[0.3em]">{code.code.slice(0, 4)}-{code.code.slice(4)}</div>
      {qr ? <img src={qr} alt={t("devices.qrAlt")} className="size-40 rounded-md bg-white p-1" /> : null}
      <p className="text-caption text-muted-foreground">{t("devices.validUntil", { time: formatTime(code.expires_at) })}</p>
      {!code.pair_url ? <p className="text-center text-caption text-muted-foreground">{t("devices.noLan")}</p> : null}
    </div>
  );
}

function PairDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={t("devices.pairTitle")} description={t("devices.pairDescription")}>
        {open ? <PairingCodeView /> : null}
      </DialogContent>
    </Dialog>
  );
}

function DeviceRow({ d, onRevoke }: { d: Device; onRevoke: (d: Device) => void }) {
  const { t } = useTranslation();
  return (
    <li className="flex items-center gap-3 py-3">
      <div className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4">{d.is_host ? <Laptop /> : <Smartphone />}</div>
      <div className="grid min-w-0 flex-1 gap-0.5">
        <div className="flex items-center gap-2 font-medium">{d.name}{d.current ? <Badge tone="primary">{t("devices.thisDevice")}</Badge> : null}
          {d.revoked_at ? <Badge tone="danger">{t("devices.revoked")}</Badge> : null}{d.is_host ? <Badge>{t("devices.host")}</Badge> : null}</div>
        <div className="text-caption text-muted-foreground">{t("devices.pairedVia", { via: d.paired_via.replace("_", " "), seen: relativeTime(d.last_seen_at) })}</div>
      </div>
      {!d.revoked_at && !d.current ? <Button variant="outline" size="sm" onClick={() => onRevoke(d)}>{t("devices.revoke")}</Button> : null}
    </li>
  );
}

export function DevicesCard() {
  const { t } = useTranslation();
  const q = useDevices();
  const qc = useQueryClient();
  const [pairOpen, setPairOpen] = useState(false);
  const [revoke, setRevoke] = useState<Device | null>(null);
  const [busy, setBusy] = useState(false);
  const doRevoke = async () => {
    if (!revoke) return;
    setBusy(true);
    try {
      await authCalls.revokeDevice(revoke.id, `revoke:${revoke.id}`);
      toast.success(t("devices.revokedToast", { name: revoke.name }));
      await qc.invalidateQueries({ queryKey: qk.devices });
      setRevoke(null);
    } catch (e) { toast.error(describeError(e)); } finally { setBusy(false); }
  };
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between">
        <div className="grid gap-1"><CardTitle>{t("devices.title")}</CardTitle><CardDescription>{t("devices.description")}</CardDescription></div>
        <Button onClick={() => setPairOpen(true)}><Smartphone />{t("devices.pair")}</Button>
      </CardHeader>
      <CardContent>
        <QueryView q={q}>{(list) => <ul className="divide-y">{list.map((d) => <DeviceRow key={d.id} d={d} onRevoke={setRevoke} />)}</ul>}</QueryView>
      </CardContent>
      <PairDialog open={pairOpen} onOpenChange={(o) => { setPairOpen(o); if (!o) void qc.invalidateQueries({ queryKey: qk.devices }); }} />
      <ConfirmDialog open={!!revoke} onOpenChange={(o) => !o && setRevoke(null)} destructive busy={busy}
        title={t("devices.revokeTitle", { name: revoke?.name ?? t("devices.revokeFallbackName") })} confirmLabel={t("devices.revokeConfirm")} onConfirm={() => void doRevoke()}
        description={t("devices.revokeDescription")} />
    </Card>
  );
}
