// First-run setup (host only, with one-time token), password login, and iPad pairing.
import { useState, type FormEvent, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, MonitorSmartphone, ShieldCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import { describeError } from "@/api/client";
import { authCalls, qk } from "@/api/queries";
import type { AuthState } from "@/api/types";
import { Backdrop } from "@jelly/Backdrop";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/input";
import { codeFromHash } from "@/lib/pairLink";
import { newKey } from "@/lib/utils";

function Shell({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <Backdrop />
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="mb-2 grid size-10 place-items-center rounded-lg bg-primary/12 text-primary [&_svg]:size-5">{icon}</div>
          <CardTitle className="text-heading">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  );
}

function useSubmit(run: (key: string) => Promise<AuthState>) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [key] = useState(newKey);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(qk.auth, await run(key));
      await qc.invalidateQueries();
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit };
}

const defaultDevice = () => (/iPad|iPhone/.test(navigator.userAgent) ? "iPad" : i18n.t("auth.desktopBrowser"));

export function SetupPage() {
  const { t } = useTranslation();
  const [f, setF] = useState({ username: "", password: "", setup_token: "", device_name: defaultDevice() });
  const s = useSubmit((k) => authCalls.setup(f, k));
  return (
    <Shell icon={<ShieldCheck />} title={t("auth.setupTitle")} description={t("auth.setupDescription")}>
      <form className="grid gap-4" onSubmit={s.submit}>
        <Field label={t("auth.setupToken")} htmlFor="tok" hint={t("auth.setupTokenHint")}>
          <Input id="tok" autoFocus required value={f.setup_token} onChange={(e) => setF({ ...f, setup_token: e.target.value })} />
        </Field>
        <Field label={t("auth.username")} htmlFor="u">
          <Input id="u" autoComplete="username" required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        </Field>
        <Field label={t("auth.password")} htmlFor="p" hint={t("auth.passwordHint")}>
          <Input id="p" type="password" autoComplete="new-password" required minLength={10} value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Field label={t("auth.thisDeviceName")} htmlFor="d" error={s.error}>
          <Input id="d" value={f.device_name} onChange={(e) => setF({ ...f, device_name: e.target.value })} />
        </Field>
        <Button type="submit" size="touch" loading={s.busy}>{t("auth.createAccount")}</Button>
      </form>
    </Shell>
  );
}

export function LoginPage({ onPair }: { onPair: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState({ username: "", password: "", device_name: defaultDevice() });
  const s = useSubmit((k) => authCalls.login(f, k));
  return (
    <Shell icon={<KeyRound />} title={t("auth.signInTitle")} description={t("auth.signInDescription")}>
      <form className="grid gap-4" onSubmit={s.submit}>
        <Field label={t("auth.username")} htmlFor="u">
          <Input id="u" autoFocus autoComplete="username" required value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
        </Field>
        <Field label={t("auth.password")} htmlFor="p" error={s.error}>
          <Input id="p" type="password" autoComplete="current-password" required value={f.password}
            onChange={(e) => setF({ ...f, password: e.target.value })} />
        </Field>
        <Button type="submit" size="touch" loading={s.busy}>{t("auth.signIn")}</Button>
        <Button type="button" variant="ghost" onClick={onPair}><MonitorSmartphone />{t("auth.pairInstead")}</Button>
      </form>
    </Shell>
  );
}

export function PairPage({ onBack }: { onBack?: () => void }) {
  const { t } = useTranslation();
  const [f, setF] = useState(() => ({ code: codeFromHash(window.location.hash), device_name: defaultDevice() }));
  const s = useSubmit((k) => authCalls.pair(f, k));
  return (
    <Shell icon={<MonitorSmartphone />} title={t("auth.pairTitle")}
      description={t("auth.pairDescription")}>
      <form className="grid gap-4" onSubmit={s.submit}>
        <Field label={t("auth.pairingCode")} htmlFor="c" error={s.error}>
          <Input id="c" autoFocus required autoCapitalize="characters" className="font-mono text-title tracking-[0.3em] uppercase"
            maxLength={9} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} />
        </Field>
        <Field label={t("auth.deviceName")} htmlFor="d">
          <Input id="d" value={f.device_name} onChange={(e) => setF({ ...f, device_name: e.target.value })} />
        </Field>
        <Button type="submit" size="touch" loading={s.busy}>{t("auth.pairDevice")}</Button>
        {onBack ? <Button type="button" variant="ghost" onClick={onBack}>{t("auth.backToSignIn")}</Button> : null}
      </form>
    </Shell>
  );
}
