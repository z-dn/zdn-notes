import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import { PLUGIN_API_VERSION, LoadedPlugin, PluginManifest, PluginTool } from './contracts'
import type { ToolRegistry } from './tool-registry'

// ===================================================================
// 第三方插件运行时（agent-tools/）。
//
// 目录结构（数据目录下）：
//   <dataDir>/agent-tools/<pluginId>/ztool.json   ← 插件清单
//   <dataDir>/agent-tools/<pluginId>/<entry>      ← 入口 JS（CommonJS，导出 { tools }）
//
// 信任模型：插件 = 任意代码，与应用主进程同权限（无沙箱、无依赖限制）。
// 入口直接 require() 加载，依赖随插件目录分发（node_modules 打进 .ztool）。
// 安全靠用户自觉 + 安装时警告弹窗。保留的仅是结构契约：清单校验、
// tools 导出、key 唯一性（MCP 集成需要）。
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
    tools: [],
    entry: parsed.entry,
    author: parsed.author,
    description: parsed.description,
    builtin: parsed.builtin === true,
    marketplace: parsed.marketplace,
  }
}

interface PluginModuleExports {
  tools?: PluginTool[]
  name?: string
  version?: string
  description?: string
  author?: string
}

/** 清掉插件目录下已加载模块的 require 缓存（热重载时强制重新执行入口） */
function clearPluginCache(pluginDir: string, requireFrom: NodeRequire): void {
  for (const key of Object.keys(requireFrom.cache ?? {})) {
    if (key.startsWith(pluginDir + path.sep)) delete requireFrom.cache[key]
  }
}

/** 加载插件入口（全权信任：直接 require，无沙箱） */
function loadPluginEntry(pluginDir: string, entry: string): PluginModuleExports {
  const entryPath = path.resolve(pluginDir, entry)
  if (!fs.existsSync(entryPath)) throw new Error(`插件入口不存在: ${entryPath}`)
  // 以插件入口为锚点创建 require：CJS/ESM 双兼容，且插件自身依赖（node_modules）
  // 从插件目录正常解析（依赖随插件分发）
  const requireFrom = createRequire(entryPath)
  clearPluginCache(pluginDir, requireFrom)
  // 加载期间把 console.log/warn 重定向到 stderr：插件日志不得污染 MCP stdio 的 stdout
  const orig = { ...console }
  const prefix = `[plugin:${path.basename(pluginDir)}]`
  console.log = (...a: unknown[]) => orig.error(prefix, ...a)
  console.warn = (...a: unknown[]) => orig.error(prefix, ...a)
  try {
    const mod = requireFrom(entryPath) as PluginModuleExports
    return mod
  } finally {
    console.log = orig.log
    console.warn = orig.warn
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
          run: (ctx, args) => {
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