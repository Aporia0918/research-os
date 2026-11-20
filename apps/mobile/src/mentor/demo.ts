// Sample data so the prototype can be shown with no key and no real advisor. Names are made up.
import { newId } from '../local/store';
import type { MentorData } from './store';
import type { Busy, Step, Task } from './types';

const DAY = 86_400_000;
const step = (title: string, output: string, minutes: number, done = false, actualMinutes?: number, doneAt?: number): Step =>
  ({ id: newId(), title, output, minutes, done, actualMinutes, doneAt });

/** A first-year's week: mornings and some afternoons in class. */
export const DEMO_TIMETABLE: Busy[] = [1, 2, 3, 4, 5].flatMap(d => [
  { day: d, start: '08:00', end: '09:40', label: d % 2 ? '高等数学' : '大学英语' },
  { day: d, start: '10:00', end: '11:40', label: d % 2 ? '大学物理' : '程序设计' },
  ...(d === 2 || d === 4 ? [{ day: d, start: '14:00', end: '17:30', label: '实验课' }] : []),
]);
export const DEMO_ADVISOR: Busy[] = [1, 3, 5].map(d => ({ day: d, start: '13:30', end: '17:00', label: '上课' }));

export const DEMO_NOTES = `老师：上周说的方法对比，这次只看准确率就行，速度先不用比。
老师：你下周三之前把第四篇论文补进对比表。
学生：好的，我周五前把复现的结果整理成表发您。
老师：我这周五前把数据集链接发你。
老师：组会 PPT 不要超过 8 页。`;

export function demoData(now: number): MentorData {
  const t = (student: string, ask: string, title: string, dueDays: number, steps: Step[]): Task =>
    ({ id: newId(), ask, title, student, due: now + dueDays * DAY, steps, createdAt: now - 3 * DAY, confirmed: true, source: 'rules' });
  return {
    me: '小林',
    timetable: DEMO_TIMETABLE,
    advisorBusy: DEMO_ADVISOR,
    tasks: [
      t('小林', '下周组会前把这三篇论文的方法对比做出来', '三篇论文方法对比', 5, [
        step('搜出相关论文，只读标题和摘要', '5 篇候选论文清单', 30, true, 40, now - 2 * DAY),
        step('挑 3 篇精读方法部分', '每篇 3 句话笔记', 120, true, 180, now - DAY),
        step('填一张方法对比表', '对比表（方法、数据、结果）', 60),
        step('写两句结论和一个问题带去组会', '两句结论 + 一个问题', 20),
      ]),
      t('小陈', '把开源代码复现一下', '复现开源代码', 2, [
        step('把代码下载下来，读 README', '能运行的环境清单', 30, true, 30, now - 2 * DAY),
        step('配好环境，跑通示例', '示例输出截图', 90),
        step('换成我们的数据跑一遍', '结果表', 120),
      ]),
      t('小王', '准备下周大创中期汇报 PPT', '大创中期汇报', -1, [
        step('列出要讲的 3 个要点', '要点提纲', 20),
        step('每个要点配一张图或一张表', '图表草稿', 90),
        step('做成 6 到 8 页幻灯片', '幻灯片初稿', 90),
      ]),
    ],
    meetings: [{
      id: newId(), at: now - 7 * DAY, source: 'rules', changes: [],
      text: '老师：方法对比要同时看准确率和速度。',
      todos: [],
      requirements: [{ id: newId(), text: '方法对比要同时看准确率和速度', meetingId: 'm0', at: now - 7 * DAY }],
    }],
  };
}
