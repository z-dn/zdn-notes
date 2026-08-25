import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ToolRegistry } from '../electron/core/tool-registry'
import {
  discoverPluginDirs,
  loadPlugin,
  loadPluginsIntoRegistry,
  pluginRoot,
} from '../electron/core/plugin-loader'
import { createPluginStorage } from '../electron/core/plugin-storage'
import { McpServer } from '../electron/mcp/mcp-server'
import { loadConfig } from '../electron/mcp/config'
let dirs: string[] = []
let dataDir: string

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-plugin-'))
  dirs.push(d)
  return d
}

beforeEach(() => {
  dirs = []
  dataDir = tmpDir()
})

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

const VALID_MANIFEST = {
  id: 'hello',
  name: 'Hello',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'index.js',
}

const VALID_ENTRY = `
module.exports = {
  tools: [
    {
      key: 'hello:say',
      name: 'hello_say',
      label: 'Hello',
      description: '回显消息',
      inputSchema: { type: 'object', properties: { msg: { type: 'string' } }, required: ['msg'] },
      run: async (ctx, args) => {
        ctx.log('info', 'called')
        return { ok: true, echo: args.msg, pluginId: ctx.pluginId }
      },
    },
  ],
}
`

function writePlugin(dir: string, manifest = VALID_MANIFEST, entry = VALID_ENTRY) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'ztool.json'), JSON.stringify(manifest), 'utf-8')
  fs.writeFileSync(path.join(dir, 'index.js'), entry, 'utf-8')
}

describe('plugin discovery', () => {
  it('finds plugin dirs containing ztool.json', () => {
    writePlugin(path.join(dataDir, 'agent-tools', 'hello'))
    fs.mkdirSync(path.join(dataDir, 'agent-tools', 'not-a-plugin'), { recursive: true }) // 无 ztool.json
    const dirsFound = discoverPluginDirs(dataDir)
    expect(dirsFound).toHaveLength(1)
    expect(path.basename(dirsFound[0])).toBe('hello')
  })

  it('returns empty when agent-tools dir missing', () => {
    expect(discoverPluginDirs(dataDir)).toEqual([])
  })
})

describe('plugin loading', () => {
  it('loads manifest and entry tools', () => {
    writePlugin(path.join(dataDir, 'agent-tools', 'hello'))
    const plugin = loadPlugin(path.join(dataDir, 'agent-tools', 'hello'))
    expect(plugin.manifest.id).toBe('hello')
    expect(plugin.manifest.tools).toHaveLength(1)
    expect(plugin.manifest.tools[0].name).toBe('hello_say')
  })

  it('rejects incompatible apiVersion', () => {
    writePlugin(path.join(dataDir, 'agent-tools', 'bad'), { ...VALID_MANIFEST, apiVersion: 99 })
    expect(() => loadPlugin(path.join(dataDir, 'agent-tools', 'bad'))).toThrow(/apiVersion/)
  })

  it('全权信任：插件可 require 任意模块（含原白名单外的 builtin）', () => {
    writePlugin(
      path.join(dataDir, 'agent-tools', 'full'),
      VALID_MANIFEST,
      `const cp = require('child_process')\nconst net = require('net')\nmodule.exports = { tools: [{ key: 'x', name: 'x', description: 'x', inputSchema: {}, run: () => ({ hasCp: !!cp, hasNet: !!net }) }] }`,
    )
    const plugin = loadPlugin(path.join(dataDir, 'agent-tools', 'full'))
    expect(plugin.manifest.tools).toHaveLength(1)
    expect(plugin.manifest.tools[0].run({}, {})).toMatchObject({ hasCp: true, hasNet: true })
  })

  it('热重载：重复加载同一插件会重新执行入口', () => {
    const dir = path.join(dataDir, 'agent-tools', 'hello')
    writePlugin(dir, VALID_MANIFEST, `module.exports = { tools: [{ key: 'a', name: 'a', description: 'x', inputSchema: {}, run: () => 1 }] }`)
    const p1 = loadPlugin(dir)
    expect(p1.manifest.tools).toHaveLength(1)
    writePlugin(dir, VALID_MANIFEST, `module.exports = { tools: [{ key: 'b', name: 'b', description: 'x', inputSchema: {}, run: () => 2 }] }`)
    const p2 = loadPlugin(dir)
    expect(p2.manifest.tools[0].name).toBe('b')
  })
})

describe('plugin storage', () => {
  it('persists and isolates KV per plugin', () => {
    writePlugin(path.join(dataDir, 'agent-tools', 'hello'))
    const s1 = createPluginStorage(dataDir, 'hello')
    s1.set('count', 3)
    const s2 = createPluginStorage(dataDir, 'hello')
    expect(s2.get('count')).toBe(3)
    expect(s2.keys()).toContain('count')
    s2.delete('count')
    expect(s1.get('count')).toBeUndefined()
  })
})

describe('plugin tools in registry + execution ctx', () => {
  it('registers plugin tools and executes with plugin ctx', async () => {
    writePlugin(path.join(dataDir, 'agent-tools', 'hello'))
    const reg = new ToolRegistry()
    const loaded = loadPluginsIntoRegistry(reg, dataDir)
    expect(loaded).toHaveLength(1)

    const tools = reg.buildMcpTools({ enabled: true, permissions: {} })
    expect(tools).toHaveLength(1)
    expect(tools[0].kind).toBe('plugin')
    expect(tools[0].name).toBe('hello_say')

    const spec = tools[0]
    const result = await spec.run(
      {
        kind: 'plugin',
        dataDir,
        pluginId: 'hello',
        storage: createPluginStorage(dataDir, 'hello'),
        log: () => {},
      },
      { msg: 'hi' },
    )
    expect(result).toMatchObject({ ok: true, echo: 'hi', pluginId: 'hello' })
  })
})

describe('pluginRoot', () => {
  it('resolves under data dir', () => {
    expect(pluginRoot(dataDir)).toBe(path.join(dataDir, 'agent-tools'))
  })
})

describe('McpServer 集成：插件工具走 MCP 协议 + ctx.app 委托', () => {
  async function rpc(server: McpServer, payload: Record<string, unknown>) {
    return server.handleMessage(JSON.stringify(payload))
  }

  it('tools/list 暴露插件工具，tools/call 以插件 ctx 执行', async () => {
    writePlugin(
      path.join(dataDir, 'agent-tools', 'echo'),
      { ...VALID_MANIFEST, id: 'echo', name: 'Echo' },
      `
      module.exports = {
        tools: [
          {
            key: 'echo:say',
            name: 'echo_say',
            label: 'Echo',
            description: '回显参数',
            inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
            run: async (ctx, args) => {
              ctx.storage.set('last', args.msg)
              return { ok: true, echo: args.msg, pluginId: ctx.pluginId }
            },
          },
        ],
      }
      `,
    )
    const configFile = path.join(dataDir, 'agent-mcp-config.json')
    loadConfig({ configFile })
    const server = new McpServer({ configFile, dataDir })

    await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    await rpc(server, { jsonrpc: '2.0', method: 'notifications/initialized' })

    const list = await rpc(server, { jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const names = (list?.result as { tools: { name: string }[] }).tools.map((t) => t.name)
    expect(names).toContain('task_create') // 内置
    expect(names).toContain('echo_say') // 插件

    const call = await rpc(server, {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'echo_say', arguments: { msg: 'hello' } },
    })
    expect(call?.error).toBeUndefined()
    const text = (call?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text)).toMatchObject({ ok: true, echo: 'hello', pluginId: 'echo' })
  })

  it('注入 appBridge：有 bridge 时 ctx.app 可用', async () => {
    writePlugin(
      path.join(dataDir, 'agent-tools', 'bridge'),
      { ...VALID_MANIFEST, id: 'bridge', name: 'Bridge' },
      `
      module.exports = {
        tools: [
          {
            key: 'bridge:app',
            name: 'bridge_app',
            label: 'Bridge',
            description: '调应用业务层',
            inputSchema: {},
            run: async (ctx, args) => {
              if (!ctx.app) return { ok: false, error: 'no app' }
              const r = await ctx.app('task:getAll', [])
              return { ok: true, count: Array.isArray(r) ? r.length : 0 }
            },
          },
        ],
      }
      `,
    )
    const configFile = path.join(dataDir, 'agent-mcp-config.json')
    loadConfig({ configFile })
    const server = new McpServer({
      configFile,
      dataDir,
      appBridge: async (channel, args) => `${channel}:${args.length}`,
    })

    await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    await rpc(server, { jsonrpc: '2.0', method: 'notifications/initialized' })
    const call = await rpc(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'bridge_app', arguments: {} },
    })
    const text = (call?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text)).toMatchObject({ ok: true, count: 0 })
  })

  it('未注入 appBridge 时 ctx.app 不可用', async () => {
    writePlugin(
      path.join(dataDir, 'agent-tools', 'nobridge'),
      { ...VALID_MANIFEST, id: 'nobridge', name: 'NoBridge' },
      `
      module.exports = {
        tools: [
          {
            key: 'nobridge:app',
            name: 'nobridge_app',
            description: 'x',
            inputSchema: {},
            run: async (ctx) => (ctx.app ? { ok: false } : { ok: true, noApp: true }),
          },
        ],
      }
      `,
    )
    const configFile = path.join(dataDir, 'agent-mcp-config.json')
    loadConfig({ configFile })
    const server = new McpServer({ configFile, dataDir })
    await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    await rpc(server, { jsonrpc: '2.0', method: 'notifications/initialized' })
    const call = await rpc(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'nobridge_app', arguments: {} },
    })
    const text = (call?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text)).toMatchObject({ ok: true, noApp: true })
  })

  it('app/invoke 在有 appService 时执行业务通道', async () => {
    const { AppService } = await import('../electron/core/app-service')
    const svc = new AppService()
    svc.register('task:getAll', () => [{ id: '1' }])
    const configFile = path.join(dataDir, 'agent-mcp-config.json')
    loadConfig({ configFile })
    const calls: { tool: string; ok: boolean }[] = []
    const server = new McpServer({
      configFile,
      dataDir,
      appService: svc,
      onCall: (c) => calls.push({ tool: c.tool, ok: c.ok }),
    })
    await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    const resp = await rpc(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'app/invoke',
      params: { channel: 'task:getAll', args: [] },
    })
    expect(resp?.result).toEqual([{ id: '1' }])
    expect(calls).toMatchObject([{ tool: 'ctx.app:task:getAll', ok: true }])
  })

  it('app/invoke 失败时也记录审计日志', async () => {
    const { AppService } = await import('../electron/core/app-service')
    const svc = new AppService()
    const configFile = path.join(dataDir, 'agent-mcp-config.json')
    loadConfig({ configFile })
    const calls: { tool: string; ok: boolean; error?: string }[] = []
    const server = new McpServer({
      configFile,
      dataDir,
      appService: svc,
      onCall: (c) => calls.push({ tool: c.tool, ok: c.ok, error: c.error }),
    })
    await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    const resp = await rpc(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'app/invoke',
      params: { channel: 'task:getAll', args: [] },
    })
    expect(resp?.error?.code).toBe(-32000)
    expect(calls).toMatchObject([
      { tool: 'ctx.app:task:getAll', ok: false, error: expect.stringContaining('未知通道') },
    ])
  })

  it('app/invoke 无 appService 时返回错误', async () => {
    const configFile = path.join(dataDir, 'agent-mcp-config.json')
    loadConfig({ configFile })
    const server = new McpServer({ configFile, dataDir })
    await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    const resp = await rpc(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'app/invoke',
      params: { channel: 'task:getAll', args: [] },
    })
    expect(resp?.error?.code).toBe(-32001)
  })
})