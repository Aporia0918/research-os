-- core 0018 (mind-ledger): 思维账本. One row per AI use; repayments (no-AI attempts) are append-only.
-- Numbering note: feat/mobile-api also claims 0018-0023; whichever merges second renumbers its files.
CREATE TABLE mind_entries (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id TEXT NOT NULL,                      -- id from the phone, web page or extension; dedupes retries
  source TEXT NOT NULL CHECK (source IN ('app','extension','manual')),
  topic TEXT NOT NULL DEFAULT '',               -- course or subject, e.g. 高数
  question TEXT NOT NULL,
  answer TEXT NOT NULL DEFAULT '',              -- what the AI gave; the reference for grading
  own_idea TEXT NOT NULL DEFAULT '',            -- what the student wrote before asking
  help_level TEXT NOT NULL CHECK (help_level IN ('own','hint','approach','answer')),
  weight TEXT CHECK (weight IN ('light','medium','heavy')),  -- NULL: own idea, no debt
  passes INTEGER NOT NULL DEFAULT 0,
  due_on TEXT,                                  -- YYYY-MM-DD; NULL when there is nothing to repay
  created_on TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, client_id)
);
CREATE INDEX idx_mind_due ON mind_entries(user_id, due_on);

CREATE TABLE mind_attempts (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES mind_entries(id),
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  points TEXT NOT NULL,                         -- JSON list of key points it was graded against
  hits TEXT NOT NULL,                           -- JSON list of hit indices
  passed INTEGER NOT NULL CHECK (passed IN (0,1)),
  method TEXT NOT NULL CHECK (method IN ('model','deterministic')),
  attempted_on TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_mind_attempts_entry ON mind_attempts(entry_id, created_at);

CREATE TRIGGER mind_attempts_no_update BEFORE UPDATE ON mind_attempts
BEGIN SELECT RAISE(ABORT, 'mind_attempts is append-only'); END;
CREATE TRIGGER mind_attempts_no_delete BEFORE DELETE ON mind_attempts
BEGIN SELECT RAISE(ABORT, 'mind_attempts is append-only'); END;
