import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { startMcpIpc } from '../electron/main/mcp-ipc'
import { forwardCall, buildGuiDelegate } from '../electron/mcp/gui-client'
import { openDb } from '../electron/mcp/db'
import { acquireGuiLock, releaseGuiLock } from '../electron/mcp/lock'
import type { Database } from 'sql.js'

let dir: string
let db: Database
let ipc: Awaited<ReturnType<typeof startMcpIpc>>
let notifyCount = 0

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-mcp-ipc-'))
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

describe('GUI-IPC endpoint (server side)', () => {
  it('rejects unauthorized requests', async () => {
    await expect(
      forwardCall({ port: ipc.port, token: 'wrong' }, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'task_list', arguments: {} },
      }),
    ).rejects.toThrow()
  })

  it('executes a write on the GUI db and notifies renderer', async () => {
    const resp = await forwardCall({ port: ipc.port, token: ipc.token }, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'task_create', arguments: { title: 'IPC 任务' } },
    })
    expect(resp.error).toBeUndefined()
    const text = (resp.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text).title).toBe('IPC 任务')
    // 写到了 GUI 权威库
    const r = db.exec('SELECT title FROM tasks WHERE title = ?', ['IPC 任务'])
    expect(r[0]?.values.length).toBe(1)
    expect(notifyCount).toBe(1)
  })

  it('read-only call does not notify', async () => {
    const resp = await forwardCall({ port: ipc.port, token: ipc.token }, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'task_list', arguments: {} },
    })
    expect(resp.error).toBeUndefined()
    expect(notifyCount).toBe(0)
  })
})

describe('buildGuiDelegate (client side)', () => {
  it('returns null when GUI is not running', async () => {
    const delegate = buildGuiDelegate({ dataDir: dir })
    const resp = await delegate({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'task_list', arguments: {} } })
    expect(resp).toBeNull()
  })

  it('forwards to the GUI when a GUI lock with endpoint exists', async () => {
    acquireGuiLock(dir, { port: ipc.port, token: ipc.token })
    const delegate = buildGuiDelegate({ dataDir: dir })
    const resp = await delegate({ jsonrpc: '2.0', id: 10, method: 'tools/call', params: { name: 'task_list', arguments: {} } })
    expect(resp).not.toBeNull()
    expect(resp?.id).toBe(10)
  })
})