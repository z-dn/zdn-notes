import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { McpServer } from '../electron/mcp/mcp-server'
import { loadConfig } from '../electron/mcp/config'
import {
  appendCallLog,
  readCallLogs,
  clearCallLogs,
  callLogFile,
  truncateArgs,
  makeCallLogEntry,
  MAX_LOG_ENTRIES,
} from '../electron/mcp/call-log'
import type { JsonRpcRequest, JsonRpcResponse } from '../electron/mcp/mcp-server'
import type { McpCallLogEntry } from '../electron/mcp/call-log'

const dirs: string[] = []

function tmpDataDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-call-log-'))
  dirs.push(d)
  return d
}

function entry(overrides: Partial<Parameters<typeof makeCallLogEntry>[0]> = {}) {
  return makeCallLogEntry({
    ts: 1700000000000,
    tool: 'task_list',
    args: {},
    ok: true,
    ms: 12,
    source: 'gui',
    ...overrides,
  })
}

afterEach(() => {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

describe('call-log', () => {
  it('appends entries to JSONL file and reads them newest-first', () => {
    const dir = tmpDataDir()
    appendCallLog(dir, entry({ ts: 1, tool: 'task_list' }))
    appendCallLog(dir, entry({ ts: 2, tool: 'task_create' }))

    expect(fs.existsSync(callLogFile(dir))).toBe(true)
    const logs = readCallLogs(dir)
    expect(logs).toHaveLength(2)
    expect(logs[0].tool).toBe('task_create') // 倒序：最新在前
    expect(logs[1].tool).toBe('task_list')
    expect(logs[0].id).toBeTruthy()
    expect(logs[0].source).toBe('gui')
  })

  it('truncates log to the limit when reading', () => {
    const dir = tmpDataDir()
    for (let i = 0; i < 10; i++) {
      appendCallLog(dir, entry({ ts: i, tool: 'task_list' }))
    }
    const logs = readCallLogs(dir, 3)
    expect(logs).toHaveLength(3)
    expect(logs[0].ts).toBe(9)
  })

  it('trims file when exceeding MAX_LOG_ENTRIES', () => {
    const dir = tmpDataDir()
    const total = MAX_LOG_ENTRIES + 50
    const lines: string[] = []
    for (let i = 0; i < total; i++) {
      lines.push(JSON.stringify(entry({ ts: i, tool: 'task_list' })))
    }
    fs.writeFileSync(callLogFile(dir), lines.join('\n') + '\n', 'utf-8')
    // 下一次 append 触发修剪，只保留最近 MAX_LOG_ENTRIES 条
    appendCallLog(dir, entry({ ts: total, tool: 'task_list' }))
    const logs = readCallLogs(dir, MAX_LOG_ENTRIES + 10)
    expect(logs).toHaveLength(MAX_LOG_ENTRIES)
    expect(logs[0].ts).toBe(total) // 最新一条保留
    expect(logs[logs.length - 1].ts).toBe(51)
  })

  it('clearCallLogs removes the file and readCallLogs returns empty', () => {
    const dir = tmpDataDir()
    appendCallLog(dir, entry())
    expect(readCallLogs(dir)).toHaveLength(1)
    clearCallLogs(dir)
    expect(fs.existsSync(callLogFile(dir))).toBe(false)
    expect(readCallLogs(dir)).toEqual([])
  })

  it('readCallLogs returns empty when no file exists', () => {
    expect(readCallLogs(tmpDataDir())).toEqual([])
  })

  it('skips corrupt lines while reading', () => {
    const dir = tmpDataDir()
    appendCallLog(dir, entry({ tool: 'task_list' }))
    fs.appendFileSync(callLogFile(dir), 'not-json\n', 'utf-8')
    appendCallLog(dir, entry({ tool: 'task_get' }))
    const logs = readCallLogs(dir)
    expect(logs).toHaveLength(2)
    expect(logs[0].tool).toBe('task_get')
    expect(logs[1].tool).toBe('task_list')
  })
})

describe('truncateArgs', () => {
  it('truncates long strings', () => {
    const out = truncateArgs({ title: 'x'.repeat(500) })
    expect(out.title as string).toHaveLength(201) // 200 字符 + 省略号
    expect((out.title as string).endsWith('…')).toBe(true)
  })

  it('bounds nested arrays and objects', () => {
    const out = truncateArgs({ deep: { a: [1, 2, 3], b: { c: { d: { e: 1 } } } } })
    expect(out.deep).toBeDefined()
    expect(JSON.stringify(out).length).toBeLessThan(500)
  })

  it('returns empty object for falsy args', () => {
    expect(truncateArgs(undefined)).toEqual({})
    expect(truncateArgs(null as unknown as Record<string, unknown>)).toEqual({})
  })
})

describe('McpServer.onCall 集成', () => {
  type OnCall = (call: Omit<McpCallLogEntry, 'id' | 'source'>) => void

  function makeServer(onCall: OnCall) {
    const dir = tmpDataDir()
    const configFile = path.join(dir, 'agent-mcp-config.json')
    loadConfig({ configFile })
    const server = new McpServer({ configFile, dataDir: dir, onCall })
    return { dir, configFile, server }
  }

  async function init(server: McpServer): Promise<void> {
    await server.handleMessage(
      JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    )
  }

  it('本地执行内置工具时触发 onCall 并携带耗时/结果', async () => {
    const calls: Record<string, unknown>[] = []
    const { server } = makeServer((c) => calls.push(c))
    await init(server)
    await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'task_list', arguments: { status: 'todo' } },
      }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ tool: 'task_list', ok: true })
    expect(calls[0]).toHaveProperty('ms')
    expect(calls[0]).toHaveProperty('ts')
  })

  it('delegate 返回非 null 时本地不再记录（避免与 GUI 双写）', async () => {
    const calls: Record<string, unknown>[] = []
    const delegate = async (_req: JsonRpcRequest): Promise<JsonRpcResponse> => ({
      jsonrpc: '2.0',
      id: 1,
      result: { content: [{ type: 'text', text: 'delegated' }] },
    })
    const configFile = path.join(tmpDataDir(), 'agent-mcp-config.json')
    loadConfig({ configFile })
    const delegatedServer = new McpServer({
      configFile,
      dataDir: tmpDataDir(),
      delegate,
      onCall: (c) => calls.push(c),
    })
    await init(delegatedServer)
    await delegatedServer.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'task_list', arguments: {} },
      }),
    )
    expect(calls).toHaveLength(0)
  })

  it('delegate 返回 null（GUI 离线回退本地）时正常记录', async () => {
    const calls: Record<string, unknown>[] = []
    const delegate = async (): Promise<JsonRpcResponse | null> => null
    const configFile = path.join(tmpDataDir(), 'agent-mcp-config.json')
    loadConfig({ configFile })
    const server = new McpServer({
      configFile,
      dataDir: tmpDataDir(),
      delegate,
      onCall: (c) => calls.push(c),
    })
    await init(server)
    await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 4,
        method: 'tools/call',
        params: { name: 'task_list', arguments: {} },
      }),
    )
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ tool: 'task_list', ok: true })
  })

  it('调用失败时 onCall 记录 ok:false 与错误信息', async () => {
    const calls: Record<string, unknown>[] = []
    const configFile = path.join(tmpDataDir(), 'agent-mcp-config.json')
    loadConfig({ configFile })
    const server = new McpServer({
      configFile,
      dataDir: tmpDataDir(),
      onCall: (c) => calls.push(c),
    })
    await init(server)
    const resp = await server.handleMessage(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 5,
        method: 'tools/call',
        params: { name: 'task_create', arguments: { title: '' } },
      }),
    )
    expect(resp?.error).toBeDefined()
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ tool: 'task_create', ok: false })
    expect(typeof calls[0].error).toBe('string')
  })
})
