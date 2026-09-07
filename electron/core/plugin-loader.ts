import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'
import semver from 'semver'
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
//
// 插件间依赖：ztool.json 可声明 dependencies（插件 id → semver 范围），
// planPluginLoad 拓扑排序加载并校验满足性（缺依赖/版本不满足/循环依赖拒载）。
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

/** 解析并校验清单 dependencies（插件 id → semver 范围）。格式非法即抛错（整个插件拒绝加载） */
export function parseDependencies(
  raw: unknown,
  owner: string,
): Record<string, string> | undefined {
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`插件 ${owner} 的 dependencies 必须是对象（插件 id → semver 范围）`)
  }
  const out: Record<string, string> = {}
  for (const [depId, rawRange] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(depId)) {
      throw new Error(`插件 ${owner} 的依赖 id 非法: ${depId}（仅允许字母/数字/下划线/连字符，≤64）`)
    }
    if (depId === owner) {
      throw new Error(`插件 ${owner} 不能依赖自己`)
    }
    const range = typeof rawRange === 'string' ? rawRange.trim() : ''
    if (!range || semver.validRange(range) === null) {
      throw new Error(`插件 ${owner} 对依赖 ${depId} 的版本范围非法: ${String(rawRange)}`)
    }
    out[depId] = range
  }
  return Object.keys(out).length > 0 ? out : undefined
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
    dependencies: parseDependencies(parsed.dependencies, parsed.id),
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

// ---- 插件依赖图：拓扑排序 + 缺失/版本/环检测 ----

export interface PluginPlanEntry {
  dir: string
  manifest: PluginManifest
}

export interface PluginLoadPlan {
  /** 清单成功解析的全部插件（含后续因依赖被拒载者），供依赖方统计/展示复用 */
  read: PluginPlanEntry[]
  /** 拓扑序（被依赖者在前），可加载的插件 */
  order: PluginPlanEntry[]
  /** 拒载的插件及原因（缺依赖/版本不满足/循环依赖/清单损坏/重复 id） */
  errors: { dir: string; id?: string; error: string }[]
}

/** 在存活节点里找一个依赖环并标记全部成员为失败；找到返回 true（每次调用最多标一个环） */
function markCycle(parsed: Map<string, PluginPlanEntry>, failed: Map<string, string>): boolean {
  const WHITE = 0
  const GRAY = 1
  const BLACK = 2
  const color = new Map<string, number>()
  for (const id of parsed.keys()) if (!failed.has(id)) color.set(id, WHITE)
  const stack: string[] = []
  const dfs = (id: string): boolean => {
    color.set(id, GRAY)
    stack.push(id)
    for (const depId of Object.keys(parsed.get(id)!.manifest.dependencies ?? {})) {
      if (!color.has(depId)) continue // 已失败或不在存活集
      const c = color.get(depId)!
      if (c === GRAY) {
        const cycle = [...stack.slice(stack.indexOf(depId)), depId]
        const msg = `循环依赖: ${cycle.join(' → ')}`
        for (const member of stack.slice(stack.indexOf(depId))) failed.set(member, msg)
        stack.pop()
        color.set(id, BLACK)
        return true
      }
      if (c === WHITE && dfs(depId)) {
        stack.pop()
        color.set(id, BLACK)
        return true
      }
    }
    stack.pop()
    color.set(id, BLACK)
    return false
  }
  for (const id of color.keys()) {
    if (color.get(id) === WHITE && dfs(id)) return true
  }
  return false
}

/**
 * 依赖解析：拓扑排序加载计划 + 缺依赖/版本不满足/循环依赖检测。
 * 环成员全部拒载（不任选一边打破——打破选择是任意的且不可预测）；
 * 环/失败节点的下游依赖者以「依赖加载失败」传播拒载。
 */
export function planPluginLoad(dataDir: string): PluginLoadPlan {
  const dirs = discoverPluginDirs(dataDir).sort()
  const errors: { dir: string; id?: string; error: string }[] = []
  const parsed = new Map<string, PluginPlanEntry>()

  // 1) 读清单（容错：损坏的进 errors，不进图）
  for (const dir of dirs) {
    let manifest: PluginManifest
    try {
      manifest = readManifest(dir)
    } catch (e) {
      errors.push({ dir, error: `清单不可读: ${e instanceof Error ? e.message : String(e)}` })
      continue
    }
    if (parsed.has(manifest.id)) {
      errors.push({ dir, id: manifest.id, error: `插件 id 重复: ${manifest.id}` })
      continue
    }
    parsed.set(manifest.id, { dir, manifest })
  }
  const read = [...parsed.values()]

  const failed = new Map<string, string>() // id → 拒载原因
  const fail = (id: string, reason: string) => {
    if (!failed.has(id)) failed.set(id, reason)
  }

  // 2) 版本满足性：静态事实，一次判定（依赖存在且可读时）
  for (const entry of read) {
    for (const [depId, range] of Object.entries(entry.manifest.dependencies ?? {})) {
      const dep = parsed.get(depId)
      if (dep && !semver.satisfies(dep.manifest.version, range)) {
        fail(
          entry.manifest.id,
          `依赖版本不满足: ${depId} 需要 ${range}，实际 ${dep.manifest.version}`,
        )
      }
    }
  }

  // 3) 迭代到不动点：失败传播（缺依赖/依赖方失败）+ 环标记
  for (let changed = true; changed; ) {
    changed = false
    for (const id of [...parsed.keys()]) {
      if (failed.has(id)) continue
      for (const depId of Object.keys(parsed.get(id)!.manifest.dependencies ?? {})) {
        const dep = parsed.get(depId)
        if (!dep) {
          const broken = errors.some((e) => path.basename(e.dir) === depId)
          fail(id, broken ? `依赖不可用: ${depId}（清单损坏）` : `缺少依赖: ${depId}`)
          changed = true
          break
        }
        if (failed.has(depId)) {
          fail(id, `依赖加载失败: ${depId}（${failed.get(depId)}）`)
          changed = true
          break
        }
      }
    }
    if (markCycle(parsed, failed)) changed = true
  }

  for (const [id, reason] of failed) {
    errors.push({ dir: parsed.get(id)!.dir, id, error: reason })
  }

  // 4) Kahn 拓扑（存活子图，环已剔除，必有完整序）；id 排序保证确定性
  const alive = new Map([...parsed].filter(([id]) => !failed.has(id)))
  const indeg = new Map<string, number>()
  const dependents = new Map<string, string[]>()
  for (const [id, entry] of alive) {
    const deps = Object.keys(entry.manifest.dependencies ?? {}).filter((d) => alive.has(d))
    indeg.set(id, deps.length)
    for (const d of deps) {
      if (!dependents.has(d)) dependents.set(d, [])
      dependents.get(d)!.push(id)
    }
  }
  let ready = [...alive.keys()].filter((id) => indeg.get(id) === 0).sort()
  const order: PluginPlanEntry[] = []
  while (ready.length > 0) {
    const id = ready.shift()!
    order.push(alive.get(id)!)
    const freed: string[] = []
    for (const dep of dependents.get(id) ?? []) {
      const n = indeg.get(dep)! - 1
      indeg.set(dep, n)
      if (n === 0) freed.push(dep)
    }
    if (freed.length > 0) ready = [...ready, ...freed].sort()
  }

  return { read, order, errors }
}

/** 加载全部插件（按依赖拓扑序）并注册进 registry；返回成功加载的插件列表 */
export function loadPluginsIntoRegistry(
  registry: ToolRegistry,
  dataDir: string,
): LoadedPlugin[] {
  const loaded: LoadedPlugin[] = []
  const plan = planPluginLoad(dataDir)
  for (const e of plan.errors) {
    // stderr：避免污染 MCP stdio 的 stdout（JSON-RPC 通道）
    console.error(`[agent-tools] 插件 ${e.id ?? path.basename(e.dir)} 不可加载: ${e.error}`)
  }
  // 热重载失效链：重建时清整个插件根目录的 require 缓存——仅按单插件目录清理时，
  // 依赖方若在入口顶层 require 了被依赖方的模块，被依赖方热重载后依赖方仍持有旧实例。
  // 全量重执行入口的开销可忽略（插件数量小），换来一致的重载语义。
  clearPluginCache(pluginRoot(dataDir), createRequire(path.join(pluginRoot(dataDir), 'anchor.js')))
  for (const entry of plan.order) {
    try {
      const plugin = loadPlugin(entry.dir)
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
          tier: 'extended', // 插件工具默认为扩展层，按需加载
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
      console.error(`[agent-tools] 加载插件失败 ${path.basename(entry.dir)}:`, e)
    }
  }
  return loaded
}
