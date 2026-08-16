import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { getDbPath, getDataDir } from '../data-location'
import { SCHEMA_SQL, runMigrations, ensureDefaultCategory, assertIntegrity } from '../../core/schema'

export { runMigrations }

let db: SqlJsDatabase | null = null
let dbPath: string = ''
let dataDirFallbackMessage: string | null = null

export function getDataDirFallback(): string | null {
  return dataDirFallbackMessage
}

export function getActiveDataDir(): string {
  return dbPath ? path.dirname(dbPath) : getDataDir()
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
  SQL: Awaited<ReturnType<typeof initSqlJs>>,
): SqlJsDatabase {
  let database: SqlJsDatabase
  try {
    database = new SQL.Database(buffer)
  } catch (e) {
    throw new Error('无法解析数据库文件', { cause: e })
  }
  try {
    runMigrations(database)
    const tables = database.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('tasks','categories','settings')",
    )
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
  const tmpPath = dbPath + '.tmp'
  fs.writeFileSync(tmpPath, Buffer.from(data))
  try {
    fs.renameSync(tmpPath, dbPath)
  } catch (e) {
    try {
      fs.unlinkSync(tmpPath)
    } catch {
      /* ignore */
    }
    throw e
  }
}

let saveTimer: NodeJS.Timeout | null = null
let maxSaveTimer: NodeJS.Timeout | null = null
let pendingSave = false

const SAVE_IDLE_MS = 500
const SAVE_MAX_INTERVAL_MS = 2000

function flushSave(): void {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }
  if (maxSaveTimer) {
    clearTimeout(maxSaveTimer)
    maxSaveTimer = null
  }
  if (!pendingSave) return
  pendingSave = false
  save()
}

export function saveAsync(): void {
  pendingSave = true
  if (saveTimer) return
  saveTimer = setTimeout(flushSave, SAVE_IDLE_MS)
  if (!maxSaveTimer) {
    maxSaveTimer = setTimeout(flushSave, SAVE_MAX_INTERVAL_MS)
  }
}

export function closeDB(): void {
  if (db) {
    save()
    db.close()
    db = null
  }
}
