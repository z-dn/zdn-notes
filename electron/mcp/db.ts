import initSqlJs, { Database, SqlValue } from 'sql.js'
import fs from 'fs'
import { randomUUID } from 'crypto'
import { resolveDbPath, resolveDataDir } from './data-location'
import { acquireLock, releaseLock } from './lock'
import { SCHEMA_SQL, runMigrations, ensureDefaultCategory } from '../core/schema'

export { runMigrations }

// ===================================================================
// 独立的 SQL.js 封装，供 zdn-mcp 进程直接读写 zdn-notes.db。
// 关键点：
//  - 每个写操作都是 BEGIN/COMMIT 包裹的短事务（原子性），GUI 抢占时可在
//    事务间隙安全让位。
//  - 锁在单个操作的外层获取/释放，操作之间不持锁 => 不会长时间阻塞 GUI。
//  - schema 与迁移逻辑统一来自 electron/core/schema.ts（单一来源）。
//  - 读写都是同步的（sql.js 是同步 API），配合锁单写，性能在低配机上足够低。
// ===================================================================

// ===== 行/实体转换 =====
let sqlPromise: ReturnType<typeof initSqlJs> | null = null

function getSQL() {
  if (!sqlPromise) sqlPromise = initSqlJs()
  return sqlPromise
}

// 打开数据库文件（迁移 + 默认分类）；文件不存在则创建空库（不落盘，由调用方决定）。
export async function openDb(
  opts?: { dataDir?: string },
): Promise<{ db: Database; dbPath: string; dataDir: string }> {
  const SQL = await getSQL()
  const dataDir = opts?.dataDir?.trim() || resolveDataDir()
  const dbPath = resolveDbPath(opts)
  fs.mkdirSync(dataDir, { recursive: true })
  let db: Database
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath)
    db = new SQL.Database(buffer)
    runMigrations(db)
  } else {
    db = new SQL.Database()
    db.run(SCHEMA_SQL)
  }
  ensureDefaultCategory(db)
  return { db, dbPath, dataDir }
}

// 将内存库完整落盘（原子写：先写 tmp 再 rename）。
export function persist(db: Database, dbPath: string): void {
  const data = db.export()
  const tmp = dbPath + '.tmp-' + process.pid
  fs.writeFileSync(tmp, Buffer.from(data))
  fs.renameSync(tmp, dbPath)
}

// ===== 行/实体转换 =====
function rowToTask(row: Record<string, unknown>) {
  const map: Record<string, string> = {
    due_date: 'dueDate', start_date: 'startDate', reminder_time: 'reminderTime',
    parent_id: 'parentId', order_index: 'orderIndex', category_id: 'categoryId',
    created_at: 'createdAt', updated_at: 'updatedAt',
  }
  const t: Record<string, unknown> = {}
  for (const [col, val] of Object.entries(row)) {
    const key = map[col] ?? col
    if (key === 'tags' && typeof val === 'string') t[key] = JSON.parse(val)
    else if (key === 'meta' && typeof val === 'string') t[key] = JSON.parse(val)
    else t[key] = val ?? null
  }
  if (t.categoryId === null) t.categoryId = '__uncategorized'
  return t
}

function maxOrderIndex(db: Database): number | null {
  const r = db.exec('SELECT MAX(order_index) FROM tasks')
  const v = r[0]?.values[0]?.[0]
  return v != null ? (v as number) : null
}

function assertCategoryExists(db: Database, categoryId: string): void {
  const r = db.exec('SELECT id FROM categories WHERE id = ?', [categoryId])
  if (!r[0]?.values.length) throw new Error('分类不存在: ' + categoryId)
}

function assertTaskExists(db: Database, id: string): void {
  const r = db.exec('SELECT id FROM tasks WHERE id = ?', [id])
  if (!r[0]?.values.length) throw new Error('父任务不存在: ' + id)
}

function genBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return 0
  if (before === null) return after! - 1
  if (after === null) return before + 1
  return (before + after) / 2
}

// ===== 操作层：每个写操作 = 单短事务（锁在外层由调用方持有） =====

export interface CreateTaskInput {
  title: string
  description?: string
  status?: 'todo' | 'done'
  priority?: 'P0' | 'P1' | 'P2' | 'P3'
  dueDate?: number | null
  startDate?: number | null
  reminderTime?: number | null
  parentId?: string | null
  tags?: string[]
  owner?: string
  categoryId?: string | null
  orderIndex?: number
}

export function taskCreate(db: Database, dto: CreateTaskInput) {
  const now = Date.now()
  const id = randomUUID()
  const orderIndex = dto.orderIndex ?? genBetween(maxOrderIndex(db), null)
  const title = String(dto.title ?? '').trim()
  if (!title) throw new Error('title 不能为空')
  const tags = Array.isArray(dto.tags) ? dto.tags : []
  const status = dto.status ?? 'todo'
  if (!['todo', 'done'].includes(status as string)) throw new Error('status 非法')
  const priority = dto.priority ?? 'P2'
  if (!['P0', 'P1', 'P2', 'P3'].includes(priority as string)) throw new Error('priority 非法')
  const categoryId = dto.categoryId ?? '__uncategorized'
  if (categoryId !== '__uncategorized') assertCategoryExists(db, categoryId)
  if (dto.parentId) assertTaskExists(db, dto.parentId)

  db.run('BEGIN')
  try {
    db.run(
      `INSERT INTO tasks (id, title, description, status, priority, due_date, start_date, reminder_time, parent_id, order_index, tags, owner, category_id, meta, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, title, dto.description ?? '', status, priority,
        dto.dueDate ?? null, dto.startDate ?? null, dto.reminderTime ?? null,
        dto.parentId ?? null, orderIndex, JSON.stringify(tags), dto.owner ?? '',
        categoryId === '__uncategorized' ? null : categoryId, '{}', now, now,
      ],
    )
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  return taskGetById(db, id)
}

export function taskList(db: Database, filter?: { status?: string; search?: string }) {
  const where: string[] = []
  const params: SqlValue[] = []
  if (filter?.status) {
    const t = filter.status.trim()
    if (!['todo', 'done'].includes(t)) throw new Error('status 非法')
    where.push('status = ?'); params.push(t)
  }
  if (filter?.search) {
    const esc = filter.search.replace(/[\\%_]/g, '\\$&')
    where.push("title LIKE ? ESCAPE '\\'"); params.push(`%${esc}%`)
  }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : ''
  const r = db.exec(`SELECT * FROM tasks ${w} ORDER BY order_index ASC`, params)
  if (!r[0]) return []
  const cols = r[0].columns
  return r[0].values.map((vals) => {
    const row: Record<string, unknown> = {}
    cols.forEach((c, i) => { row[c] = vals[i] })
    return rowToTask(row)
  })
}

export function taskGetById(db: Database, id: string) {
  const r = db.exec('SELECT * FROM tasks WHERE id = ?', [id])
  if (!r[0]?.values.length) return null
  const cols = r[0].columns
  const row: Record<string, unknown> = {}
  cols.forEach((c, i) => { row[c] = r[0]!.values[0][i] })
  return rowToTask(row)
}

function collectDescendantIds(db: Database, id: string): string[] {
  const out: string[] = []
  const walk = (pid: string) => {
    const r = db.exec('SELECT id FROM tasks WHERE parent_id = ?', [pid])
    if (!r[0]) return
    for (const row of r[0].values) {
      const cid = row[0] as string
      out.push(cid)
      walk(cid)
    }
  }
  walk(id)
  return out
}

export function taskUpdateStatus(db: Database, id: string, status: string) {
  if (!['todo', 'done'].includes(status)) throw new Error('status 非法')
  const existing = taskGetById(db, id)
  if (!existing) return null
  db.run('BEGIN')
  try {
    db.run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), id])
    for (const kid of collectDescendantIds(db, id)) {
      db.run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), kid])
    }
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  return taskGetById(db, id)
}

export function taskUpdate(db: Database, id: string, patch: Record<string, unknown>) {
  const existing = taskGetById(db, id)
  if (!existing) return null
  const fieldMap: Record<string, string> = {
    title: 'title', description: 'description', status: 'status', priority: 'priority',
    dueDate: 'due_date', startDate: 'start_date', reminderTime: 'reminder_time',
    parentId: 'parent_id', tags: 'tags', owner: 'owner', categoryId: 'category_id',
  }
  const sets: string[] = ['updated_at = ?']
  const vals: SqlValue[] = [Date.now()]
  for (const [key, col] of Object.entries(fieldMap)) {
    if (!(key in patch)) continue
    let v = (patch as Record<string, any>)[key]
    if (key === 'status' && v != null && !['todo', 'done'].includes(v)) throw new Error('status 非法')
    if (key === 'priority' && v != null && !['P0', 'P1', 'P2', 'P3'].includes(v)) throw new Error('priority 非法')
    if (key === 'categoryId' && v !== null && v !== undefined && v !== '__uncategorized') {
      assertCategoryExists(db, v as string)
    }
    if (key === 'categoryId' && v === '__uncategorized') v = null
    if (key === 'parentId' && v !== null && v !== undefined) {
      if (v === id) throw new Error('parentId 不能指向任务自身')
      assertTaskExists(db, v as string)
      if (collectDescendantIds(db, id).includes(v as string)) throw new Error('parentId 不能构成循环')
    }
    if (Array.isArray(v)) v = JSON.stringify(v)
    sets.push(`${col} = ?`)
    vals.push((v ?? null) as SqlValue)
  }
  db.run('BEGIN')
  try {
    db.run(`UPDATE tasks SET ${sets.join(', ')} WHERE id = ?`, [...vals, id])
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  return taskGetById(db, id)
}

export function taskDelete(db: Database, id: string): boolean {
  const existing = taskGetById(db, id)
  if (!existing) return false
  db.run('BEGIN')
  try {
    const ids = [id, ...collectDescendantIds(db, id)]
    const placeholders = ids.map(() => '?').join(', ')
    db.run(`DELETE FROM tasks WHERE id IN (${placeholders})`, ids)
    db.run('COMMIT')
    return true
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
}

export function categoryList(db: Database) {
  const r = db.exec('SELECT * FROM categories ORDER BY sort_order ASC, name ASC')
  if (!r[0]) return []
  const cols = r[0].columns
  return r[0].values.map((vals) => {
    const row: Record<string, unknown> = {}
    cols.forEach((c, i) => { row[c] = vals[i] })
    return row
  })
}

export function categoryCreate(db: Database, dto: { name: string; color?: string }) {
  const name = String(dto.name ?? '').trim()
  if (!name) throw new Error('name 不能为空')
  const now = Date.now()
  const id = randomUUID()
  let sort = 0
  const r = db.exec('SELECT MAX(sort_order) FROM categories')
  const m = r[0]?.values[0]?.[0]
  if (m != null) sort = (m as number) + 1
  db.run('BEGIN')
  try {
    db.run(
      'INSERT INTO categories (id, name, color, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)',
      [id, name, dto.color ?? '#6b7280', sort, now, now],
    )
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
  const got = db.exec('SELECT * FROM categories WHERE id = ?', [id])
  if (!got[0]) return null
  const cols = got[0].columns
  const row: Record<string, unknown> = {}
  cols.forEach((c, i) => { row[c] = got[0]!.values[0][i] })
  return row
}

// ===== 带锁 + 单次加载的 execute 包装 =====
// 对高频场景优化：进程内缓存打开的 db（dbCache），同一进程后续调用
// 复用已加载的内存库，避免重复读文件 + 迁移，低配机上尤为重要。
interface CachedDb {
  db: Database
  dbPath: string
  dataDir: string
}
let dbCache: CachedDb | null = null

function setCache(opened: CachedDb): void {
  const old = dbCache
  dbCache = opened
  if (old && old !== opened) {
    try {
      old.db.close()
    } catch {
      /* ignore */
    }
  }
}

async function getCachedDb(opts?: { dataDir?: string }): Promise<CachedDb> {
  const dataDir = opts?.dataDir?.trim() || resolveDataDir()
  if (dbCache && dbCache.dataDir === dataDir) return dbCache
  const opened = await openDb({ dataDir })
  setCache(opened)
  return opened
}

export async function closeCachedDb(): Promise<void> {
  if (dbCache) {
    dbCache.db.close()
    dbCache = null
  }
}

// 执行一个操作：拿锁(polling) -> 加载库 -> 执行（写则落盘） -> 放锁。
// 写操作不信任进程内缓存，每次基于磁盘最新态执行并刷新缓存，避免多 MCP 进程
// 各自持有陈旧内存库互相覆盖；读操作仍走 dbCache 热点路径。
export async function withDb<T>(
  fn: (db: Database) => Promise<T> | T,
  opts?: { dataDir?: string; waitMs?: number; readonly?: boolean },
): Promise<T> {
  const dataDir = opts?.dataDir?.trim() || resolveDataDir()
  // acquireLock 成功进入 try 后，无论 getCachedDb / fn / persist 哪个抛错，
  // finally 都会 releaseLock，确保不留下"锁住了却不释放"的状态。
  acquireLock(dataDir, opts?.waitMs ?? 2000)
  try {
    let opened: CachedDb
    if (opts?.readonly) {
      opened = await getCachedDb({ dataDir })
    } else {
      opened = await openDb({ dataDir })
      setCache(opened)
    }
    const result = await fn(opened.db)
    if (!opts?.readonly) persist(opened.db, opened.dbPath)
    return result
  } finally {
    releaseLock(dataDir)
  }
}
