-- core 0023 (mobile-hypothesis): a hypothesis the user writes against items of a CONFIRMED plan; owner-scoped.
-- status is chosen by the user only (pending = 待验证, supported = 支持, refuted = 不支持, insufficient = 证据不足);
-- every change is kept in history_json with a timestamp and device id. No model, no statistics, no auto conclusion.
CREATE TABLE mobile_hypotheses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  text TEXT NOT NULL,
  plan_item_ids_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','supported','refuted','insufficient')),
  status_set_at TEXT,
  status_set_by_device TEXT,
  history_json TEXT NOT NULL,
  number_check_json TEXT NOT NULL,
  comparison_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_mobile_hypotheses_plan ON mobile_hypotheses(user_id, plan_id, created_at);
