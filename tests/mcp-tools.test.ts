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

describe('进程隔离：delegate 只转发内置工具，插件工具本地执行', () => {
  function writeEchoPlugin() {
    const dir = path.join(dataDir, 'agent-tools', 'echo')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'ztool.json'),
      JSON.stringify({
        id: 'echo',
        name: 'Echo',
        version: '1.0.0',
        apiVersion: 1,
        entry: 'index.js',
      }),
      'utf-8',
    )
    fs.writeFileSync(
      path.join(dir, 'index.js'),
      `module.exports = { tools: [{ key: 'echo:say', name: 'echo_say', label: 'Echo', description: 'x', inputSchema: {}, run: async () => ({ ok: true, echo: true }) }] }`,
      'utf-8',
    )
  }

  it('内置工具经 delegate 转发', async () => {
    writeEchoPlugin()
    const configFile = path.join(dataDir, 'agent-mcp-config.json')
    loadConfig({ configFile })
    let delegatedCount = 0
    const server = new McpServer({
      configFile,
      dataDir,
      delegate: async (req) => {
        delegatedCount++
        const p = req.params as { name?: string }
        return {
          jsonrpc: '2.0',
          id: req.id ?? null,
          result: { content: [{ type: 'text', text: JSON.stringify({ delegated: p.name }) }] },
        }
      },
    })
    await initServer(server)
    const call = await rpc(server, {
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: { name: 'task_create', arguments: { title: 'x' } },
    })
    expect(delegatedCount).toBe(1)
    const text = (call?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text)).toMatchObject({ delegated: 'task_create' })
  })

  it('插件工具不转发，本地沙箱执行', async () => {
    writeEchoPlugin()
    const configFile = path.join(dataDir, 'agent-mcp-config.json')
    loadConfig({ configFile })
    let delegated = false
    const server = new McpServer({
      configFile,
      dataDir,
      delegate: async () => {
        delegated = true
        return null
      },
    })
    await initServer(server)
    const call = await rpc(server, {
      jsonrpc: '2.0',
      id: 7,
      method: 'tools/call',
      params: { name: 'echo_say', arguments: {} },
    })
    expect(delegated).toBe(false)
    const text = (call?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text)).toMatchObject({ ok: true, echo: true })
  })

  it('excludePlugins：tools/list 不暴露插件工具', async () => {
    writeEchoPlugin()
    const configFile = path.join(dataDir, 'agent-mcp-config.json')
    loadConfig({ configFile })
    const server = new McpServer({ configFile, dataDir, excludePlugins: true })
    await initServer(server)
    const list = await rpc(server, { jsonrpc: '2.0', id: 8, method: 'tools/list', params: {} })
    const names = (list?.result as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(names).toContain('task_create')
    expect(names).not.toContain('echo_say')
  })
})