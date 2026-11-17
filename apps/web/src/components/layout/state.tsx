// Every page uses these for loading / empty / error / offline / forbidden states (baseline §11).
import type { ReactNode } from "react";
import type { UseQueryResult } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { CloudOff, Lock, RotateCw } from "lucide-react";
import { ZZ } from "@jelly/Zhangzhang";
import { ApiError, OfflineError, describeError } from "@/api/client";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";

function Panel({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="jelly-glass flex flex-col items-center justify-center gap-3 rounded-[26px] px-6 py-12 text-center">
      <div className="text-muted-foreground [&_svg]:size-8">{icon}</div>
      <div className="text-title font-semibold">{title}</div>
      {body ? <div className="max-w-md text-body-sm text-muted-foreground">{body}</div> : null}
      {action}
    </div>
  );
}

export function EmptyState({ title, body, action, icon }: { title: string; body?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  // Nothing here yet: 账账 dozes, as on the phone.
  return <Panel icon={icon ?? <img src={ZZ.sleepy.img} alt="" className="size-24" draggable={false} />} title={title} body={body} action={action} />;
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const { t } = useTranslation();
  if (error instanceof OfflineError) {
    return <Panel icon={<CloudOff />} title={t("state.offlineTitle")} body={describeError(error)}
      action={onRetry ? <Button variant="outline" onClick={onRetry}><RotateCw />{t("common.tryAgain")}</Button> : undefined} />;
  }
  if (error instanceof ApiError && error.status === 403) {
    return <Panel icon={<Lock />} title={t("state.forbiddenTitle")} body={describeError(error)} />;
  }
  return <Panel icon={<img src={ZZ.confused.img} alt="" className="size-20" draggable={false} />} title={t("state.errorTitle")} body={describeError(error)}
    action={onRetry ? <Button variant="outline" onClick={onRetry}><RotateCw />{t("common.tryAgain")}</Button> : undefined} />;
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  const { t } = useTranslation();
  return (
    <div className="grid gap-3" role="status" aria-label={t("common.loading")}>
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-16" />)}
    </div>
  );
}

/** Render a query with consistent states. Cached data shown while offline is labelled as such. */
export function QueryView<T>({ q, empty, children, skeleton }: {
  q: UseQueryResult<T>; empty?: (d: T) => boolean; children: (d: T) => ReactNode; skeleton?: ReactNode;
}) {
  const { t } = useTranslation();
  if (q.isPending) return <>{skeleton ?? <ListSkeleton />}</>;
  if (q.isError && q.data === undefined) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data as T;
  return (
    <>
      {q.isError ? (
        <div className="mb-3 flex items-center gap-2 rounded-md bg-warning/15 px-3 py-2 text-body-sm text-warning" role="status">
          <CloudOff className="size-4" /> {t("state.savedCopy")}
        </div>
      ) : null}
      {empty?.(data) ? null : children(data)}
    </>
  );
}
