-- core 0026 (desktop): where the user used an AI answer, found in their own notes by sentence similarity on the
-- computer (用在哪里, and the 标黄 of the paragraphs a 召回单 touches); and pushes to the owner's other devices, one
-- row per device, fetched by that device (no third-party push service).
CREATE TABLE mind_uses (
  entry_id TEXT NOT NULL REFERENCES mind_entries(id),
  doc_id TEXT NOT NULL REFERENCES docs(id),
  sentence TEXT NOT NULL,                       -- the user's sentence that matches a sentence of the AI's answer
  score REAL NOT NULL,
  found_at TEXT NOT NULL,
  PRIMARY KEY (entry_id, doc_id)
);

CREATE TABLE device_pushes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  kind TEXT NOT NULL CHECK (kind IN ('recall','recall_settled','entry','used')),
  entity_id TEXT NOT NULL,
  text TEXT NOT NULL,                           -- the debt's question or the recalled sentence, shown as is
  created_at TEXT NOT NULL,
  seen_at TEXT
);
CREATE INDEX idx_device_pushes_open ON device_pushes(device_id, seen_at);
