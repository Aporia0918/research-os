-- core 0018 (mobile-api): experiment log entries captured on the Android app; owner-scoped by user_id.
-- Attachments (photo / voice) are content-addressed blobs; only metadata lives here.
CREATE TABLE mobile_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  client_id TEXT NOT NULL,                       -- id the phone gave the entry (offline queue); unique per user
  kind TEXT NOT NULL CHECK (kind IN ('text','photo','voice')),
  text TEXT NOT NULL DEFAULT '',
  captured_at TEXT,                              -- phone clock, informational
  attachment_path TEXT,
  attachment_mime TEXT,
  attachment_size INTEGER,
  attachment_sha256 TEXT,
  duration_ms INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (user_id, client_id)
);
CREATE INDEX idx_mobile_logs_user ON mobile_logs(user_id, created_at);
