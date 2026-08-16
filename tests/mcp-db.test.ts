import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  openDb,
  withDb,
  taskCreate,
  taskList,
  taskGetById,
  taskUpdate,
  taskUpdateStatus,
  taskDelete,
  categoryCreate,
  categoryList,
  runMigrations,
} from '../electron/mcp/db'

let dirs: string[] = []

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-mcp-db-'))
  dirs.push(d)
  return d
}

function cleanTmp(d: string) {
  fs.rmSync(d, { recursive: true, force: true })
}

beforeEach(() => {
  dirs = []
})

afterEach(() => {
  for (const d of dirs) cleanTmp(d)
})

describe('openDb', () => {
  it('creates schema and default category', async () => {
    const d = tmpDir()
    const { db } = await openDb({ dataDir: d })
    expect(categoryList(db).some((c) => c.name === '未分类')).toBe(true)
    db.close()
  })

  it('runs migrations idempotently', async () => {
    const d = tmpDir()
    const { db } = await openDb({ dataDir: d })
    expect(() => runMigrations(db)).not.toThrow()
    expect(() => runMigrations(db)).not.toThrow()
    db.close()
  })
})

describe('task CRUD via withDb', () => {
  it('creates and lists tasks', async () => {
    const d = tmpDir()
    const created = await withDb((db) => taskCreate(db, { title: 'A', priority: 'P1', tags: ['x'] }), {
      dataDir: d,
    })
    expect(created.id).toBeTruthy()
    expect(created.title).toBe('A')
    expect(created.tags).toEqual(['x'])

    const all = await withDb((db) => taskList(db), { dataDir: d, readonly: true })
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('A')
  })

  it('gets task by id', async () => {
    const d = tmpDir()
    const created = await withDb((db) => taskCreate(db, { title: 'Find' }), { dataDir: d })
    const found = await withDb((db) => taskGetById(db, created.id), { dataDir: d, readonly: true })
    expect(found?.title).toBe('Find')
  })

  it('updates task fields', async () => {
    const d = tmpDir()
    const created = await withDb((db) => taskCreate(db, { title: 'Old' }), { dataDir: d })
    const updated = await withDb((db) => taskUpdate(db, created.id, { title: 'New', priority: 'P0' }), {
      dataDir: d,
    })
    expect(updated?.title).toBe('New')
    expect(updated?.priority).toBe('P0')
  })

  it('updates status and cascades to descendants', async () => {
    const d = tmpDir()
    const p = await withDb((db) => taskCreate(db, { title: 'P' }), { dataDir: d })
    const c = await withDb((db) => taskCreate(db, { title: 'C', parentId: p.id }), { dataDir: d })

    await withDb((db) => taskUpdateStatus(db, p.id, 'done'), { dataDir: d })
    const rel = await withDb((db) => taskGetById(db, c.id), { dataDir: d, readonly: true })
    expect(rel?.status).toBe('done')
  })

  it('deletes task with descendants', async () => {
    const d = tmpDir()
    const p = await withDb((db) => taskCreate(db, { title: 'P' }), { dataDir: d })
    const c = await withDb((db) => taskCreate(db, { title: 'C', parentId: p.id }), { dataDir: d })

    expect(await withDb((db) => taskDelete(db, p.id), { dataDir: d })).toBe(true)
    const all = await withDb((db) => taskList(db), { dataDir: d, readonly: true })
    expect(all).toHaveLength(0)
    void c
  })

  it('persists across separate withDb calls (write-then-read)', async () => {
    const d = tmpDir()
    await withDb((db) => taskCreate(db, { title: 'Persist' }), { dataDir: d })
    const all = await withDb((db) => taskList(db), { dataDir: d, readonly: true })
    expect(all[0].title).toBe('Persist')
  })
})

describe('category ops', () => {
  it('creates and lists categories', async () => {
    const d = tmpDir()
    const cat = await withDb((db) => categoryCreate(db, { name: '工作', color: '#ff0000' }), { dataDir: d })
    expect(cat.name).toBe('工作')
    const all = await withDb((db) => categoryList(db), { dataDir: d, readonly: true })
    expect(all.some((c) => c.name === '工作')).toBe(true)
  })
})

describe('integrity validation', () => {
  it('rejects creating task with a non-existent category', async () => {
    const d = tmpDir()
    await expect(
      withDb((db) => taskCreate(db, { title: 'X', categoryId: 'nope' }), { dataDir: d }),
    ).rejects.toThrow('分类不存在')
  })

  it('rejects updating task to a non-existent category', async () => {
    const d = tmpDir()
    const t = await withDb((db) => taskCreate(db, { title: 'X' }), { dataDir: d })
    await expect(
      withDb((db) => taskUpdate(db, t.id, { categoryId: 'nope' }), { dataDir: d }),
    ).rejects.toThrow('分类不存在')
  })

  it('rejects creating task with non-existent parent', async () => {
    const d = tmpDir()
    await expect(
      withDb((db) => taskCreate(db, { title: 'X', parentId: 'nope' }), { dataDir: d }),
    ).rejects.toThrow('父任务不存在')
  })

  it('rejects self-parent cycle', async () => {
    const d = tmpDir()
    const t = await withDb((db) => taskCreate(db, { title: 'T' }), { dataDir: d })
    await expect(
      withDb((db) => taskUpdate(db, t.id, { parentId: t.id }), { dataDir: d }),
    ).rejects.toThrow('任务自身')
  })

  it('rejects circular parent-child reference', async () => {
    const d = tmpDir()
    const p = await withDb((db) => taskCreate(db, { title: 'P' }), { dataDir: d })
    const c = await withDb((db) => taskCreate(db, { title: 'C', parentId: p.id }), { dataDir: d })
    await expect(
      withDb((db) => taskUpdate(db, p.id, { parentId: c.id }), { dataDir: d }),
    ).rejects.toThrow('循环')
  })

  it('allows valid parent change', async () => {
    const d = tmpDir()
    const a = await withDb((db) => taskCreate(db, { title: 'A' }), { dataDir: d })
    const c = await withDb((db) => taskCreate(db, { title: 'C', parentId: a.id }), { dataDir: d })
    const b = await withDb((db) => taskCreate(db, { title: 'B' }), { dataDir: d })
    const updated = await withDb((db) => taskUpdate(db, c.id, { parentId: b.id }), { dataDir: d })
    expect(updated?.parentId).toBe(b.id)
  })
})