-- core 0021 (mobile-guidance): research guidance (counter-questions on a user's idea) and writing guidance (citation
-- check, methods check against a CONFIRMED plan). Same state machine as mobile_plans: draft -> confirmed by the user
-- (explicit action, timestamp); decisions can only change while draft. One paper / one text at a time, no memory.
CREATE TABLE mobile_guidance (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('questions','citation_check','methods_check')),
  version_id TEXT NOT NULL,
  plan_id TEXT,
  input_text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft','confirmed')),
  method TEXT NOT NULL,                          -- deterministic | model | deterministic_fallback
  status TEXT NOT NULL,                          -- ok | method_section_not_found
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_by_device TEXT
);
CREATE INDEX idx_mobile_guidance_user ON mobile_guidance(user_id, created_at);
