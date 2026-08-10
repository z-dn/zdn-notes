import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getDbPath, getDataDir } from '../data-location'

const SCHEMA_SQL = `
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
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_status       ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date     ON tasks(due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_parent_id    ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_order_index  ON tasks(order_index);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);

`

let db: SqlJsDatabase | null = null
let dbPath: string = ''
let dataDirFallbackMessage: string | null = null

export function getDataDirFallback(): string | null {
  return dataDirFallbackMessage
}

export function getActiveDataDir(): string {
  return dbPath ? path.dirname(dbPath) : getDataDir()
}

export function runMigrations(database: SqlJsDatabase): void {
  try { database.run("ALTER TABLE tasks RENAME COLUMN project TO owner") } catch (e) { /* already renamed */ }
  try { database.run("ALTER TABLE tasks ADD COLUMN owner TEXT DEFAULT ''") } catch (e) { /* column may already exist */ }
  try { database.run("CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6b7280', sort_order REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)") } catch (e) { /* table may already exist */ }
  try { database.run("ALTER TABLE categories ADD COLUMN color TEXT NOT NULL DEFAULT '#6b7280'") } catch (e) { /* column may already exist */ }
  try { database.run("ALTER TABLE categories ADD COLUMN parent_id TEXT") } catch (e) { /* column may already exist */ }
  try { database.run("UPDATE categories SET parent_id = NULL") } catch (e) { /* ignore */ }
  try { database.run("ALTER TABLE tasks ADD COLUMN category_id TEXT REFERENCES categories(id) ON DELETE SET NULL DEFAULT NULL") } catch (e) { /* column may already exist */ }
  try { database.run("CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)") } catch (e) { /* table may already exist */ }
}

export function ensureDefaultCategory(database: SqlJsDatabase): void {
  const existingDefault = database.exec("SELECT id FROM categories WHERE name = '未分类'")
  if (!existingDefault[0]?.values.length) {
    database.run("INSERT INTO categories (id, name, color, sort_order, created_at) VALUES ('__uncategorized', '未分类', '#9ca3af', 0, ?)", [Date.now()])
  }
}

export function assertIntegrity(database: SqlJsDatabase): void {
  const check = database.exec('PRAGMA integrity_check')
  if (check[0]?.values[0]?.[0] !== 'ok') {
    throw new Error('Database integrity check failed: ' + String(check[0]?.values[0]?.[0]))
  }
}

let sqlPromise: ReturnType<typeof initSqlJs> | null = null

function getSQL() {
  if (!sqlPromise) sqlPromise = initSqlJs()
  return sqlPromise
}

export async function initDB(): Promise<void> {
  dbPath = getDbPath()
  try {
    await loadDBFrom(dbPath)
  } catch (e) {
    console.error('[db] failed to open data directory, falling back to default:', e)
    dataDirFallbackMessage = `数据目录不可用（${getDataDir()}），本次已回退到默认位置，请检查目录是否可访问`
    dbPath = path.join(app.getPath('userData'), 'zdn-notes.db')
    await loadDBFrom(dbPath)
  }
}

export async function reloadDB(targetPath?: string): Promise<void> {
  if (db) {
    save()
    db.close()
    db = null
  }
  const resolved = targetPath ?? getDbPath()
  dbPath = resolved
  await loadDBFrom(resolved)
}

async function loadDBFrom(targetPath: string): Promise<void> {
  const SQL = await getSQL()
  fs.mkdirSync(path.dirname(targetPath), { recursive: true })
  if (fs.existsSync(targetPath)) {
    const buffer = fs.readFileSync(targetPath)
    db = new SQL.Database(buffer)
    runMigrations(db)
  } else {
    db = new SQL.Database()
    db.run(SCHEMA_SQL)
    save()
  }
  ensureDefaultCategory(db)
  try {
    assertIntegrity(db)
  } catch (e) {
    console.error('[db] integrity check failed:', e)
  }
}

export function loadValidatedDB(
  buffer: Uint8Array,
  SQL: Awaited<ReturnType<typeof initSqlJs>>
): SqlJsDatabase {
  let database: SqlJsDatabase
  try {
    database = new SQL.Database(buffer)
  } catch (e) {
    throw new Error('无法解析数据库文件', { cause: e })
  }
  try {
    runMigrations(database)
    const tables = database.exec("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks','categories','settings')")
    const present = new Set<string>()
    for (const row of tables[0]?.values ?? []) present.add(String(row[0]))
    for (const t of ['tasks', 'categories', 'settings']) {
      if (!present.has(t)) throw new Error('数据库缺少必需的表: ' + t)
    }
    ensureDefaultCategory(database)
    assertIntegrity(database)
  } catch (e) {
    database.close()
    throw e
  }
  return database
}

export function replaceDB(newDb: SqlJsDatabase): void {
  const old = db
  db = newDb
  save()
  old?.close()
}

export function getDB(): SqlJsDatabase {
  if (!db) throw new Error('Database not initialized. Call initDB() first.')
  return db
}

export function isDBReady(): boolean {
  return db !== null
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
