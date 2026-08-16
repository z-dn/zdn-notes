import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { McpServer } from '../electron/mcp/mcp-server'
import { loadConfig, writeConfig } from '../electron/mcp/config'

let dirs: string[] = []
let dataDir: string

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-mcp-tools-'))
  dirs.push(d)
  return d
}

function rpc(server: McpServer, payload: Record<string, unknown>) {
  return server.handleMessage(JSON.stringify(payload))
}

async function initServer(server: McpServer): Promise<void> {
  await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05' } })
  await rpc(server, { jsonrpc: '2.0', method: 'notifications/initialized' })
}

beforeEach(() => {
  dirs = []
  dataDir = tmpDir()
})

afterEach(() => {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

function makeServer(): McpServer {
  const configFile = path.join(dataDir, 'agent-mcp-config.json')
  loadConfig({ configFile }) // 生成默认配置
  return new McpServer({ configFile, dataDir })
}

describe('initialize handshake (P2-4)', () => {
  it('returns the server supported protocol version', async () => {
    const server = makeServer()
    const resp = await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })
    expect(resp?.result).toMatchObject({ protocolVersion: '2024-11-05' })
  })

  it('rejects tools/list before initialize', async () => {
    const server = makeServer()
    const resp = await rpc(server, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })
    expect(resp?.error?.code).toBe(-32000)
  })

  it('allows tools/list after initialize', async () => {
    const server = makeServer()
    await initServer(server)
    const resp = await rpc(server, { jsonrpc: '2.0', id: 3, method: 'tools/list', params: {} })
    expect(resp?.error).toBeUndefined()
  })
})

describe('permission whitelist', () => {
  it('exposes only allowed tools by default', async () => {
    const server = makeServer()
    await initServer(server)
    const resp = await rpc(server, { jsonrpc: '2.0', id: 4, method: 'tools/list', params: {} })
    const names = (resp?.result as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(names).toContain('task_create')
    expect(names).toContain('task_list')
    expect(names).toContain('task_get')
    expect(names).toContain('task_update_status')
    expect(names).toContain('task_update')
    expect(names).toContain('task_delete')
    // 分类能力已从 MCP 中移除，不会出现在 tools/list
    expect(names).not.toContain('category_list')
    expect(names).not.toContain('category_create')
  })

  it('returns Unknown tool for a non-existent tool', async () => {
    const server = makeServer()
    await initServer(server)
    const resp = await rpc(server, {
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'category_create', arguments: { name: 'x' } },
    })
    expect(resp?.error?.code).toBe(-32602)
  })

  it('reloadConfig applies whitelist changes to tools/list', async () => {
    const server = makeServer()
    await initServer(server)
    const configFile = path.join(dataDir, 'agent-mcp-config.json')
    writeConfig(configFile, { permissions: { 'task:delete': false } })
    server.reloadConfig()
    const resp = await rpc(server, { jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} })
    const names = (resp?.result as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(names).not.toContain('task_delete')
    writeConfig(configFile, { permissions: { 'task:delete': true } })
    server.reloadConfig()
    const resp2 = await rpc(server, { jsonrpc: '2.0', id: 9, method: 'tools/list', params: {} })
    const names2 = (resp2?.result as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(names2).toContain('task_delete')
  })
})

describe('tools/call execution', () => {
  it('creates and lists tasks through the MCP protocol', async () => {
    const server = makeServer()
    await initServer(server)
    const created = await rpc(server, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'task_create', arguments: { title: '协议任务', priority: 'P1' } },
    })
    expect(created?.error).toBeUndefined()
    const text = (created?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text).title).toBe('协议任务')

    const listed = await rpc(server, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'task_list', arguments: {} },
    })
    const text2 = (listed?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text2)).toHaveLength(1)
  })
})