import type { MentorData } from '../store';

export type Update = (f: (d: MentorData) => MentorData) => void;
export interface ScreenProps { data: MentorData; update: Update; now: number }

export const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
export function when(t: number, now: number): string {
  const d = new Date(t), n = new Date(now);
  const days = Math.round((new Date(d).setHours(0, 0, 0, 0) - n.setHours(0, 0, 0, 0)) / 86_400_000);
  const day = days === 0 ? '今天' : days === 1 ? '明天' : days === -1 ? '昨天' : `${d.getMonth() + 1}月${d.getDate()}日${WEEK[d.getDay()]}`;
  return `${day} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
export function SourceTag({ source }: { source: 'model' | 'rules' }) {
  return <span className="pill">{source === 'model' ? '模型' : '离线规则'}</span>;
}
