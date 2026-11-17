import { useCallback, useEffect, useState, type ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { replayPending } from "@/api/replay";
import { BookOpen, ChartScatter, FileSearch, FlaskConical, FolderKanban, ListTodo, MessageSquareQuote, Moon, Settings, Sun, Wifi,
  WifiOff, BookCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ParseKeys } from "i18next";
import { api } from "@/api/client";
import { cn } from "@/lib/utils";
import { useGlobalShortcuts } from "@/lib/shortcuts";
import { Button } from "@/components/ui/button";
import { Tip } from "@/components/ui/misc";
import { LanguageToggle } from "./language";
import { ShortcutHelp } from "./ShortcutHelp";
import { useTheme } from "./theme";
import { WhatsNew } from "./WhatsNew";

const NAV: { to: string; label: ParseKeys; icon: ReactNode; key: string }[] = [
  { to: "/projects", label: "nav.projects", icon: <FolderKanban />, key: "p" },
  { to: "/library", label: "nav.library", icon: <BookOpen />, key: "l" },
  { to: "/research", label: "nav.research", icon: <MessageSquareQuote />, key: "r" },
  { to: "/experiments", label: "nav.experiments", icon: <FlaskConical />, key: "" },
  { to: "/literature", label: "nav.literature", icon: <FileSearch />, key: "" },
  { to: "/studies", label: "nav.studies", icon: <ChartScatter />, key: "" },
  { to: "/ledger", label: "nav.ledger", icon: <BookCheck />, key: "" },
  { to: "/tasks", label: "nav.tasks", icon: <ListTodo />, key: "t" },
  { to: "/settings", label: "nav.settings", icon: <Settings />, key: "s" },
];

function Connection() {
  const { t } = useTranslation();
  const q = useQuery({ queryKey: ["health"], queryFn: () => api.get<{ status: string }>("/health"), refetchInterval: 10000, retry: 0 });
  const online = q.isSuccess && !q.isError;
  const qc = useQueryClient();
  useEffect(() => {  // foreground reconnect: deliver actions recorded while offline (same idempotency keys)
    if (!online) return;
    void replayPending().then((r) => {
      if (r.sent.length) { toast.success(t("shell.queuedDelivered", { count: r.sent.length })); void qc.invalidateQueries(); }
      if (r.failed.length) toast.error(t("shell.queuedRejected", { count: r.failed.length }));
    });
  }, [online, qc, t]);
  return (
    <Tip label={online ? t("shell.connectedTip") : t("shell.offlineTip")}>
      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-caption font-medium",
        online ? "bg-success/12 text-success" : "bg-warning/15 text-warning")} role="status">
        {online ? <Wifi className="size-3.5" /> : <WifiOff className="size-3.5" />}
        {q.isPending ? t("shell.connecting") : online ? t("shell.online") : t("shell.offline")}
      </span>
    </Tip>
  );
}

function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme } = useTheme();
  const dark = theme === "dark" || (theme === "system" && document.documentElement.classList.contains("dark"));
  return (
    <Tip label={dark ? t("shell.toLight") : t("shell.toDark")}>
      <Button variant="ghost" size="icon" aria-label={t("shell.toggleTheme")} onClick={() => setTheme(dark ? "light" : "dark")}>
        {dark ? <Sun /> : <Moon />}
      </Button>
    </Tip>
  );
}

// md..lg (iPad portrait): an icon rail, labels for screen readers and as a hover title; lg and up: the full sidebar.
const linkCls = ({ isActive }: { isActive: boolean }) =>
  cn("flex min-h-11 items-center justify-center gap-3 rounded-md px-3 py-2.5 lg:justify-start text-body-sm font-medium transition-colors [&_svg]:size-[18px]",
    isActive ? "bg-accent text-accent-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground");

export function AppShell() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [help, setHelp] = useState(false);
  useGlobalShortcuts(useCallback((to: string) => navigate(to), [navigate]), useCallback(() => setHelp(true), []));
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[4.5rem_1fr] lg:grid-cols-[13.5rem_1fr]">
      <aside className="sticky top-0 hidden h-dvh flex-col gap-1 border-r bg-card px-2 py-4 md:flex lg:px-3">
        <div className="mb-4 flex items-center justify-center gap-2 px-2 lg:justify-start">
          <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-body-sm font-bold text-primary-foreground">R</div>
          <div className="hidden text-title font-semibold lg:block">Research OS</div>
        </div>
        <nav className="grid gap-0.5" aria-label={t("nav.main")}>
          {NAV.map((n) => <NavLink key={n.to} to={n.to} className={linkCls} title={t(n.label)}>
            {n.icon}<span className="sr-only lg:not-sr-only">{t(n.label)}</span></NavLink>)}
        </nav>
        <div className="mt-auto hidden px-2 text-caption text-muted-foreground lg:block">{t("nav.shortcutHintBefore")}<span className="font-mono">?</span>{t("nav.shortcutHintAfter")}</div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center justify-end gap-2 border-b bg-background/85 px-4 backdrop-blur md:px-8">
          <div className="mr-auto text-title font-semibold lg:hidden">Research OS</div>
          <Connection />
          <LanguageToggle />
          <ThemeToggle />
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pb-24 pt-6 md:px-8 md:pb-10">
          <Outlet />
        </main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
        aria-label={t("nav.main")}>
        {NAV.map((n) => (
          <NavLink key={n.to} to={n.to}
            className={({ isActive }) => cn("flex min-h-14 min-w-20 flex-1 flex-col items-center justify-center gap-0.5 text-caption [&_svg]:size-5",
              isActive ? "text-primary" : "text-muted-foreground")}>
            {n.icon}{t(n.label)}
          </NavLink>
        ))}
      </nav>
      <ShortcutHelp open={help} onOpenChange={setHelp} />
      <WhatsNew />
    </div>
  );
}

/** Page title row; its bottom margin is dropped when a grid parent already spaces it (no doubled gap). */
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3 [.grid>&]:mb-0">
      <div className="grid gap-1">
        <h1 className="text-heading font-semibold tracking-tight">{title}</h1>
        {description ? <p className="text-body-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex gap-2">{actions}</div> : null}
    </div>
  );
}
