-- core 0025 (mind-ledger): the computer learns what the phone's book already knows. Each debt belongs to a board
-- (学习 / 科研 / 生活), may be a 结论债 or 引用债, may be marked red (讲不出来), dropped (这个不用了), and remembers where
-- the user used the answer (used_in). 召回单: an imported paper says the opposite of a sentence of the AI's answer.
ALTER TABLE mind_entries ADD COLUMN board TEXT NOT NULL DEFAULT '学习' CHECK (board IN ('学习','科研','生活'));
ALTER TABLE mind_entries ADD COLUMN kind TEXT CHECK (kind IN ('conclusion','citation'));
ALTER TABLE mind_entries ADD COLUMN used_in TEXT NOT NULL DEFAULT '';
ALTER TABLE mind_entries ADD COLUMN red INTEGER NOT NULL DEFAULT 0 CHECK (red IN (0,1));
ALTER TABLE mind_entries ADD COLUMN dropped_on TEXT;

CREATE TABLE mind_recalls (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES mind_entries(id),
  user_id TEXT NOT NULL,
  claim TEXT NOT NULL,                          -- the sentence of the AI's answer that is recalled
  paper TEXT NOT NULL,                          -- the imported paper's name
  page INTEGER NOT NULL,
  quote TEXT NOT NULL,                          -- the paper's sentence, found word for word on that page
  state TEXT NOT NULL DEFAULT 'open' CHECK (state IN ('open','accepted','dismissed')),
  created_at TEXT NOT NULL,
  UNIQUE (entry_id, paper, page, quote)
);
CREATE INDEX idx_mind_recalls_open ON mind_recalls(user_id, state);
