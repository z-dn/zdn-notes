import fs from 'fs'
import path from 'path'
import vm from 'vm'
import { PLUGIN_API_VERSION, LoadedPlugin, PluginManifest, PluginTool } from './contracts'
import type { ToolRegistry } from './tool-registry'

// ===================================================================
// 第三方插件运行时（agent-tools/）。
//
// 目录结构（数据目录下）：
//   <dataDir>/agent-tools/<pluginId>/ztool.json   ← 插件清单
//   <dataDir>/agent-tools/<pluginId>/<entry>      ← 入口 JS（CommonJS，导出 { tools }）
//
// 插件入口运行在受限 VM 沙箱里：
//   - 只提供 module/exports/require（require 限定 node 内建 + 插件目录内相对路径）
//   - 无 process、无 Electron、无 db —— 只能通过 ctx 的授权能力做事
//   - 超时保护：入口执行限时，防止死循环
//
// 插件工具的 run(ctx, args) 在 MCP tools/call 时由 registry 分发执行
// （ctx 为 PluginToolContext，见 mcp-server）。
// ===================================================================

export function pluginRoot(dataDir: string): string {
  return path.join(dataDir, 'agent-tools')
}

/** 发现数据目录下所有插件目录（含 ztool.json 的目录） */
export function discoverPluginDirs(dataDir: string): string[] {
  const root = pluginRoot(dataDir)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => path.join(root, e.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'ztool.json')))
}

export function readManifest(pluginDir: string): PluginManifest {
  const raw = fs.readFileSync(path.join(pluginDir, 'ztool.json'), 'utf-8')
  const parsed = JSON.parse(raw) as Partial<PluginManifest>
  if (!parsed.id || typeof parsed.id !== 'string') {
    throw new Error(`插件清单缺少 id: ${pluginDir}`)
  }
  if (parsed.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(
      `插件 ${parsed.id} 的 apiVersion=${parsed.apiVersion}，要求 ${PLUGIN_API_VERSION}`,
    )
  }
  return {
    id: parsed.id,
    name: parsed.name ?? parsed.id,
    version: parsed.version ?? '0.0.0',
    apiVersion: parsed.apiVersion,
    permissions: Array.isArray(parsed.permissions) ? parsed.permissions : [],
    tools: [],
    entry: parsed.entry,
    author: parsed.author,
    description: parsed.description,
    builtin: parsed.builtin === true,
    marketplace: parsed.marketplace,
  }
}

const ALLOWED_BUILTINS = new Set([
  'fs', 'path', 'url', 'util', 'assert', 'crypto', 'os', 'http', 'https', 'stream', 'buffer',
])

/** 受限 require：只允许 node 内建白名单 + 插件目录内的相对/绝对模块 */
function makeRequire(pluginDir: string, sandboxDir: string) {
  return function localRequire(spec: string): unknown {
    if (typeof spec !== 'string') throw new Error('require 参数必须是字符串')
    if (spec.startsWith('.') || spec.startsWith('/') || spec.startsWith('file:')) {
      const resolved = spec.startsWith('.') ? path.resolve(sandboxDir, spec) : path.resolve(spec)
      const rel = path.relative(pluginDir, resolved)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error(`不允许加载插件目录外的模块: ${spec}`)
      }
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(resolved)
    }
    if (ALLOWED_BUILTINS.has(spec)) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(spec)
    }
    throw new Error(`插件不允许 require 非白名单模块: ${spec}`)
  }
}

interface PluginModuleExports {
  tools?: PluginTool[]
  name?: string
  version?: string
  description?: string
  author?: string
}

/** 在受限 VM 中加载插件入口，返回其导出的 tools */
function loadPluginEntry(pluginDir: string, entry: string): PluginModuleExports {
  const entryPath = path.resolve(pluginDir, entry)
  if (!fs.existsSync(entryPath)) throw new Error(`插件入口不存在: ${entryPath}`)
  const code = fs.readFileSync(entryPath, 'utf-8')

  const moduleObj = { exports: {} }
  const sandbox = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: makeRequire(pluginDir, path.dirname(entryPath)),
    console: {
      // 一律写 stderr：插件日志不得污染 MCP stdio 的 stdout（JSON-RPC 通道）
      log: (...a: unknown[]) => console.error(`[plugin:${path.basename(pluginDir)}]`, ...a),
      error: (...a: unknown[]) => console.error(`[plugin:${path.basename(pluginDir)}]`, ...a),
      warn: (...a: unknown[]) => console.warn(`[plugin:${path.basename(pluginDir)}]`, ...a),
    },
    setTimeout,
    clearTimeout,
    Date,
    Math,
    JSON,
    Promise,
  }
  sandbox.exports = moduleObj.exports
  vm.createContext(sandbox)

  // 超时保护：同步入口限时执行
  let finished = false
  const timer = setTimeout(() => {
    if (!finished) throw new Error(`插件入口执行超时: ${path.basename(pluginDir)}`)
  }, 3000)
  try {
    vm.runInContext(code, sandbox, { filename: entryPath })
  } finally {
    finished = true
    clearTimeout(timer)
  }

  const mod = moduleObj.exports as PluginModuleExports
  return {
    tools: mod.tools,
    name: mod.name,
    version: mod.version,
    description: mod.description,
    author: mod.author,
  }
}

/** 加载单个插件，返回 LoadedPlugin */
export function loadPlugin(pluginDir: string): LoadedPlugin {
  const manifest = readManifest(pluginDir)
  const entry = manifest.entry ?? 'index.js'
  const mod = loadPluginEntry(pluginDir, entry)

  // 插件工具的 key 规范：`<pluginId>.<toolKey>` 或 `<toolKey>`；key 用于白名单
  const tools = (mod.tools ?? []).map((t, i) => {
    if (!t.key) {
      const base = t.name || `tool${i}`
      t.key = `${manifest.id}.${base}`
    }
    return t
  })
  manifest.tools = tools

  return { manifest, entryPath: path.join(pluginDir, entry) }
}

/** 加载数据目录下全部插件并注册进 registry；返回成功加载的插件列表 */
export function loadPluginsIntoRegistry(
  registry: ToolRegistry,
  dataDir: string,
): LoadedPlugin[] {
  const loaded: LoadedPlugin[] = []
  const dirs = discoverPluginDirs(dataDir)
  for (const dir of dirs) {
    try {
      const plugin = loadPlugin(dir)
      for (const tool of plugin.manifest.tools) {
        registry.register({
          key: tool.key,
          name: tool.name,
          label: tool.label ?? `${plugin.manifest.name}: ${tool.name}`,
          description: tool.description,
          inputSchema: tool.inputSchema,
          readonly: tool.readonly,
          danger: tool.danger,
          defaultEnabled: true,
          kind: 'plugin',
          pluginId: plugin.manifest.id,
          pluginPermissions: plugin.manifest.permissions,
          run: (ctx, args) => {
            // 由 mcp-server 构建的 PluginToolContext 传入；这里做类型收窄
            if (ctx.kind !== 'plugin') {
              throw new Error(`插件工具 ${tool.name} 需要 plugin 上下文`)
            }
            return tool.run(ctx, args)
          },
        })
      }
      loaded.push(plugin)
      // stderr：避免污染 MCP stdio 的 stdout（JSON-RPC 通道）
      console.error(`[agent-tools] loaded ${plugin.manifest.name} (${plugin.manifest.id})`)
    } catch (e) {
      console.error(`[agent-tools] 加载插件失败 ${path.basename(dir)}:`, e)
    }
  }
  return loaded
}