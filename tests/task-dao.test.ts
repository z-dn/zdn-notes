import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import initSqlJs from 'sql.js'
import type { Database } from 'sql.js'
import { createTask, getTaskById, getAllTasks, updateTask, deleteTask, updateTaskStatus } from '../electron/main/database/task-dao'

const SCHEMA = `
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
  project       TEXT DEFAULT '',
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

describe('createTask', () => {
  it('creates a task with defaults', () => {
    const db = createDB()
    const task = createTask({ title: 'Test task' }, db)
    expect(task.id).toBeTruthy()
    expect(task.title).toBe('Test task')
    expect(task.status).toBe('todo')
    expect(task.priority).toBe('P2')
    expect(task.description).toBe('')
    expect(task.tags).toEqual([])
    expect(task.parentId).toBeNull()
    expect(task.createdAt).toBeTypeOf('number')
    expect(task.updatedAt).toBe(task.createdAt)
  })

  it('creates a task with custom values', () => {
    const db = createDB()
    const task = createTask({
      title: 'Custom task',
      description: 'Desc',
      status: 'in_progress',
      priority: 'P0',
      dueDate: 999999,
      startDate: 100000,
      tags: ['work', 'urgent'],
      parentId: null,
    }, db)
    expect(task.title).toBe('Custom task')
    expect(task.description).toBe('Desc')
    expect(task.status).toBe('in_progress')
    expect(task.priority).toBe('P0')
    expect(task.dueDate).toBe(999999)
    expect(task.startDate).toBe(100000)
    expect(task.tags).toEqual(['work', 'urgent'])
  })

  it('auto-increments order_index', () => {
    const db = createDB()
    const t1 = createTask({ title: 'A' }, db)
    const t2 = createTask({ title: 'B' }, db)
    const t3 = createTask({ title: 'C' }, db)
    expect(t1.orderIndex).toBe(0)
    expect(t2.orderIndex).toBe(1)
    expect(t3.orderIndex).toBe(2)
  })
})

describe('getTaskById', () => {
  it('returns task by id', () => {
    const db = createDB()
    const created = createTask({ title: 'Find me' }, db)
    const found = getTaskById(created.id, db)
    expect(found).not.toBeNull()
    expect(found!.title).toBe('Find me')
  })

  it('returns null for non-existent id', () => {
    const db = createDB()
    expect(getTaskById('non-existent', db)).toBeNull()
  })
})

describe('getAllTasks', () => {
  it('returns empty array when no tasks', () => {
    const db = createDB()
    expect(getAllTasks(db)).toEqual([])
  })

  it('returns all tasks ordered by order_index', () => {
    const db = createDB()
    const t1 = createTask({ title: 'C' }, db)
    const t2 = createTask({ title: 'A' }, db)
    const t3 = createTask({ title: 'B' }, db)
    const all = getAllTasks(db)
    expect(all).toHaveLength(3)
    expect(all[0].title).toBe('C')
    expect(all[1].title).toBe('A')
    expect(all[2].title).toBe('B')
  })
})

describe('updateTask', () => {
  it('updates task fields', () => {
    const db = createDB()
    const task = createTask({ title: 'Old' }, db)
    const updated = updateTask({ id: task.id, title: 'New', priority: 'P1' }, db)
    expect(updated!.title).toBe('New')
    expect(updated!.priority).toBe('P1')
    expect(updated!.updatedAt).not.toBe(task.updatedAt)
  })

  it('returns null for non-existent id', () => {
    const db = createDB()
    expect(updateTask({ id: 'nope', title: 'x' }, db)).toBeNull()
  })
})

describe('status cascade', () => {
  it('updates children when parent set to done', () => {
    const db = createDB()
    const parent = createTask({ title: 'P' }, db)
    const child = createTask({ title: 'C', parentId: parent.id }, db)
    const grandchild = createTask({ title: 'GC', parentId: child.id }, db)

    updateTask({ id: parent.id, status: 'done' }, db)

    expect(getTaskById(parent.id, db)!.status).toBe('done')
    expect(getTaskById(child.id, db)!.status).toBe('done')
    expect(getTaskById(grandchild.id, db)!.status).toBe('done')
  })

  it('updates children when parent set to cancelled', () => {
    const db = createDB()
    const p = createTask({ title: 'P' }, db)
    const c = createTask({ title: 'C', parentId: p.id }, db)
    updateTask({ id: p.id, status: 'cancelled' }, db)
    expect(getTaskById(c.id, db)!.status).toBe('cancelled')
  })

  it('does NOT reverse-cascade when child completed', () => {
    const db = createDB()
    const p = createTask({ title: 'P' }, db)
    const c = createTask({ title: 'C', parentId: p.id }, db)
    updateTask({ id: c.id, status: 'done' }, db)
    expect(getTaskById(p.id, db)!.status).toBe('todo')
  })

  it('cascades via updateTaskStatus', () => {
    const db = createDB()
    const p = createTask({ title: 'P' }, db)
    const c = createTask({ title: 'C', parentId: p.id }, db)
    updateTaskStatus(p.id, 'done', db)
    expect(getTaskById(c.id, db)!.status).toBe('done')
  })

  it('does not cascade when status changes to in_progress', () => {
    const db = createDB()
    const p = createTask({ title: 'P' }, db)
    const c = createTask({ title: 'C', parentId: p.id }, db)
    updateTask({ id: p.id, status: 'in_progress' }, db)
    expect(getTaskById(c.id, db)!.status).toBe('todo')
  })
})

describe('cycle detection', () => {
  it('rejects setting self as parent', () => {
    const db = createDB()
    const t = createTask({ title: 'T' }, db)
    expect(() => updateTask({ id: t.id, parentId: t.id }, db)).toThrow('own parent')
  })

  it('rejects circular parent-child reference', () => {
    const db = createDB()
    const p = createTask({ title: 'P' }, db)
    const c = createTask({ title: 'C', parentId: p.id }, db)
    expect(() => updateTask({ id: p.id, parentId: c.id }, db)).toThrow('circular')
  })

  it('rejects deep circular reference', () => {
    const db = createDB()
    const a = createTask({ title: 'A' }, db)
    const b = createTask({ title: 'B', parentId: a.id }, db)
    const c = createTask({ title: 'C', parentId: b.id }, db)
    expect(() => updateTask({ id: a.id, parentId: c.id }, db)).toThrow('circular')
  })

  it('allows valid parent change', () => {
    const db = createDB()
    const a = createTask({ title: 'A' }, db)
    const b = createTask({ title: 'B' }, db)
    const c = createTask({ title: 'C', parentId: a.id }, db)
    const updated = updateTask({ id: c.id, parentId: b.id }, db)
    expect(updated!.parentId).toBe(b.id)
  })

  it('allows clearing parentId', () => {
    const db = createDB()
    const p = createTask({ title: 'P' }, db)
    const c = createTask({ title: 'C', parentId: p.id }, db)
    const updated = updateTask({ id: c.id, parentId: null }, db)
    expect(updated!.parentId).toBeNull()
  })
})

describe('deleteTask', () => {
  it('deletes a task', () => {
    const db = createDB()
    const task = createTask({ title: 'Delete me' }, db)
    expect(deleteTask(task.id, db)).toBe(true)
    expect(getTaskById(task.id, db)).toBeNull()
  })

  it('deletes children recursively', () => {
    const db = createDB()
    const parent = createTask({ title: 'Parent' }, db)
    const child = createTask({ title: 'Child', parentId: parent.id }, db)
    const grandchild = createTask({ title: 'Grandchild', parentId: child.id }, db)
    deleteTask(parent.id, db)
    expect(getAllTasks(db)).toHaveLength(0)
  })

  it('returns false for non-existent id', () => {
    const db = createDB()
    expect(deleteTask('nope', db)).toBe(false)
  })
})

describe('transaction rollback', () => {
  it('rolls back on constraint violation', () => {
    const db = createDB()
    const task = createTask({ title: 'Safe' }, db)
    expect(() => {
      const d = db
      d.run('BEGIN')
      d.run("UPDATE tasks SET status = 'invalid' WHERE id = ?", [task.id])
      d.run('COMMIT')
    }).toThrow()
    const reloaded = getTaskById(task.id, db)
    expect(reloaded!.status).toBe('todo')
  })
})

describe('T-12: Hierarchy stress tests', () => {
  it('creates 50-level deep nested tasks', () => {
    const db = createDB()
    let parentId: string | null = null
    for (let i = 0; i < 50; i++) {
      const t = createTask({ title: `Level ${i}`, parentId }, db)
      parentId = t.id
    }
    const all = getAllTasks(db)
    expect(all).toHaveLength(50)
  })

  it('cascades done through 100-level deep tree under 100ms', () => {
    const db = createDB()
    let parentId: string | null = null
    for (let i = 0; i < 100; i++) {
      const t = createTask({ title: `L${i}`, parentId }, db)
      parentId = t.id
    }

    const start = performance.now()
    const root = getRowByIdForTest(db)
    updateTaskStatus(root!.id, 'done', db)
    const elapsed = performance.now() - start

    expect(elapsed).toBeLessThan(100)
    const all = getAllTasks(db)
    expect(all.every((t) => t.status === 'done')).toBe(true)
  })

  it('cascades cancelled through 50-level tree without stack overflow', () => {
    const db = createDB()
    let parentId: string | null = null
    for (let i = 0; i < 50; i++) {
      const t = createTask({ title: `L${i}`, parentId }, db)
      parentId = t.id
    }

    expect(() => {
      const root = getRowByIdForTest(db)
      updateTaskStatus(root!.id, 'cancelled', db)
    }).not.toThrow()

    const all = getAllTasks(db)
    expect(all.every((t) => t.status === 'cancelled')).toBe(true)
  })
})

describe('T-13: Data integrity tests', () => {
  it('triggers integrity_check without errors', () => {
    const db = createDB()
    createTask({ title: 'A' }, db)
    createTask({ title: 'B' }, db)

    const r = db.exec('PRAGMA integrity_check')
    expect(r[0].values[0][0]).toBe('ok')
  })

  it('DAO rolls back on constraint violation during update', () => {
    const db = createDB()
    const t = createTask({ title: 'Safe' }, db)
    expect(() => {
      updateTask({ id: t.id, status: 'invalid' as never }, db)
    }).toThrow()
    const reloaded = getTaskById(t.id, db)
    expect(reloaded!.status).toBe('todo')
  })
})

// Helper for T-12
function getRowByIdForTest(db: Database): { id: string } | null {
  const r = db.exec('SELECT id, title FROM tasks ORDER BY order_index ASC LIMIT 1')
  if (!r[0]?.values.length) return null
  return { id: r[0].values[0][0] as string }
}
