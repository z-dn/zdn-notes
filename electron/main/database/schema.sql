CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'todo'
                  CHECK(status IN ('todo','in_progress','done','cancelled')),
  priority      TEXT NOT NULL DEFAULT 'P2'
                  CHECK(priority IN ('P0','P1','P2','P3')),
  due_date      INTEGER,
  start_date    INTEGER,
  reminder_time INTEGER,
  parent_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  order_index   REAL NOT NULL,
  tags          TEXT DEFAULT '[]',
  meta          TEXT DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date    ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id   ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_order_index ON tasks(order_index);
