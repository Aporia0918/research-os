-- core 0022 (mobile-predict): guidance kind 'predict' = deterministic "prediction and adjustment suggestions" from a
-- CONFIRMED plan plus experiment log entries. SQLite cannot change a CHECK constraint, so the table is rebuilt.
CREATE TABLE mobile_guidance_new (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('questions','citation_check','methods_check','predict')),
  version_id TEXT NOT NULL,
  plan_id TEXT,
  input_text TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('draft','confirmed')),
  method TEXT NOT NULL,
  status TEXT NOT NULL,
  items_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT,
  confirmed_by_device TEXT
);
INSERT INTO mobile_guidance_new SELECT id,user_id,kind,version_id,plan_id,input_text,state,method,status,items_json,
  created_at,updated_at,confirmed_at,confirmed_by_device FROM mobile_guidance;
DROP TABLE mobile_guidance;
ALTER TABLE mobile_guidance_new RENAME TO mobile_guidance;
CREATE INDEX idx_mobile_guidance_user ON mobile_guidance(user_id, created_at);
