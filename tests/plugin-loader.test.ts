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
  id: 'http',
  name: 'HTTP 请求',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'index.js',
  permissions: ['http:request'],
}

const VALID_ENTRY = `
module.exports = {
  tools: [
    {
      key: 'http:request',
      name: 'http_request',
      label: 'HTTP 请求',
      description: '发起 HTTP 请求',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      run: async (ctx, args) => {
        ctx.log('info', 'called')
        if (!ctx.httpRequest) return { ok: false, error: 'no capability' }
        return { ok: true, url: args.url }
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
    writePlugin(path.join(dataDir, 'agent-tools', 'http'))
    fs.mkdirSync(path.join(dataDir, 'agent-tools', 'not-a-plugin'), { recursive: true }) // 无 ztool.json
    const dirsFound = discoverPluginDirs(dataDir)
    expect(dirsFound).toHaveLength(1)
    expect(path.basename(dirsFound[0])).toBe('http')
  })

  it('returns empty when agent-tools dir missing', () => {
    expect(discoverPluginDirs(dataDir)).toEqual([])
  })
})

describe('plugin loading', () => {
  it('loads manifest and entry tools', () => {
    writePlugin(path.join(dataDir, 'agent-tools', 'http'))
    const plugin = loadPlugin(path.join(dataDir, 'agent-tools', 'http'))
    expect(plugin.manifest.id).toBe('http')
    expect(plugin.manifest.permissions).toEqual(['http:request'])
    expect(plugin.manifest.tools).toHaveLength(1)
    expect(plugin.manifest.tools[0].name).toBe('http_request')
  })

  it('rejects incompatible apiVersion', () => {
    writePlugin(path.join(dataDir, 'agent-tools', 'bad'), { ...VALID_MANIFEST, apiVersion: 99 })
    expect(() => loadPlugin(path.join(dataDir, 'agent-tools', 'bad'))).toThrow(/apiVersion/)
  })

  it('blocks require of non-whitelisted modules', () => {
    writePlugin(
      path.join(dataDir, 'agent-tools', 'evil'),
      VALID_MANIFEST,
      `const _ = require('electron')\nmodule.exports = { tools: [] }`,
    )
    expect(() => loadPlugin(path.join(dataDir, 'agent-tools', 'evil'))).toThrow(/不允许 require/)
  })
})

describe('plugin storage', () => {
  it('persists and isolates KV per plugin', () => {
    writePlugin(path.join(dataDir, 'agent-tools', 'http'))
    const s1 = createPluginStorage(dataDir, 'http')
    s1.set('count', 3)
    const s2 = createPluginStorage(dataDir, 'http')
    expect(s2.get('count')).toBe(3)
    expect(s2.keys()).toContain('count')
    s2.delete('count')
    expect(s1.get('count')).toBeUndefined()
  })
})

describe('plugin tools in registry + execution ctx', () => {
  it('registers plugin tools and executes with plugin ctx', async () => {
    writePlugin(path.join(dataDir, 'agent-tools', 'http'))
    const reg = new ToolRegistry()
    const loaded = loadPluginsIntoRegistry(reg, dataDir)
    expect(loaded).toHaveLength(1)

    const tools = reg.buildMcpTools({ enabled: true, permissions: { 'http:request': true } })
    expect(tools).toHaveLength(1)
    expect(tools[0].kind).toBe('plugin')
    expect(tools[0].name).toBe('http_request')

    const spec = tools[0]
    const result = await spec.run(
      {
        kind: 'plugin',
        dataDir,
        pluginId: 'http',
        storage: createPluginStorage(dataDir, 'http'),
        log: () => {},
        httpRequest: async (c) => ({ ok: true, url: String(c.url) }),
      },
      { url: 'https://example.com' },
    )
    expect(result).toMatchObject({ ok: true, url: 'https://example.com' })
  })

  it('plugin ctx without http:request permission has no capability', async () => {
    writePlugin(
      path.join(dataDir, 'agent-tools', 'http'),
      { ...VALID_MANIFEST, permissions: [] },
    )
    const reg = new ToolRegistry()
    loadPluginsIntoRegistry(reg, dataDir)
    const spec = reg.buildMcpTools({ enabled: true, permissions: {} })[0]
    // 未获授权：httpRequest 能力不注入
    expect(spec.pluginPermissions).toEqual([])
  })
})

describe('pluginRoot', () => {
  it('resolves under data dir', () => {
    expect(pluginRoot(dataDir)).toBe(path.join(dataDir, 'agent-tools'))
  })
})

describe('McpServer 集成：插件工具走 MCP 协议', () => {
  async function rpc(server: McpServer, payload: Record<string, unknown>) {
    return server.handleMessage(JSON.stringify(payload))
  }

  it('tools/list 暴露插件工具，tools/call 以插件 ctx 执行', async () => {
    writePlugin(
      path.join(dataDir, 'agent-tools', 'echo'),
      { ...VALID_MANIFEST, id: 'echo', name: 'Echo', permissions: [] },
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

  it('注入 desktop 桥：声明 desktop 权限且有 bridge 时 ctx.desktop 可用', async () => {
    writePlugin(
      path.join(dataDir, 'agent-tools', 'desk'),
      { ...VALID_MANIFEST, id: 'desk', name: 'Desk', permissions: ['desktop'] },
      `
      module.exports = {
        tools: [
          {
            key: 'desk:hi',
            name: 'desk_hi',
            label: 'Desk',
            description: '调桌面能力',
            inputSchema: {},
            run: async (ctx, args) => {
              if (!ctx.desktop) return { ok: false, error: 'no desktop' }
              const r = await ctx.desktop('echo', 'x')
              return { ok: true, got: r }
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
      desktopBridge: async (channel, args) => `${channel}:${args[0]}`,
    })

    await rpc(server, { jsonrpc: '2.0', id: 1, method: 'initialize' })
    await rpc(server, { jsonrpc: '2.0', method: 'notifications/initialized' })
    const call = await rpc(server, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'desk_hi', arguments: {} },
    })
    const text = (call?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text)).toMatchObject({ ok: true, got: 'echo:x' })
  })

  it('未注入 desktop 桥时 ctx.desktop 不可用', async () => {
    writePlugin(
      path.join(dataDir, 'agent-tools', 'desk2'),
      { ...VALID_MANIFEST, id: 'desk2', name: 'Desk2', permissions: ['desktop'] },
      `
      module.exports = {
        tools: [
          {
            key: 'desk2:hi',
            name: 'desk2_hi',
            description: 'x',
            inputSchema: {},
            run: async (ctx) => (ctx.desktop ? { ok: false } : { ok: true, noDesktop: true }),
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
      params: { name: 'desk2_hi', arguments: {} },
    })
    const text = (call?.result as { content: { text: string }[] }).content[0].text
    expect(JSON.parse(text)).toMatchObject({ ok: true, noDesktop: true })
  })
})