/**
 * FSRS 还账排期: each debt carries a memory state (stability S, difficulty D) and its next repayment day is the day
 * recall is predicted to fall to 90 %. Default parameters (no optimiser until there are real repayment records).
 * ts-fsrs, MIT: https://github.com/open-spaced-repetition/ts-fsrs
 */
import { createEmptyCard, fsrs, generatorParameters, Rating, State, type Card, type Grade as FsrsGrade } from 'ts-fsrs';

/** What a debt keeps between repayments; dates are calendar days. */
export interface Memory { s: number; d: number; reps: number; lapses: number; state: number; last: string; due: string }

export const RETENTION = 0.9;
const engine = fsrs(generatorParameters({ request_retention: RETENTION, enable_fuzz: false, enable_short_term: false }));
const at = (day: string) => new Date(`${day}T12:00:00Z`);
const day = (d: Date) => d.toISOString().slice(0, 10);

/** How a repayment went, from the share of key points the user covered. */
export function ratingOf(passed: boolean, share: number): FsrsGrade {
  if (!passed) return Rating.Again;
  if (share >= 0.999) return Rating.Easy;
  return share >= 0.8 ? Rating.Good : Rating.Hard;
}

function cardOf(m: Memory | undefined, booked: string): Card {
  if (!m) return createEmptyCard(at(booked));
  return { ...createEmptyCard(at(m.last)), stability: m.s, difficulty: m.d, reps: m.reps, lapses: m.lapses, state: m.state as State,
    last_review: at(m.last), due: at(m.due), scheduled_days: 0, elapsed_days: 0 };
}

/** One repayment: the new memory state; its due day is the next repayment day. */
export function review(m: Memory | undefined, booked: string, today: string, rating: FsrsGrade): Memory {
  const { card } = engine.next(cardOf(m, booked), at(today), rating);
  const due = day(card.due) > today ? day(card.due) : day(new Date(at(today).getTime() + 86400000));
  return { s: round(card.stability), d: round(card.difficulty), reps: card.reps, lapses: card.lapses, state: card.state, last: today, due };
}

/**
 * A debt explained right after booking (讲给我听 on the computer) starts with that as its first review: 1 again, 2 hard,
 * 3 good. Only the reviews after the first repayment follow it; the first repayment day stays on the fixed steps.
 */
export const seed = (booked: string, rating: 1 | 2 | 3): Memory => review(undefined, booked, booked, rating as FsrsGrade);

/** Predicted chance of recalling it today (R), or null before the first repayment. */
export function recallChance(m: Memory | undefined, today: string): number | null {
  if (!m) return null;
  return engine.get_retrievability(cardOf(m, m.last), at(today), false);
}

const round = (x: number) => Math.round(x * 100) / 100;
