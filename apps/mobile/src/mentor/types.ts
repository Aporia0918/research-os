// 「组会之后」: shared shapes. Times are epoch ms; a timetable is a weekly pattern on the student's wall clock.

/** Who a task, a to-do or a promise belongs to. */
export type Role = '导师' | '学生';

/** One weekly class or other fixed commitment: weekday 0 = Sunday … 6 = Saturday, times "HH:MM". */
export interface Busy { day: number; start: string; end: string; label?: string }

export interface Step {
  id: string;
  title: string;
  /** What the step leaves behind, e.g. "一张对比表". */
  output: string;
  minutes: number;
  done: boolean;
  doneAt?: number;
  /** Minutes it really took, as the student entered it when ticking it off. */
  actualMinutes?: number;
}

export interface Task {
  id: string;
  /** The advisor's own words, kept as they were said. */
  ask: string;
  title: string;
  student: string;
  due: number;
  steps: Step[];
  createdAt: number;
  /** The advisor pressed 确认 on the breakdown; the student only sees confirmed tasks. */
  confirmed: boolean;
  /** model = drafted by the user's own model key; rules = the offline templates. */
  source: 'model' | 'rules';
  /** What the student asked when the ask left something out, and the advisor's answer. */
  asked?: { question: string; answer: string }[];
}

export interface Todo {
  id: string;
  who: Role;
  what: string;
  due?: number;
  meetingId: string;
  done: boolean;
}

export type ChangeKind = '一致' | '新增' | '改变' | '矛盾';

export interface Requirement {
  id: string;
  text: string;
  meetingId: string;
  at: number;
}

export interface Change {
  kind: ChangeKind;
  now: Requirement;
  before?: Requirement;
  /** The student and advisor each tap to settle a 改变 or 矛盾. */
  settled: boolean;
}

export interface Meeting {
  id: string;
  at: number;
  text: string;
  todos: Todo[];
  requirements: Requirement[];
  changes: Change[];
  source: 'model' | 'rules';
}
