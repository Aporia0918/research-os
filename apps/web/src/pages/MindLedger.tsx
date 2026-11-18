// 思维账本 on the computer, in the same look as the phone: 账账 and the board switch on a jelly hero, then the picked
// board's open 召回单 (the recalled sentence marked yellow in the AI's answer, the paper's own sentence and page beside
// it, where the user used it, and the paragraphs of their notes that use it, marked yellow too), then what is due on
// that board. Repaying stays on the phone.
import { BookCheck, FileDown, Undo2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { describeError } from "@/api/client";
import { marked, useDebts, useRecalls, useReport, useSettleRecall, type Affected, type Debt, type Mastery, type Recall } from "@/api/ledger";
import { Field, Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/AppShell";
import { EmptyState, QueryView } from "@/components/layout/state";
import { DESK_BOARDS, useBoard } from "@/components/layout/board";
import { BoardSwitch } from "@jelly/BoardSwitch";
import { Zhangzhang, type ZzState } from "@jelly/Zhangzhang";
import { RESIDENT } from "@jelly/mood";

const BOARD_KEY = { 学习: "study", 科研: "research", 生活: "life" } as const;

const Yellow = ({ text, sentence }: { text: string; sentence: string }) => {
  const [before, hit, after] = marked(text, sentence);
  return <>{before}{hit ? <mark className="rounded bg-warning/30 px-0.5 text-foreground">{hit}</mark> : null}{after}</>;
};

/** 标黄: where the user's own notes use the recalled sentence, so they know which paragraphs to fix. */
function Affects({ list }: { list: Affected[] }) {
  const { t } = useTranslation();
  if (!list.length) return null;
  return (
    <div className="grid gap-2" data-testid="affected">
      <span className="text-caption text-muted-foreground">{t("ledger.affected", { count: list.length })}</span>
      {list.map((a) => (
        <div key={`${a.doc_id}:${a.paragraph}`} className="grid gap-1 rounded-md border border-warning/40 p-2">
          <Link to={`/projects/${a.project_id}`} className="text-caption font-medium underline-offset-2 hover:underline">{a.title || t("ledger.untitled")}</Link>
          <p className="text-body-sm"><Yellow text={a.paragraph} sentence={a.sentence} /></p>
        </div>
      ))}
    </div>
  );
}

function RecallCard({ r }: { r: Recall }) {
  const { t } = useTranslation();
  const settle = useSettleRecall();
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
          <p className="text-body-sm"><Yellow text={r.answer} sentence={r.claim} /></p>
        </div>
        <div className="grid gap-1">
          <span className="text-caption text-muted-foreground">{t("ledger.paperSays", { paper: r.paper, page: r.page })}</span>
          <blockquote className="border-l-2 border-warning pl-3 text-body-sm">{r.quote}</blockquote>
        </div>
      </div>
      <Affects list={r.affected ?? []} />
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
        <BoardSwitch board={board} onPick={pick} boards={DESK_BOARDS} name={(b) => t(`ledger.boardName.${BOARD_KEY[b]}`)}
          className="jelly-track max-w-xs lg:hidden" />
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

const MASTERY: Mastery[] = ["own", "settled", "shaky", "untested"];

/** 考前真实掌握度报告 for the picked board: pick the exam (or group meeting) day and, if wanted, one course; print to PDF. */
function MasteryReport({ board }: { board: keyof typeof BOARD_KEY }) {
  const { t } = useTranslation();
  const [exam, setExam] = useState("");
  const [topic, setTopic] = useState("");
  const r = useReport(exam, board, topic);
  return (
    <Card className="mt-6 grid gap-4 p-5" data-print-report data-testid="report">
      <div className="grid gap-1">
        <h2 className="text-title font-semibold">{t("ledger.report.title")}</h2>
        <p className="text-body-sm text-muted-foreground">{t("ledger.report.howCounted")}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end" data-print-hide>
        <Field label={t("ledger.report.exam")} htmlFor="report-exam"><Input id="report-exam" type="date" value={exam} onChange={(e) => setExam(e.target.value)} /></Field>
        <Field label={t("ledger.report.topic")} htmlFor="report-topic"><Input id="report-topic" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder={t("ledger.report.allTopics")} /></Field>
        <Button variant="outline" disabled={!r.data} onClick={() => window.print()}><FileDown />{t("ledger.report.pdf")}</Button>
      </div>
      {!exam ? <p className="text-body-sm text-muted-foreground">{t("ledger.report.pickDay")}</p> : (
        <QueryView q={r}>
          {(rep) => (
            <div className="grid gap-4">
              <p className="text-body-sm text-muted-foreground">{t("ledger.report.asOf", { exam: rep.exam, today: rep.as_of, count: rep.total })}</p>
              <div className="flex flex-wrap items-end gap-6">
                <div><span className="text-display font-semibold" data-testid="independence">
                  {rep.independence === null ? "—" : `${Math.round(rep.independence * 100)}%`}</span>
                  <span className="ml-2 text-body-sm text-muted-foreground">{t("ledger.report.independence")}</span></div>
                {MASTERY.map((m) => <div key={m} className="text-body-sm"><span className="text-title font-semibold">{rep.counts[m]}</span>
                  <span className="ml-1 text-muted-foreground">{t(`ledger.report.status.${m}`)}</span></div>)}
              </div>
              {rep.repay_before_exam.length ? (
                <div className="grid gap-1">
                  <h3 className="font-medium">{t("ledger.report.repayFirst", { count: rep.repay_before_exam.length })}</h3>
                  <ol className="list-decimal divide-y pl-5">{rep.repay_before_exam.map((i) => (
                    <li key={i.id} className="py-1.5" data-testid="report-item"><span className="mr-2 text-caption text-muted-foreground">{i.due_on}</span>
                      {i.question}<span className="ml-2 text-caption text-muted-foreground">{t(`ledger.report.status.${i.status}`)}</span></li>))}</ol>
                </div>
              ) : <p className="text-body-sm">{t("ledger.report.nothingBefore")}</p>}
              {rep.not_reachable_before_exam.length ? <p className="text-body-sm text-muted-foreground">
                {t("ledger.report.later", { count: rep.not_reachable_before_exam.length })}</p> : null}
            </div>
          )}
        </QueryView>
      )}
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
      <MasteryReport board={board} />
    </>
  );
}
