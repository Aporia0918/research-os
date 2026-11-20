// Everything 「组会之后」 keeps lives on the phone, in one JSON document.
import { preferencesKV, type KV } from '../storage/kv';
import { readJson, saveJson } from '../local/store';
import type { Busy, Meeting, Task } from './types';

export interface MentorData {
  /** The name the student goes by, shown on the advisor's overview. */
  me: string;
  timetable: Busy[];
  /** The advisor's weekly busy times, for suggesting a group-meeting slot. */
  advisorBusy: Busy[];
  tasks: Task[];
  meetings: Meeting[];
}
export const MENTOR_KEY = 'mentor.data.v1';
export const EMPTY: MentorData = { me: '我', timetable: [], advisorBusy: [], tasks: [], meetings: [] };

export async function loadMentor(kv: KV = preferencesKV): Promise<MentorData> {
  return { ...EMPTY, ...(await readJson<MentorData>(kv, MENTOR_KEY)) };
}
export async function saveMentor(d: MentorData, kv: KV = preferencesKV): Promise<void> { await saveJson(kv, MENTOR_KEY, d); }
