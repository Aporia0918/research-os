// 思维账本 on the computer: open 召回单 first (the recalled sentence marked yellow in the AI's answer, the paper's own
// sentence and page beside it, and where the user used it), then what is due, by board. Repaying stays on the phone.
import { BookCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { describeError } from "@/api/client";
import { marked, useDebts, useRecalls, useSettleRecall, type Board, type Debt, type Recall } from "@/api/ledger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/AppShell";
import { EmptyState, QueryView } from "@/components/layout/state";

const BOARDS: Board[] = ["学习", "科研", "生活"];
const BOARD_KEY = { 学习: "study", 科研: "research", 生活: "life" } as const;

function RecallCard({ r }: { r: Recall }) {
  const { t } = useTranslation();
  const settle = useSettleRecall();
  const [before, claim, after] = marked(r.answer, r.claim);
  const go = (state: "accepted" | "dismissed") => settle.mutate({ id: r.id, state }, {
    onSuccess: () => toast.success(state === "accepted" ? t("ledger.reopened") : t("ledger.dismissed")),
    onError: (e) => toast.error(describeError(e)),
  });
  return (
    <Card className="grid gap-3 p-4" data-testid="recall">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="warning">{t("ledger.recall")}</Badge>
        <span className="font-medium">{r.question}</span>
        {r.used_in ? <Badge tone="info">{t("ledger.usedIn", { where: r.used_in })}</Badge> : null}
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="grid gap-1">
          <span className="text-caption text-muted-foreground">{t("ledger.aiSaid")}</span>
          <p className="text-body-sm">{before}{claim ? <mark className="rounded bg-warning/30 px-0.5 text-foreground">{claim}</mark> : null}{after}</p>
        </div>
        <div className="grid gap-1">
          <span className="text-caption text-muted-foreground">{t("ledger.paperSays", { paper: r.paper, page: r.page })}</span>
          <blockquote className="border-l-2 border-warning pl-3 text-body-sm">{r.quote}</blockquote>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" loading={settle.isPending} onClick={() => go("accepted")}><Undo2 />{t("ledger.accept")}</Button>
        <Button size="sm" variant="outline" disabled={settle.isPending} onClick={() => go("dismissed")}>{t("ledger.dismiss")}</Button>
      </div>
    </Card>
  );
}

function DebtRow({ d }: { d: Debt }) {
  const { t } = useTranslation();
  return (
    <li className="flex flex-wrap items-center gap-2 py-1.5" data-testid="debt">
      {d.red ? <Badge tone="danger">{t(d.kind === "conclusion" ? "ledger.crashed" : "ledger.red")}</Badge> : null}
      {d.kind ? <Badge tone="primary">{t(`ledger.kind.${d.kind}`)}</Badge> : null}
      <span className="min-w-0 flex-1 truncate">{d.question}</span>
      {d.used_in ? <span className="text-caption text-muted-foreground">{t("ledger.usedIn", { where: d.used_in })}</span> : null}
      <span className="text-caption text-muted-foreground">{d.topic}</span>
    </li>
  );
}

export function MindLedgerPage() {
  const { t } = useTranslation();
  const recalls = useRecalls();
  const debts = useDebts();
  return (
    <>
      <PageHeader title={t("ledger.title")} description={t("ledger.description")} />
      <QueryView q={recalls}>
        {(list) => list.length ? <div className="mb-6 grid gap-3">{list.map((r) => <RecallCard key={r.id} r={r} />)}</div> : null}
      </QueryView>
      <QueryView q={debts}>
        {(list) => list.length === 0 ? (
          <EmptyState icon={<BookCheck />} title={t("ledger.emptyTitle")} body={t("ledger.emptyBody")} />
        ) : (
          <div className="grid gap-3 md:grid-cols-3">
            {BOARDS.map((b) => {
              const mine = list.filter((d) => d.board === b);
              return mine.length ? (
                <Card key={b} className="p-4">
                  <h2 className="mb-2 font-semibold">{t(`ledger.board.${BOARD_KEY[b]}`, { count: mine.length })}</h2>
                  <ul className="divide-y">{mine.map((d) => <DebtRow key={d.id} d={d} />)}</ul>
                </Card>
              ) : null;
            })}
          </div>
        )}
      </QueryView>
    </>
  );
}
