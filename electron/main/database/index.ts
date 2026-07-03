import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'

const SCHEMA_SQL = `
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
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date     ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id    ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_order_index  ON tasks(order_index);

`

let db: SqlJsDatabase | null = null
let dbPath: string = ''

export async function initDB(): Promise<void> {
  const SQL = await initSqlJs()
  dbPath = path.join(app.getPath('userData'), 'zdn-notes.db')

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
    try { db.run("ALTER TABLE tasks RENAME COLUMN project TO owner") } catch (e) { /* already renamed */ }
    try { db.run("ALTER TABLE tasks ADD COLUMN owner TEXT DEFAULT ''") } catch (e) { /* column may already exist */ }
    try { db.run("CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6b7280', sort_order REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)") } catch (e) { /* table may already exist */ }
    try { db.run("ALTER TABLE categories ADD COLUMN parent_id TEXT") } catch (e) { /* column may already exist */ }
    try { db.run("UPDATE categories SET parent_id = NULL") } catch (e) { /* ignore */ }
    try { db.run("ALTER TABLE tasks ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL DEFAULT NULL") } catch (e) { /* column may already exist */ }
  } else {
    db = new SQL.Database()
    db.run(SCHEMA_SQL)
    save()
  }
  const existingDefault = db.exec("SELECT id FROM categories WHERE name = '未分类'")
  if (!existingDefault[0]?.values.length) {
    db.run("INSERT INTO categories (id, name, color, sort_order, created_at) VALUES ('__uncategorized', '未分类', '#9ca3af', 0, ?)", [Date.now()])
    save()
  }

  const check = db.exec('PRAGMA integrity_check')
  if (check[0]?.values[0]?.[0] !== 'ok') {
    console.error('[db] integrity check failed:', check[0]?.values[0]?.[0])
  }
}

export function getDB(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized. Call initDB() first.')
  return db
}

export function save(): void {
  if (!db || !dbPath) return
  const data = db.export()
  fs.writeFileSync(dbPath, Buffer.from(data))
}

let saveQueued = false
export function saveAsync(): void {
  if (saveQueued) return
  saveQueued = true
  setImmediate(() => {
    save()
    saveQueued = false
  })
}

export function closeDB(): void {
  if (db) {
    save()
    db.close()
    db = null
  }
}
