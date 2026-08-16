import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startMcpIpc } from '../electron/main/mcp-ipc'
import { openDb } from '../electron/mcp/db'
import { acquireGuiLock, releaseGuiLock } from '../electron/mcp/lock'
import { runCli } from '../electron/mcp/cli'
import type { Database } from 'sql.js'

let dir: string
let db: Database
let ipc: Awaited<ReturnType<typeof startMcpIpc>>
let notifyCount = 0

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-mcp-cli-'))
  db = (await openDb({ dataDir: dir })).db
  ipc = await startMcpIpc({
    dataDir: dir,
    getDB: () => db,
    saveAsync: () => {},
    notify: () => {
      notifyCount++
    },
  })
})

afterAll(async () => {
  await ipc.stop()
  fs.rmSync(dir, { recursive: true, force: true })
})

afterEach(() => {
  notifyCount = 0
  releaseGuiLock(dir)
})

describe('CLI 委托（GUI 运行时）', () => {
  it('task add 转发给 GUI，写入权威库并通知渲染层', async () => {
    acquireGuiLock(dir, { port: ipc.port, token: ipc.token })
    const code = await runCli(['task', 'add', 'CLI 委托任务', '--priority', 'P0', '--data-dir', dir])
    expect(code).toBe(0)
    const r = db.exec("SELECT title, priority FROM tasks WHERE title = 'CLI 委托任务'")
    expect(r[0]?.values).toEqual([['CLI 委托任务', 'P0']])
    expect(notifyCount).toBe(1)
  })

  it('task list 委托（只读），不触发通知', async () => {
    acquireGuiLock(dir, { port: ipc.port, token: ipc.token })
    const code = await runCli(['task', 'list', '--data-dir', dir])
    expect(code).toBe(0)
    expect(notifyCount).toBe(0)
  })

  it('task delete 委托，删除任务成功', async () => {
    acquireGuiLock(dir, { port: ipc.port, token: ipc.token })
    const created = await runCli(['task', 'add', '待删除任务', '--data-dir', dir])
    expect(created).toBe(0)
    const r = db.exec("SELECT id FROM tasks WHERE title = '待删除任务'")
    const id = r[0].values[0][0] as string
    const code = await runCli(['task', 'delete', id, '--data-dir', dir])
    expect(code).toBe(0)
    const after = db.exec("SELECT id FROM tasks WHERE title = '待删除任务'")
    expect(after[0]?.values.length ?? 0).toBe(0)
  })

  it('未知子命令返回非 0', async () => {
    const code = await runCli(['task', 'bogus', '--data-dir', dir])
    expect(code).toBe(1)
  })
})

describe('CLI 本地回退（GUI 未运行）', () => {
  it('task add 走文件模式创建成功', async () => {
    const code = await runCli(['task', 'add', '本地任务', '--data-dir', dir])
    expect(code).toBe(0)
  })

  it('task list 走文件模式成功', async () => {
    const code = await runCli(['task', 'list', '--data-dir', dir])
    expect(code).toBe(0)
  })
})