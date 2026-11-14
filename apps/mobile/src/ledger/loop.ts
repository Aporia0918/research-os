import { bigrams } from './ledger';

/** One round of a conversation with any AI: what the user asked, what came back, and whether they wrote their own idea first. */
export interface Turn { q: string; a: string; own?: string }

export interface LoopCheck {
  follow: number[];   // per turn: share of the question's wording taken from the previous AI answer
  run: number;        // longest stretch of turns that only followed the AI, with no own idea
  ownTurns: number;   // turns where the user wrote their own idea first
  lastOwn: number;    // index of the last turn that brought in new words of the user's own (-1 if none)
  looping: boolean;   // a stretch of FOLLOW_RUN or more followed turns
}

/** A question counts as following when at least this much of its new wording came from the previous answer. */
export const FOLLOW_SHARE = 0.5;
/** This many followed turns in a row is a loop worth showing. */
export const FOLLOW_RUN = 3;

/**
 * 顺从回路, checked by rule with no model: does each question take its words from the AI's last answer,
 * or bring in words the user chose? Only this signal is rule-based; any suggested question is a hint and booked as one.
 */
export function checkLoop(turns: Turn[]): LoopCheck {
  const seen = new Set<string>(); // words the user has already used themselves
  const follow: number[] = [];
  let run = 0, cur = 0, ownTurns = 0, lastOwn = -1;
  turns.forEach((t, i) => {
    const fresh = [...bigrams(t.q)].filter((g) => !seen.has(g));
    const prev = i > 0 ? bigrams(turns[i - 1].a) : new Set<string>();
    const taken = fresh.filter((g) => prev.has(g)).length;
    const share = fresh.length ? taken / fresh.length : 1; // a question with no new words only repeats
    follow.push(Math.round(share * 100) / 100);
    const own = Boolean(t.own?.trim());
    if (own) ownTurns += 1;
    if (fresh.length - taken >= 3) lastOwn = i;
    cur = i > 0 && share >= FOLLOW_SHARE && !own ? cur + 1 : 0;
    run = Math.max(run, cur);
    bigrams(t.q).forEach((g) => seen.add(g));
  });
  return { follow, run, ownTurns, lastOwn, looping: run >= FOLLOW_RUN };
}
