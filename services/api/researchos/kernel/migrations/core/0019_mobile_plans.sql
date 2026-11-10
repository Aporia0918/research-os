-- core 0019 (mobile-plan): pre-experiment plan drafted from a paper's method text; owner-scoped by user_id.
-- state draft -> confirmed. Nothing takes effect until the user confirms (an explicit action stored with a timestamp);
-- items can only be edited while the plan is a draft.
CREATE TABLE mobile_plans (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft','confirmed')),
  method TEXT NOT NULL,                          -- deterministic | model | deterministic_fallback
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_by_device TEXT
);
CREATE INDEX idx_mobile_plans_user ON mobile_plans(user_id, created_at);
