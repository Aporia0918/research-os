-- core 0027 (mind-ledger): 讲给我听 right after 记一笔. The student explains the AI's answer point by point, at most
-- three rounds; this happens with the answer just read, so it never counts as a repayment (mind_attempts). It sets
-- the debt's first FSRS rating (1 again, 2 hard, 3 good), which the phone uses to seed its memory of the debt.
ALTER TABLE mind_entries ADD COLUMN first_rating INTEGER CHECK (first_rating BETWEEN 1 AND 3);

CREATE TABLE mind_explains (
  entry_id TEXT PRIMARY KEY REFERENCES mind_entries(id),
  user_id TEXT NOT NULL,
  points TEXT NOT NULL,                         -- JSON [{"text", "type"}] split from the AI's answer
  states TEXT NOT NULL,                         -- JSON, one of ok|more|turned|maybe per point, best so far
  asked TEXT NOT NULL DEFAULT '[]',             -- JSON point indexes already followed up (each at most once)
  rounds INTEGER NOT NULL DEFAULT 0,
  hint INTEGER NOT NULL DEFAULT -1,             -- highest hint level given, -1 none, 0..3
  result TEXT CHECK (result IN ('clean','followed','unsure','failed')),  -- NULL while open
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE mind_explain_rounds (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES mind_explains(entry_id),
  round INTEGER NOT NULL,
  text TEXT NOT NULL,
  states TEXT NOT NULL,                         -- JSON states this round alone
  created_at TEXT NOT NULL,
  UNIQUE (entry_id, round)
);

CREATE TRIGGER mind_explain_rounds_no_update BEFORE UPDATE ON mind_explain_rounds
BEGIN SELECT RAISE(ABORT, 'mind_explain_rounds is append-only'); END;
