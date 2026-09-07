import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ToolRegistry } from '../electron/core/tool-registry'
import {
  discoverPluginDirs,
  loadPlugin,
  loadPluginsIntoRegistry,
  parseDependencies,
  planPluginLoad,
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

/** 任意文件集写入插件目录（多文件/子目录场景） */
function writeFiles(dir: string, files: Record<string, string>) {
  fs.mkdirSync(dir, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(dir, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content, 'utf-8')
  }
}

function manifestOf(id: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
  return { id, version: '1.0.0', apiVersion: 1, entry: 'index.js', ...extra }
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

describe('parseDependencies', () => {
  it('接受合法声明并原样保留范围', () => {
    expect(parseDependencies({ b: '^1.2.0', c: '~2.0.0' }, 'a')).toEqual({
      b: '^1.2.0',
      c: '~2.0.0',
    })
  })

  it('空声明返回 undefined', () => {
    expect(parseDependencies({}, 'a')).toBeUndefined()
    expect(parseDependencies(undefined, 'a')).toBeUndefined()
    expect(parseDependencies(null, 'a')).toBeUndefined()
  })

  it('拒绝非法 id / 自依赖 / 非法范围 / 非对象', () => {
    expect(() => parseDependencies({ '../x': '*' }, 'a')).toThrow(/依赖 id 非法/)
    expect(() => parseDependencies({ 'a b': '*' }, 'a')).toThrow(/依赖 id 非法/)
    expect(() => parseDependencies({ a: '*' }, 'a')).toThrow(/不能依赖自己/)
    expect(() => parseDependencies({ b: 'latest' }, 'a')).toThrow(/版本范围非法/)
    expect(() => parseDependencies({ b: '' }, 'a')).toThrow(/版本范围非法/)
    expect(() => parseDependencies(['b'], 'a')).toThrow(/必须是对象/)
  })
})

describe('插件依赖机制：planPluginLoad / loadPluginsIntoRegistry', () => {
  const root = () => path.join(dataDir, 'agent-tools')

  it('拓扑排序：被依赖插件先加载（目录字母序依赖方在前）', () => {
    writeFiles(path.join(root(), 'a'), {
      'ztool.json': JSON.stringify(manifestOf('a', { dependencies: { b: '*' } })),
      'index.js': `module.exports = { tools: [{ key: 'a:t', name: 'a_t', description: 'x', inputSchema: {}, run: () => 1 }] }`,
    })
    writeFiles(path.join(root(), 'b'), {
      'ztool.json': JSON.stringify(manifestOf('b')),
      'index.js': `module.exports = { tools: [{ key: 'b:t', name: 'b_t', description: 'x', inputSchema: {}, run: () => 1 }] }`,
    })
    const reg = new ToolRegistry()
    const loaded = loadPluginsIntoRegistry(reg, dataDir)
    expect(loaded.map((p) => p.manifest.id)).toEqual(['b', 'a'])
    expect(planPluginLoad(dataDir).errors).toHaveLength(0)
  })

  it('缺依赖：拒载并报错', () => {
    writeFiles(path.join(root(), 'a'), {
      'ztool.json': JSON.stringify(manifestOf('a', { dependencies: { ghost: '*' } })),
      'index.js': `module.exports = { tools: [] }`,
    })
    const plan = planPluginLoad(dataDir)
    expect(plan.order).toHaveLength(0)
    expect(plan.errors).toEqual([
      expect.objectContaining({ id: 'a', error: expect.stringContaining('缺少依赖: ghost') }),
    ])
    expect(loadPluginsIntoRegistry(new ToolRegistry(), dataDir)).toHaveLength(0)
  })

  it('依赖版本不满足：拒载并报范围与实际版本', () => {
    writeFiles(path.join(root(), 'b'), {
      'ztool.json': JSON.stringify(manifestOf('b', { version: '1.0.0' })),
      'index.js': `module.exports = { tools: [] }`,
    })
    writeFiles(path.join(root(), 'a'), {
      'ztool.json': JSON.stringify(manifestOf('a', { dependencies: { b: '^2.0.0' } })),
      'index.js': `module.exports = { tools: [] }`,
    })
    const plan = planPluginLoad(dataDir)
    // b 自身无依赖，正常加载；仅拒载版本不满足的 a
    expect(plan.order.map((e) => e.manifest.id)).toEqual(['b'])
    expect(plan.errors).toHaveLength(1)
    expect(plan.errors[0]).toMatchObject({ id: 'a' })
    expect(plan.errors[0].error).toBe('依赖版本不满足: b 需要 ^2.0.0，实际 1.0.0')
  })

  it('版本满足：正常加载且依赖先执行', () => {
    writeFiles(path.join(root(), 'b'), {
      'ztool.json': JSON.stringify(manifestOf('b', { version: '1.2.3' })),
      'index.js': `module.exports = { tools: [] }`,
    })
    writeFiles(path.join(root(), 'a'), {
      'ztool.json': JSON.stringify(manifestOf('a', { dependencies: { b: '^1.0.0' } })),
      'index.js': `module.exports = { tools: [] }`,
    })
    const plan = planPluginLoad(dataDir)
    expect(plan.order.map((e) => e.manifest.id)).toEqual(['b', 'a'])
    expect(plan.errors).toHaveLength(0)
  })

  it('循环依赖：环成员全部拒载并报环路径', () => {
    writeFiles(path.join(root(), 'a'), {
      'ztool.json': JSON.stringify(manifestOf('a', { dependencies: { b: '*' } })),
      'index.js': `module.exports = { tools: [] }`,
    })
    writeFiles(path.join(root(), 'b'), {
      'ztool.json': JSON.stringify(manifestOf('b', { dependencies: { a: '*' } })),
      'index.js': `module.exports = { tools: [] }`,
    })
    const plan = planPluginLoad(dataDir)
    expect(plan.order).toHaveLength(0)
    const byId = new Map(plan.errors.map((e) => [e.id, e.error]))
    expect(byId.get('a')).toBe('循环依赖: a → b → a')
    expect(byId.get('b')).toBe('循环依赖: a → b → a')
    expect(loadPluginsIntoRegistry(new ToolRegistry(), dataDir)).toHaveLength(0)
  })

  it('环下游传播：依赖环成员的插件以「依赖加载失败」拒载', () => {
    writeFiles(path.join(root(), 'a'), {
      'ztool.json': JSON.stringify(manifestOf('a', { dependencies: { b: '*' } })),
      'index.js': `module.exports = { tools: [] }`,
    })
    writeFiles(path.join(root(), 'b'), {
      'ztool.json': JSON.stringify(manifestOf('b', { dependencies: { c: '*' } })),
      'index.js': `module.exports = { tools: [] }`,
    })
    writeFiles(path.join(root(), 'c'), {
      'ztool.json': JSON.stringify(manifestOf('c', { dependencies: { b: '*' } })),
      'index.js': `module.exports = { tools: [] }`,
    })
    const plan = planPluginLoad(dataDir)
    const byId = new Map(plan.errors.map((e) => [e.id, e.error]))
    expect(byId.get('b')).toMatch(/循环依赖: b → c → b/)
    expect(byId.get('c')).toMatch(/循环依赖/)
    expect(byId.get('a')).toBe('依赖加载失败: b（循环依赖: b → c → b）')
  })

  it('依赖清单损坏：报依赖不可用', () => {
    writeFiles(path.join(root(), 'a'), {
      'ztool.json': JSON.stringify(manifestOf('a', { dependencies: { b: '*' } })),
      'index.js': `module.exports = { tools: [] }`,
    })
    writeFiles(path.join(root(), 'b'), { 'ztool.json': 'not json', 'index.js': 'x' })
    const plan = planPluginLoad(dataDir)
    expect(plan.errors.map((e) => e.error)).toContain('依赖不可用: b（清单损坏）')
  })

  it('热重载失效链：被依赖方更新后重建注册表，依赖方拿到新模块', async () => {
    writeFiles(path.join(root(), 'b'), {
      'ztool.json': JSON.stringify(manifestOf('b')),
      'lib.js': 'module.exports = { v: 1 }',
      'index.js': `module.exports = { tools: [] }`,
    })
    writeFiles(path.join(root(), 'a'), {
      'ztool.json': JSON.stringify(manifestOf('a', { dependencies: { b: '^1.0.0' } })),
      'index.js': `
        const bLib = require('../b/lib.js')
        module.exports = {
          tools: [{
            key: 'a:check', name: 'a_check', description: 'x', inputSchema: {},
            run: () => ({ v: bLib.v }),
          }],
        }`,
    })
    async function checkVersion(): Promise<number> {
      const reg = new ToolRegistry()
      loadPluginsIntoRegistry(reg, dataDir)
      const tool = reg
        .buildMcpTools({ enabled: true, permissions: {} })
        .find((t) => t.name === 'a_check')
      expect(tool).toBeDefined()
      const r = await tool!.run(
        {
          kind: 'plugin',
          dataDir,
          pluginId: 'a',
          storage: createPluginStorage(dataDir, 'a'),
          log: () => {},
        },
        {},
      )
      return (r as { v: number }).v
    }
    expect(await checkVersion()).toBe(1)
    fs.writeFileSync(path.join(root(), 'b', 'lib.js'), 'module.exports = { v: 2 }', 'utf-8')
    expect(await checkVersion()).toBe(2)
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