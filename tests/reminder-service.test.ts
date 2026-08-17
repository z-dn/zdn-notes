import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import { createTask, getDueTasks } from '../electron/main/database/task-dao'
import { startReminderService, evaluateDue } from '../electron/main/reminder-service'
import type { Task } from '../src/types/task'

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
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

INSERT OR IGNORE INTO categories (id, name, color, sort_order, created_at) VALUES ('__uncategorized', '未分类', '#9ca3af', 0, 0);
`

let SQL: Awaited<ReturnType<typeof initSqlJs>>

function createDB(): Database {
  const db = new SQL.Database()
  db.run(SCHEMA)
  return db
}

beforeAll(async () => {
  SQL = await initSqlJs()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('getDueTasks', () => {
  it('returns only unfinished tasks with past reminder times', () => {
    const db = createDB()
    const now = 1000
    createTask({ title: 'due', reminderTime: now - 10, status: 'todo' }, db)
    createTask({ title: 'done', reminderTime: now - 10, status: 'done' }, db)
    createTask({ title: 'no reminder', reminderTime: null, status: 'todo' }, db)
    createTask({ title: 'future', reminderTime: now + 1000, status: 'todo' }, db)
    const due = getDueTasks(now, db)
    expect(due.map((t) => t.title)).toEqual(['due'])
  })

  it('is empty when nothing is due', () => {
    const db = createDB()
    createTask({ title: 'future', reminderTime: 2000, status: 'todo' }, db)
    expect(getDueTasks(1000, db)).toEqual([])
  })
})

describe('evaluateDue', () => {
  const taskA = { id: 'a', reminderTime: 100 } as Task
  const taskB = { id: 'b', reminderTime: 200 } as Task

  it('fires each due task once and marks them notified', () => {
    const r1 = evaluateDue([taskA, taskB], {})
    expect(r1.toFire.map((t) => t.id)).toEqual(['a', 'b'])
    expect(r1.next).toEqual({ a: 100, b: 200 })

    const r2 = evaluateDue([taskA, taskB], r1.next)
    expect(r2.toFire).toEqual([])
  })

  it('re-arms when reminderTime changes', () => {
    const r1 = evaluateDue([taskA], {})
    const changed = { id: 'a', reminderTime: 300 } as Task
    const r2 = evaluateDue([changed], r1.next)
    expect(r2.toFire.map((t) => t.id)).toEqual(['a'])
    expect(r2.next).toEqual({ a: 300 })
  })

  it('ignores tasks without a reminder time', () => {
    const r = evaluateDue([{ id: 'c', reminderTime: null } as Task], {})
    expect(r.toFire).toEqual([])
    expect(r.next).toEqual({})
  })
})

describe('startReminderService', () => {
  it('fires due reminders once and persists the notified map', () => {
    vi.useFakeTimers()
    const db = createDB()
    createTask({ title: 'remind me', reminderTime: Date.now() - 1000, status: 'todo' }, db)
    const fired: string[] = []
    let map: Record<string, number> = {}
    const svc = startReminderService({
      getDB: () => db,
      isEnabled: () => true,
      getNotifiedMap: () => map,
      setNotifiedMap: (m) => {
        map = m
      },
      onDue: (t) => fired.push(t.id),
      intervalMs: 1000,
    })
    expect(fired).toHaveLength(1)
    expect(Object.keys(map)).toHaveLength(1)
    vi.advanceTimersByTime(1000)
    expect(fired).toHaveLength(1)
    svc.stop()
  })

  it('skips when reminders are disabled', () => {
    vi.useFakeTimers()
    const db = createDB()
    createTask({ title: 'remind me', reminderTime: Date.now() - 1000, status: 'todo' }, db)
    const fired: string[] = []
    const svc = startReminderService({
      getDB: () => db,
      isEnabled: () => false,
      getNotifiedMap: () => ({}),
      setNotifiedMap: () => {},
      onDue: (t) => fired.push(t.id),
      intervalMs: 1000,
    })
    expect(fired).toHaveLength(0)
    svc.stop()
  })
})
