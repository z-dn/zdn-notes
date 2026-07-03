import { randomUUID } from 'crypto'
import type { Database, SqlValue } from 'sql.js'
import type { Task, CreateTaskDTO, UpdateTaskDTO } from '@/types/task'
import { generateBetween } from '@/lib/lexorank'
import { getDB, saveAsync } from './index'

type Row = Record<string, unknown>

const SNAKE_TO_CAMEL: Record<string, string> = {
  due_date: 'dueDate',
  start_date: 'startDate',
  reminder_time: 'reminderTime',
  parent_id: 'parentId',
  order_index: 'orderIndex',
  category_id: 'categoryId',
  created_at: 'createdAt',
  updated_at: 'updatedAt',
}

const CAMEL_TO_SNAKE: Record<string, string> = {
  dueDate: 'due_date',
  startDate: 'start_date',
  reminderTime: 'reminder_time',
  parentId: 'parent_id',
  orderIndex: 'order_index',
  categoryId: 'category_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
}

function snakeToCamel(col: string): string {
  return SNAKE_TO_CAMEL[col] ?? col
}

function toSnake(key: string): string {
  return CAMEL_TO_SNAKE[key] ?? key
}

function rowToTask(row: Row): Task {
  const task: Record<string, unknown> = {}
  for (const [col, val] of Object.entries(row)) {
    const key = snakeToCamel(col)
    if (key === 'tags' && typeof val === 'string') task[key] = JSON.parse(val)
    else if (key === 'meta' && typeof val === 'string') task[key] = JSON.parse(val)
    else task[key] = val ?? null
  }
  if (task.categoryId === null) task.categoryId = '__uncategorized'
  return task as unknown as Task
}

function rowsToTasks(db: Database): Task[] {
  const r = db.exec('SELECT * FROM tasks ORDER BY order_index ASC')
  if (!r[0] || !r[0].values.length) return []
  const cols = r[0].columns
  return r[0].values.map((vals) => {
    const row: Row = {}
    cols.forEach((col, i) => { row[col] = vals[i] })
    return rowToTask(row)
  })
}

function getRowById(db: Database, id: string): Row | null {
  const r = db.exec('SELECT * FROM tasks WHERE id = ?', [id])
  if (!r[0]?.values.length) return null
  const cols = r[0].columns
  const vals = r[0].values[0]
  const row: Row = {}
  cols.forEach((col, i) => { row[col] = vals[i] })
  return row
}

function maxOrderIndex(db: Database): number | null {
  const r = db.exec('SELECT MAX(order_index) FROM tasks')
  const val = r[0]?.values[0]?.[0]
  return val != null ? (val as number) : null
}

export function createTask(dto: CreateTaskDTO, _db?: Database): Task {
  const db = _db ?? getDB()
  const now = Date.now()
  const id = randomUUID()

  const orderIndex = generateBetween(maxOrderIndex(db), null)

  const { cols, placeholders, vals } = toInsert({
    id,
    title: dto.title,
    description: dto.description ?? '',
    status: dto.status ?? 'todo',
    priority: dto.priority ?? 'P2',
    dueDate: dto.dueDate,
    startDate: dto.startDate,
    reminderTime: dto.reminderTime,
    parentId: dto.parentId,
    orderIndex,
    tags: dto.tags ?? [],
    owner: dto.owner ?? '',
    categoryId: dto.categoryId ?? '__uncategorized',
    meta: {},
    createdAt: now,
    updatedAt: now,
  })

  try {
    db.run('BEGIN')
    db.run(`INSERT INTO tasks (${cols.join(', ')}) VALUES (${placeholders.join(', ')})`, vals)
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }

  if (!_db) saveAsync()
  return getTaskById(id, db)!
}

export function getTaskById(id: string, _db?: Database): Task | null {
  const db = _db ?? getDB()
  const row = getRowById(db, id)
  return row ? rowToTask(row) : null
}

export function getAllTasks(_db?: Database): Task[] {
  return rowsToTasks(_db ?? getDB())
}

export function updateTask(dto: UpdateTaskDTO, _db?: Database): Task | null {
  const db = _db ?? getDB()

  const existing = getRowById(db, dto.id)
  if (!existing) return null

  if ('parentId' in dto) {
    checkCycle(db, dto.id, dto.parentId ?? null)
  }

  const currentStatus = existing['status'] as string
  const newStatus = 'status' in dto ? dto.status : currentStatus

  const updates: Record<string, unknown> = { updated_at: Date.now() }
  const fieldMap: Record<string, string> = {
    title: 'title',
    description: 'description',
    status: 'status',
    priority: 'priority',
    dueDate: 'due_date',
    startDate: 'start_date',
    reminderTime: 'reminder_time',
    parentId: 'parent_id',
    tags: 'tags',
    owner: 'owner',
    categoryId: 'category_id',
  }

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in dto) {
      const val = (dto as unknown as Record<string, unknown>)[key]
      updates[col] = Array.isArray(val) ? JSON.stringify(val) : (val ?? null)
    }
  }

  const setClauses = Object.keys(updates).map((col) => `${col} = ?`).join(', ')
  const vals = Object.values(updates) as SqlValue[]

  try {
    db.run('BEGIN')
    db.run(`UPDATE tasks SET ${setClauses} WHERE id = ?`, [...vals, dto.id as SqlValue])
    const modified = db.getRowsModified()
    if (modified === 0) { db.run('ROLLBACK'); return null }
    if (newStatus === 'done' || newStatus === 'cancelled') {
      cascadeStatus(db, dto.id, newStatus)
    }
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }

  if (!_db) saveAsync()
  return getTaskById(dto.id, db)!
}

function collectDescendantIds(db: Database, id: string): string[] {
  const ids: string[] = [id]
  const children = db.exec('SELECT id FROM tasks WHERE parent_id = ?', [id])
  if (children[0]) {
    for (const row of children[0].values) {
      ids.push(...collectDescendantIds(db, row[0] as string))
    }
  }
  return ids
}

function checkCycle(db: Database, taskId: string, newParentId: string | null): void {
  if (!newParentId) return
  if (taskId === newParentId) {
    throw new Error('Cannot set task as its own parent')
  }
  const descendants = collectDescendantIds(db, taskId)
  if (descendants.includes(newParentId)) {
    throw new Error('Cannot set parent: would create a circular reference')
  }
}

function cascadeStatus(db: Database, parentId: string, status: string): void {
  const children = db.exec('SELECT id FROM tasks WHERE parent_id = ?', [parentId])
  if (!children[0]) return
  for (const row of children[0].values) {
    const childId = row[0] as string
    db.run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [status, Date.now(), childId])
    cascadeStatus(db, childId, status)
  }
}

export function updateTaskStatus(id: string, newStatus: string, _db?: Database): Task | null {
  const db = _db ?? getDB()
  const existing = getRowById(db, id)
  if (!existing) return null

  if (!['todo', 'in_progress', 'done', 'cancelled'].includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`)
  }

  try {
    db.run('BEGIN')
    db.run('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?', [newStatus, Date.now(), id])
    if (newStatus === 'done' || newStatus === 'cancelled') {
      cascadeStatus(db, id, newStatus)
    }
    db.run('COMMIT')
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }

  if (!_db) saveAsync()
  return getTaskById(id, db)!
}

export function deleteTask(id: string, _db?: Database): boolean {
  const db = _db ?? getDB()

  try {
    db.run('BEGIN')
    const ids = collectDescendantIds(db, id) as SqlValue[]
    const placeholders = ids.map(() => '?').join(', ')
    db.run(`DELETE FROM tasks WHERE id IN (${placeholders})`, ids)
    const deleted = db.getRowsModified()
    db.run('COMMIT')
    if (!_db) saveAsync()
    return deleted > 0
  } catch (e) {
    db.run('ROLLBACK')
    throw e
  }
}

function toInsert(obj: Record<string, unknown>) {
  const cols: string[] = []
  const placeholders: string[] = []
  const vals: SqlValue[] = []

  for (const [key, val] of Object.entries(obj)) {
    if (val === undefined) continue
    let v: SqlValue = val as SqlValue
    if (Array.isArray(v) || (v !== null && typeof v === 'object')) v = JSON.stringify(v)
    cols.push(toSnake(key))
    placeholders.push('?')
    vals.push(v)
  }

  return { cols, placeholders, vals }
}
