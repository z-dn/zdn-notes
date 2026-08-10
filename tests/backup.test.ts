// @vitest-environment node
import { describe, it, expect, beforeAll } from 'vitest'
import initSqlJs from 'sql.js'
import fs from 'fs'
import os from 'os'
import path from 'path'
import AdmZip from 'adm-zip'
import { runMigrations, loadValidatedDB } from '../electron/main/database'
import { buildBackupZip, readBackupZip } from '../electron/main/backup'

let SQL: Awaited<ReturnType<typeof initSqlJs>>

beforeAll(async () => {
  SQL = await initSqlJs()
})

function makeDB(buffer?: Uint8Array) {
  return buffer ? new SQL.Database(buffer) : new SQL.Database()
}

function oldSchemaDB(): { db: ReturnType<typeof SQL.Database>; export: () => Uint8Array } {
  const db = makeDB()
  db.run(`
    CREATE TABLE tasks (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'todo',
      priority TEXT NOT NULL DEFAULT 'P2',
      due_date INTEGER,
      start_date INTEGER,
      reminder_time INTEGER,
      parent_id TEXT,
      order_index REAL NOT NULL,
      tags TEXT DEFAULT '[]',
      project TEXT DEFAULT '',
      meta TEXT DEFAULT '{}',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO tasks (id, title, order_index, created_at, updated_at) VALUES ('t1', 'old task', 1, 1, 1);
  `)
  return db
}

describe('runMigrations', () => {
  it('adds new columns and tables to an old schema', () => {
    const db = oldSchemaDB()
    runMigrations(db)

    const cols = db.exec("PRAGMA table_info(tasks)")[0].values.map((r) => r[1])
    expect(cols).toContain('owner')
    expect(cols).toContain('category_id')
    expect(cols).not.toContain('project')

    const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table'")[0].values.map((r) => r[0])
    expect(tables).toContain('categories')
    expect(tables).toContain('settings')
  })

  it('is idempotent on an up-to-date schema', () => {
    const db = oldSchemaDB()
    runMigrations(db)
    expect(() => runMigrations(db)).not.toThrow()
  })
})

describe('loadValidatedDB', () => {
  it('accepts a valid database buffer', () => {
    const db = oldSchemaDB()
    db.run(`CREATE TABLE categories (id TEXT PRIMARY KEY NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#6b7280', sort_order REAL NOT NULL DEFAULT 0, created_at INTEGER NOT NULL); CREATE TABLE settings (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);`)
    const buffer = db.export()

    const loaded = loadValidatedDB(buffer, SQL)
    const tasks = loaded.exec('SELECT * FROM tasks')[0].values
    expect(tasks.length).toBe(1)
    loaded.close()
  })

  it('rejects a buffer missing required tables', () => {
    const db = makeDB()
    db.run('CREATE TABLE only_tasks (id TEXT PRIMARY KEY NOT NULL)')
    const buffer = db.export()

    expect(() => loadValidatedDB(buffer, SQL)).toThrow(/缺少必需的表/)
  })

  it('rejects a corrupt buffer', () => {
    const buffer = new Uint8Array([1, 2, 3, 4, 5])
    expect(() => loadValidatedDB(buffer, SQL)).toThrow()
  })

  it('rejects an empty buffer', () => {
    expect(() => loadValidatedDB(new Uint8Array(), SQL)).toThrow()
  })
})

describe('backup zip roundtrip', () => {
  let tmpDir: string

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-backup-test-'))
  })

  it('packs db and images, then reads them back', () => {
    const db = oldSchemaDB()
    const dbBuffer = db.export()

    const imgDir = path.join(tmpDir, 'images')
    fs.mkdirSync(imgDir, { recursive: true })
    fs.writeFileSync(path.join(imgDir, 'a.png'), Buffer.from('imga'))
    fs.writeFileSync(path.join(imgDir, 'b.jpg'), Buffer.from('imgb'))
    fs.writeFileSync(path.join(imgDir, '..evil.txt'), Buffer.from('nope'))

    const zipPath = path.join(tmpDir, 'backup.zip')
    buildBackupZip(dbBuffer, imgDir, zipPath)
    db.close()

    const { dbBuffer: dbOut, images } = readBackupZip(zipPath)
    const out = new SQL.Database(dbOut)
    const tasks = out.exec('SELECT * FROM tasks')[0].values
    expect(tasks.length).toBe(1)
    out.close()

    const names = images.map((i) => i.name).sort()
    expect(names).toEqual(['a.png', 'b.jpg'])
    expect(images.find((i) => i.name === 'a.png')?.data.toString()).toBe('imga')
  })

  it('reads back an empty images directory', () => {
    const db = oldSchemaDB()
    const dbBuffer = db.export()

    const emptyDir = path.join(tmpDir, 'empty-images')
    fs.mkdirSync(emptyDir, { recursive: true })

    const zipPath = path.join(tmpDir, 'empty.zip')
    buildBackupZip(dbBuffer, emptyDir, zipPath)
    db.close()

    const { images } = readBackupZip(zipPath)
    expect(images).toEqual([])
  })

  it('rejects a zip missing the db entry', () => {
    const zipPath = path.join(tmpDir, 'nodb.zip')
    const zip = new AdmZip()
    zip.addFile('other.txt', Buffer.from('x'))
    zip.writeZip(zipPath)

    expect(() => readBackupZip(zipPath)).toThrow(/缺少 zdn-notes\.db/)
  })

  it('rejects unknown top-level entries', () => {
    const db = oldSchemaDB()
    const dbBuffer = db.export()

    const zipPath = path.join(tmpDir, 'unknown.zip')
    const zip = new AdmZip()
    zip.addFile('zdn-notes.db', Buffer.from(dbBuffer))
    zip.addFile('config.json', Buffer.from('{}'))
    zip.writeZip(zipPath)
    db.close()

    expect(() => readBackupZip(zipPath)).toThrow(/未知条目/)
  })

  it('rejects unsafe image filenames', () => {
    const db = oldSchemaDB()
    const dbBuffer = db.export()

    const zipPath = path.join(tmpDir, 'unsafe.zip')
    const zip = new AdmZip()
    zip.addFile('zdn-notes.db', Buffer.from(dbBuffer))
    zip.addFile('images/evil name.png', Buffer.from('x'))
    zip.writeZip(zipPath)
    db.close()

    expect(() => readBackupZip(zipPath)).toThrow(/非法图片文件名/)
  })
})
