import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import {
  discoverPluginDirs,
  loadPlugin,
  parseDependencies,
  planPluginLoad,
  pluginRoot,
  readManifest,
} from '../../core/plugin-loader'
import { PLUGIN_API_VERSION } from '../../core/contracts'
import type { PluginManifest } from '../../core/contracts'
import type { ToolRegistry } from '../../core/tool-registry'

// ===================================================================
// 插件生命周期管理（GUI 插件管理页用）。
//   listPlugins    — 列出插件（内置聚合 + 已安装第三方插件，含依赖信息）
//   installPlugin  — 从 .ztool 包安装（安全解压，防 zip-slip）
//   uninstallPlugin— 删除插件目录（内置插件拒绝删除；有依赖方时默认阻止，可强制）
// 安装/卸载后由 plugin-watcher 监听目录变化自动热重载。
// ===================================================================

export interface PluginToolInfo {
  key: string
  name: string
  label: string
}

export interface PluginInfo {
  id: string
  name: string
  version: string
  author?: string
  description?: string
  tools: PluginToolInfo[]
  dir: string
  /** 内置插件（随应用分发，不可卸载） */
  builtin: boolean
  /** 依赖声明（插件 id → semver 范围） */
  dependencies?: Record<string, string>
  /** 依赖此插件的其他插件 id（卸载保护提示用） */
  dependents?: string[]
  /** 插件加载失败时的错误信息（仅展示，不阻断列表） */
  error?: string
}

/** 内置工具聚合条目 id（registry 中 kind='builtin' 的工具聚合展示） */
const BUILTIN_GROUP_ID = '__builtin__'

export function listPlugins(dataDir: string, registry?: ToolRegistry): PluginInfo[] {
  const out: PluginInfo[] = []

  // 内置工具聚合：registry 中的内置工具作为一个「内置插件」展示（不可卸载）
  if (registry) {
    const builtinTools = registry
      .all()
      .filter((t) => t.kind === 'builtin')
      .map((t) => ({ key: t.key, name: t.name, label: t.label }))
    if (builtinTools.length > 0) {
      out.push({
        id: BUILTIN_GROUP_ID,
        name: '待办任务',
        version: '',
        description: '内置任务工具，随应用提供',
        tools: builtinTools,
        dir: '',
        builtin: true,
      })
    }
  }

  // 已安装第三方/内置文件插件（agent-tools/）：依赖解析 + 加载
  const plan = planPluginLoad(dataDir)

  // 依赖方反查：所有清单可读插件（含被拒载者）声明的依赖 → 被依赖者 id 列表
  const dependentsMap = new Map<string, string[]>()
  for (const entry of plan.read) {
    for (const depId of Object.keys(entry.manifest.dependencies ?? {})) {
      const list = dependentsMap.get(depId) ?? []
      list.push(entry.manifest.id)
      dependentsMap.set(depId, list)
    }
  }
  const planErrorById = new Map(plan.errors.filter((e) => e.id).map((e) => [e.id, e.error]))

  for (const { dir, manifest } of plan.read) {
    const dependents = dependentsMap.get(manifest.id)
    try {
      // 用 loadPlugin 拿到入口导出的真实工具列表（readManifest 的 tools 为空）
      const plugin = loadPlugin(dir)
      const info = toPluginInfo(dir, plugin.manifest)
      // 平台依赖拒载原因优先于入口自身错误展示（契约层问题更可操作）
      const planError = planErrorById.get(manifest.id)
      out.push({ ...info, error: planError, dependents })
    } catch (e) {
      // 加载失败时仍展示基本信息 + 错误原因
      const loadError = e instanceof Error ? e.message : String(e)
      out.push({
        ...toPluginInfo(dir, manifest),
        error: planErrorById.get(manifest.id) ?? loadError,
        dependents,
      })
    }
  }
  for (const e of plan.errors) {
    if (!e.id) console.error(`[plugins] 读取清单失败 ${path.basename(e.dir)}: ${e.error}`)
  }
  return out
}

function toPluginInfo(dir: string, manifest: PluginManifest): PluginInfo {
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    author: manifest.author,
    description: manifest.description,
    tools: (manifest.tools ?? []).map((t) => ({
      key: t.key,
      name: t.name,
      label: t.label ?? t.name,
    })),
    dependencies: manifest.dependencies,
    dir,
    builtin: manifest.builtin === true,
  }
}

/** 校验清单：apiVersion 匹配 + id 合法（防路径穿越）+ dependencies 格式 */
export function validateManifest(raw: string, origin: string): PluginManifest {
  const parsed = JSON.parse(raw) as Partial<PluginManifest>
  if (!parsed.id || typeof parsed.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(parsed.id)) {
    throw new Error(`插件 id 非法（${origin}）：仅允许字母/数字/下划线/连字符`)
  }
  if (parsed.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`插件 ${parsed.id} 的 apiVersion=${parsed.apiVersion}，要求 ${PLUGIN_API_VERSION}`)
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
  }
}

/** 安全解压 .ztool（zip）：逐 entry 拒绝 `..` 与绝对路径，仅落到目标目录 */
export function extractPluginZip(zipPath: string, targetDir: string): PluginManifest {
  const zip = new AdmZip(zipPath)
  const entries = zip.getEntries()

  // 先整体校验 entry 名，任何越界立即拒绝（不读数据，防 zip-slip）
  for (const entry of entries) {
    const rel = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!rel || rel.endsWith('/')) continue
    if (rel.split('/').some((seg) => seg === '..')) {
      throw new Error(`插件包含非法路径: ${entry.entryName}`)
    }
  }

  const manifestEntry = entries.find((e) => e.entryName === 'ztool.json')
  if (!manifestEntry) throw new Error(`${zipPath} 内缺少 ztool.json`)

  const manifest = validateManifest(manifestEntry.getData().toString('utf-8'), zipPath)
  const base = path.resolve(pluginRoot(targetDir), manifest.id)
  if (!base.startsWith(path.resolve(pluginRoot(targetDir)))) {
    throw new Error(`插件安装路径越界: ${manifest.id}`)
  }

  fs.mkdirSync(base, { recursive: true })
  for (const entry of entries) {
    const rel = entry.entryName.replace(/\\/g, '/').replace(/^\/+/, '')
    if (!rel || rel.endsWith('/')) continue
    const dest = path.resolve(base, rel)
    if (!dest.startsWith(base + path.sep) && dest !== base) {
      throw new Error(`插件包含越界路径: ${entry.entryName}`)
    }
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.writeFileSync(dest, entry.getData())
  }
  return manifest
}

/** 扫描全部插件清单，返回声明依赖 id 的其他插件 id 列表 */
function findDependents(dataDir: string, id: string): string[] {
  const out: string[] = []
  for (const dir of discoverPluginDirs(dataDir)) {
    try {
      const manifest = readManifest(dir)
      if (manifest.id !== id && manifest.dependencies?.[id]) out.push(manifest.id)
    } catch {
      /* 清单损坏的插件不参与依赖判断 */
    }
  }
  return out
}

/** 卸载：删除插件目录；内置插件拒绝删除；有依赖方时默认拒绝（force 强制）。返回是否确实删除了 */
export function uninstallPlugin(dataDir: string, id: string, opts?: { force?: boolean }): boolean {
  if (id === BUILTIN_GROUP_ID) {
    throw new Error('内置任务工具不可卸载')
  }
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) {
    throw new Error(`插件 id 非法: ${id}`)
  }
  const dir = path.join(pluginRoot(dataDir), id)
  const resolved = path.resolve(dir)
  if (!resolved.startsWith(path.resolve(pluginRoot(dataDir)))) {
    throw new Error(`插件路径越界: ${id}`)
  }
  if (!fs.existsSync(dir)) return false
  // 内置文件插件（ztool.json 标 builtin:true）不可卸载
  const manifestFile = path.join(dir, 'ztool.json')
  if (fs.existsSync(manifestFile)) {
    try {
      const manifest = readManifest(dir)
      if (manifest.builtin === true) {
        throw new Error(`内置插件 ${manifest.name} 不可卸载`)
      }
    } catch (e) {
      // readManifest 失败时按清单损坏处理，但若明确 builtin 则复用报错
      if (e instanceof Error && /不可卸载/.test(e.message)) throw e
    }
  }
  // 依赖方检查：其他插件声明依赖此 id 时默认阻止；确认后可强制（依赖方随后报缺依赖）
  if (opts?.force !== true) {
    const dependents = findDependents(dataDir, id)
    if (dependents.length > 0) {
      throw new Error(`无法卸载：${dependents.join('、')} 依赖此插件；确认后可强制卸载`)
    }
  }
  fs.rmSync(dir, { recursive: true, force: true })
  return true
}