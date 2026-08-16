import type { Database } from 'sql.js'

// ===================================================================
// 数据库 schema 单一来源（Single Source of Truth）。
// 供主进程 electron/main/database/index.ts 与独立 MCP electron/mcp/db.ts
// 共同引用，消除原先双份 SCHEMA_SQL + 双份 runMigrations 的漂移。
// 不依赖 Electron，纯 SQL.js 操作。
// ===================================================================

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY NOT NULL,
  title         TEXT NOT NULL,
  description   TEXT DEFAULT '',
  status        TEXT NOT NULL DEFAULT 'todo'
                  CHECK(status IN ('todo','done')),
  priority      TEXT NOT NULL DEFAULT 'P2'
                  CHECK(priority IN ('P0','P1','P2','P3')),
  due_date      INTEGER,
  start_date    INTEGER,
  reminder_time INTEGER,
  parent_id     TEXT REFERENCES tasks(id) ON DELETE CASCADE,
  order_index   REAL NOT NULL,
  tags          TEXT DEFAULT '[]',
  owner       TEXT DEFAULT '',
  category_id   TEXT REFERENCES categories(id) ON DELETE SET NULL,
  meta          TEXT DEFAULT '{}',
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY NOT NULL,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '#6b7280',
  sort_order REAL NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date     ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id    ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_order_index  ON tasks(order_index);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tool_state (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`

export function runMigrations(database: Database): void {
  try {
    database.run('ALTER TABLE tasks RENAME COLUMN project TO owner')
  } catch {
    /* already renamed */
  }
  try {
    database.run("ALTER TABLE tasks ADD COLUMN owner TEXT DEFAULT ''")
  } catch {
    /* column may already exist */
  }
  try {
    database.run(
      "CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6b7280', sort_order REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)",
    )
  } catch {
    /* table may already exist */
  }
  try {
    database.run("ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '#6b7280'")
  } catch {
    /* column may already exist */
  }
  try {
    database.run('ALTER TABLE categories ADD COLUMN parent_id TEXT')
  } catch {
    /* column may already exist */
  }
  try {
    database.run('UPDATE categories SET parent_id = NULL')
  } catch {
    /* ignore */
  }
  try {
    database.run('ALTER TABLE categories ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0')
  } catch {
    /* column may already exist */
  }
  try {
    database.run(
      'UPDATE categories SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = 0',
    )
  } catch {
    /* ignore */
  }
  try {
    database.run(
      'ALTER TABLE tasks ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL DEFAULT NULL',
    )
  } catch {
    /* column may already exist */
  }
  try {
    database.run(
      'CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
    )
  } catch {
    /* table may already exist */
  }
  try {
    database.run(
      'CREATE TABLE IF NOT EXISTS tool_state (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)',
    )
  } catch {
    /* table may already exist */
  }
}

export function ensureDefaultCategory(database: Database): void {
  const existingDefault = database.exec("SELECT id FROM categories WHERE name = '未分类'")
  if (!existingDefault[0]?.values.length) {
    database.run(
      "INSERT INTO categories (id, name, color, sort_order, created_at, updated_at) VALUES ('__uncategorized', '未分类', '#9ca3af', 0, ?, ?)",
      [Date.now(), Date.now()],
    )
  }
}

export function assertIntegrity(database: Database): void {
  const check = database.exec('PRAGMA integrity_check')
  if (check[0]?.values[0]?.[0] !== 'ok') {
    throw new Error('Database integrity check failed: ' + String(check[0]?.values[0]?.[0]))
  }
}