import { describe, it, expect, beforeAll } from 'vitest'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import { mergeDatabase } from '../electron/main/database/import-merge'

const SCHEMA = `
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
  owner         TEXT DEFAULT '',
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

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY NOT NULL,
  value TEXT NOT NULL
);
`

let SQL: Awaited<ReturnType<typeof initSqlJs>>

function createDB(): Database {
  const db = new SQL.Database()
  db.run(SCHEMA)
  return db
}

function insertTask(db: Database, id: string, title: string, updatedAt: number): void {
  db.run(
    'INSERT INTO tasks (id, title, status, priority, order_index, tags, owner, category_id, meta, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    [id, title, 'todo', 'P2', 0, '[]', '', '__uncategorized', '{}', updatedAt, updatedAt]
  )
}

function insertCategory(db: Database, id: string, name: string, updatedAt: number): void {
  db.run('INSERT INTO categories (id, name, color, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', [
    id, name, '#6b7280', 0, updatedAt, updatedAt,
  ])
}

function insertSetting(db: Database, key: string, value: string): void {
  db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [key, value])
}

function taskTitle(db: Database, id: string): string | null {
  const r = db.exec('SELECT title FROM tasks WHERE id = ?', [id])
  return r[0]?.values.length ? (r[0].values[0][0] as string) : null
}

beforeAll(async () => {
  SQL = await initSqlJs()
})

describe('mergeDatabase', () => {
  it('adds new tasks and categories from source', () => {
    const target = createDB()
    const source = createDB()
    insertTask(source, 't1', 'From source', 100)
    insertCategory(source, 'c1', 'New cat', 100)

    const stats = mergeDatabase(target, source)

    expect(stats.tasksAdded).toBe(1)
    expect(stats.categoriesAdded).toBe(1)
    expect(taskTitle(target, 't1')).toBe('From source')
    const cat = target.exec('SELECT name FROM categories WHERE id = ?', ['c1'])
    expect(cat[0].values[0][0]).toBe('New cat')
  })

  it('updates existing row when source is newer', () => {
    const target = createDB()
    insertTask(target, 't1', 'Old title', 50)
    const source = createDB()
    insertTask(source, 't1', 'New title', 200)

    const stats = mergeDatabase(target, source)

    expect(stats.tasksUpdated).toBe(1)
    expect(taskTitle(target, 't1')).toBe('New title')
  })

  it('keeps local row when local is newer', () => {
    const target = createDB()
    insertTask(target, 't1', 'Local title', 500)
    const source = createDB()
    insertTask(source, 't1', 'Stale title', 100)

    const stats = mergeDatabase(target, source)

    expect(stats.tasksUpdated).toBe(0)
    expect(taskTitle(target, 't1')).toBe('Local title')
  })

  it('preserves tasks only present locally', () => {
    const target = createDB()
    insertTask(target, 'local', 'Keep me', 10)
    insertTask(target, 'shared', 'Shared', 10)
    const source = createDB()
    insertTask(source, 'shared', 'Shared newer', 300)

    mergeDatabase(target, source)

    expect(taskTitle(target, 'local')).toBe('Keep me')
    expect(taskTitle(target, 'shared')).toBe('Shared newer')
  })

  it('merges categories by updated_at', () => {
    const target = createDB()
    insertCategory(target, 'c1', 'Old name', 50)
    const source = createDB()
    insertCategory(source, 'c1', 'New name', 300)
    insertCategory(source, 'c2', 'Added', 100)

    const stats = mergeDatabase(target, source)

    expect(stats.categoriesUpdated).toBe(1)
    expect(stats.categoriesAdded).toBe(1)
    const r = target.exec('SELECT name FROM categories WHERE id = ?', ['c1'])
    expect(r[0].values[0][0]).toBe('New name')
  })

  it('adds only missing settings and keeps local values', () => {
    const target = createDB()
    insertSetting(target, 'theme', 'light')
    const source = createDB()
    insertSetting(source, 'theme', 'dark')
    insertSetting(source, 'autoUpdate', 'false')

    const stats = mergeDatabase(target, source)

    expect(stats.settingsAdded).toBe(1)
    const theme = target.exec("SELECT value FROM settings WHERE key = 'theme'")
    expect(theme[0].values[0][0]).toBe('light')
    const au = target.exec("SELECT value FROM settings WHERE key = 'autoUpdate'")
    expect(au[0].values[0][0]).toBe('false')
  })

  it('is a no-op for an empty source', () => {
    const target = createDB()
    insertTask(target, 't1', 'x', 10)
    const source = createDB()

    const stats = mergeDatabase(target, source)

    expect(stats.tasksAdded).toBe(0)
    expect(stats.tasksUpdated).toBe(0)
    expect(taskTitle(target, 't1')).toBe('x')
  })
})
