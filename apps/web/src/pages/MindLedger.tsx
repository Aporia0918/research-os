// 思维账本 on the computer, in the same look as the phone: 账账 and the board switch on a jelly hero, then the picked
// board's open 召回单 (the recalled sentence marked yellow in the AI's answer, the paper's own sentence and page beside
// it, and where the user used it), then what is due on that board. Repaying stays on the phone.
import { BookCheck, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { describeError } from "@/api/client";
import { marked, useDebts, useRecalls, useSettleRecall, type Debt, type Recall } from "@/api/ledger";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/AppShell";
import { EmptyState, QueryView } from "@/components/layout/state";
import { useBoard } from "@/components/layout/board";
import { BoardSwitch } from "@jelly/BoardSwitch";
import { Zhangzhang, type ZzState } from "@jelly/Zhangzhang";
import { RESIDENT } from "@jelly/mood";

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

/** 账账 and the board switch, with how many of the board's debts are due and how many are red. */
function Hero({ board, mine }: { board: keyof typeof BOARD_KEY; mine: Debt[] | null }) {
  const { t } = useTranslation();
  const [, pick] = useBoard();
  const red = mine?.filter((d) => d.red).length ?? 0;
  const zz: ZzState = red ? "dun" : RESIDENT[board];
  return (
    <Card className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[26px] p-5" data-testid="ledger-hero">
      <Zhangzhang state={zz} size={120} label={t("ledger.mascot")} />
      <div className="grid min-w-0 flex-1 gap-3">
        <BoardSwitch board={board} onPick={pick} name={(b) => t(`ledger.boardName.${BOARD_KEY[b]}`)} className="max-w-sm bg-card/60" />
        {mine ? (
          <p className="text-body-sm text-muted-foreground">
            <span className="mr-1 text-display font-semibold text-foreground" data-testid="owed">{mine.length}</span>
            {t("ledger.owed")}{red ? <span className="ml-3 text-destructive">{t("ledger.redCount", { count: red })}</span> : null}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

export function MindLedgerPage() {
  const { t } = useTranslation();
  const [board] = useBoard();
  const recalls = useRecalls();
  const debts = useDebts();
  const mine = debts.data?.filter((d) => d.board === board) ?? null;
  return (
    <>
      <PageHeader title={t("ledger.title")} description={t("ledger.description")} />
      <Hero board={board} mine={mine} />
      <QueryView q={recalls}>
        {(list) => {
          const open = list.filter((r) => r.board === board);
          return open.length ? <div className="mb-6 grid gap-3">{open.map((r) => <RecallCard key={r.id} r={r} />)}</div> : null;
        }}
      </QueryView>
      <QueryView q={debts}>
        {(list) => {
          const due = list.filter((d) => d.board === board);
          return due.length === 0 ? (
            <EmptyState icon={<BookCheck />} title={t("ledger.emptyTitle")} body={t("ledger.emptyBody")} />
          ) : (
            <Card className="p-4">
              <h2 className="mb-2 font-semibold">{t(`ledger.board.${BOARD_KEY[board]}`, { count: due.length })}</h2>
              <ul className="divide-y">{due.map((d) => <DebtRow key={d.id} d={d} />)}</ul>
            </Card>
          );
        }}
      </QueryView>
    </>
  );
}
