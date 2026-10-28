import { app } from 'electron'
import { spawn, type ChildProcess } from 'child_process'
import { delimiter, join, relative, sep } from 'path'
import {
  cpSync,
  existsSync,
  mkdirSync,
  promises as fsp,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs'
import { execFileSync } from 'child_process'
import { createServer, type AddressInfo } from 'net'
import { minVersion, rcompare, satisfies, valid as validSemver } from 'semver'
import {
  checkPackageInstallIntegrity,
  checkPluginAgainstTarget,
  checkPluginCompatibility,
  classifyPluginSpec,
  collectPatchEntries,
  collectPatchEntryIds,
  collectPluginClosure,
  computeBundleSync,
  findNewDependencies,
  hasQuarantineBlock,
  isBundleAnchorResolvable,
  isDshPluginManifest,
  isValidPluginSpec,
  matchCulprit,
  packageNameFromEntry,
  parseBootFailure,
  parseBootFailures,
  parseIgnoredBuildPackages,
  parseInstalledPlugins,
  parseMissingPluginPackages,
  parseQuarantineLedger,
  removeQuarantineBlocks,
  renderQuarantineBlock,
  sameMinorVersion,
  selectHighestCompatibleVersion,
  shouldRebuildWebProfile,
  simulatePluginsAgainstTarget,
  summarizePluginStatuses,
  type BootFailure,
  type DshPluginInfo,
  type PackageIntegrityResult,
  type PluginClosureNode,
  type PluginCompatStatus,
  type PluginManifestEntry,
  type PluginUpgradeImpact,
  type QuarantineRecord,
} from './plugin-spec'
import { applyDshAppBootRequirePatch, applyWin32ProcessNoWindowPatch } from './vendor-patch'
import { resolveSidebarShellOverride } from './shell-resolve'
import { expandPathVars, mergePathDirs } from './path-env'
import {
  ADDON_HOST_VERSION,
  buildRuntimePackageJson,
  hostRuntimeInfo,
  isAddonRangeCompatible,
  pickRecommendedRuntime,
  runtimeVersionDirName,
  type RuntimeVersionMeta,
} from './runtime-policy'
import {
  activeStatePath,
  migrateLegacyRuntime,
  readRuntimeState as readRuntimeStateFromDisk,
  writeRuntimeState as writeRuntimeStateToDisk,
  type RuntimeState,
  type RuntimeStateEntry,
} from './runtime-store'
import { getAllSettings, setSetting } from '../../main/database/settings-dao'
import { appendAppLog } from '../../core/app-log'

// ===================================================================
// DshManager：主进程内管理 DSH Web UI 子进程的生命周期。
//
// 关键架构（见 docs/dsh-integration-plan.md、AGENTS.md #7）：
//   - DSH 官方是 Web UI：`dsh web` 在 loopback 起本地 HTTP 服务（默认 127.0.0.1:3080）。
//   - 服务端以 ELECTRON_RUN_AS_NODE spawn 运行（process.execPath + --expose-internals），
//     直接加载 @deepseek-ai/dsh 的 bin.js；不随包分发独立 node.exe。
//   - 不能用 utilityProcess.fork：打包版 Electron 会静默吞掉 --expose-internals 的效果。
//   - 渲染层用 <webview> 加载 http://127.0.0.1:<port> 展示官方 Web UI。
//   - 端口由主进程预占空闲 loopback 端口后以 --port 传入，spawn 后立即 HTTP 探测。
//
// 就绪判定：对预留端口做 HTTP 探测确认真正可服务。
// 状态变化通过 onChange 推给模块层（ctx.send → 'dsh:statusChanged'）。
// ===================================================================

export interface DshStatus {
  running: boolean
  port?: number
  /** 完整 Web UI 入口（含 ?token=；0.1.5 起 DSH web server 默认需要 token 鉴权） */
  url?: string
}

export interface DshReadyInfo {
  ready: boolean
  reason?: string
}

type StatusListener = (status: DshStatus) => void
type PluginLogListener = (chunk: string) => void

export interface DshPluginDone {
  action: 'add' | 'remove'
  name: string
  ok: boolean
  error?: string
}

type PluginDoneListener = (result: DshPluginDone) => void

export interface DshUpgradeDone {
  ok: boolean
  from: string | null
  to: string
  /** 失败时是否已回滚（回到升级前运行时） */
  reverted?: boolean
  error?: string
}

type UpgradeLogListener = (chunk: string) => void
type UpgradeDoneListener = (result: DshUpgradeDone) => void

export interface DshRuntimeUpdateInfo {
  ok: boolean
  /** 当前运行中的 DSH 运行时版本 */
  current: string | null
  /** 是否存在用户升级覆盖层（<userData>/dsh-runtime） */
  hasUserOverride: boolean
  /** 覆盖层元数据（版本/来源/时间）；无覆盖层为 null */
  meta: RuntimeMeta | null
  /** npm dist-tags；网络不可达为 null */
  distTags?: Record<string, string> | null
  /** latest 尝鲜目标（distTags.latest ?? distTags.next） */
  latest?: string | null
  /** 推荐升级目标：锁定版本 > 同 minor 最高未忽略版本 > latest */
  recommended?: string | null
  /** 版本目录（含标签、发布日期、addon 声明、宿主兼容性） */
  versions?: RuntimeVersionMeta[]
  /** 用户锁定的版本（settings dsh.runtime.pin） */
  pinned?: string | null
  /** 用户忽略的版本 */
  ignored?: string[]
  /** 上一用户版本（可一键回退） */
  previous?: { version: string; at: number } | null
  /** 宿主 Electron/Node 与 app-boot 兼容补丁标记 */
  host?: { electron: string | null; node: string; appBootPatchRequired: boolean }
  error?: string
}

export interface RuntimeMeta {
  version: string
  source: 'user'
  at: number
  vendorPatchApplied: boolean
}

export interface DshRuntimeNotes {
  ok: boolean
  version: string
  title: string
  body: string
  url: string
  source: 'github' | 'npm' | 'error'
  publishedAt?: number | null
  error?: string
}

/** 声明层不兼容项（按顶层插件聚合；普通 JS 库不参与判定） */
export interface PluginTargetIssue {
  package: string
  version: string
  /** 直接/传递插件的顶层来源（可操作对象） */
  root: string
  parent: string | null
  /** 硬阻断：缺少目标 peer / peer 版本不符 / DSH 范围不满足 */
  errors: string[]
  /** 不阻断：跨 minor 的开放区间/未声明，由实机预演裁决 */
  warnings: string[]
  /** 聚合时涉及的子插件包名 */
  children?: string[]
}

/** 实机预演失败项 */
export interface ProbeFailure {
  entryId?: string
  name?: string
  package?: string
  reason: string
}

/** 推荐升级版本（顶层插件；传递插件归因到 root） */
export interface UpgradeRecommendation {
  package: string
  current: string | null
  recommended: string | null
  kind: 'direct' | 'transitive'
  /** kind=transitive 时失败的子插件 */
  children?: string[]
  /** 推荐组合是否已通过目标运行时实机验证 */
  verified?: boolean
  note?: string
}

export interface DshPreflightResult {
  ok: boolean
  from: string | null
  to: string
  crossMinor: boolean
  declaredIssues: PluginTargetIssue[]
  probeOk: boolean
  probeError?: string
  probeFailures: ProbeFailure[]
  recommendations: UpgradeRecommendation[]
  integrity: PackageIntegrityResult[]
  error?: string
}

interface ResolvedPaths {
  base: string
  dshBin: string
  home: string
}

/**
 * 安全递归删除：先逐条 unlink 符号链接/junction，再整树删除（异步，避免阻塞主进程）。
 * Windows 上 Electron 的 fs.rmSync(recursive) 会穿透 junction 删除目标内容
 * （系统 node 24.4+ 已修、Electron 未修，见 AGENTS.md dev 陷阱），统一用此函数。
 */
async function safeRmAsync(dir: string): Promise<void> {
  try {
    for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      try {
        if ((await fsp.lstat(p)).isSymbolicLink()) {
          await fsp.unlink(p)
          continue
        }
      } catch {
        continue
      }
      if (e.isDirectory()) await safeRmAsync(p)
    }
  } catch {
    /* 目录不存在/不可读：交给下面的 rm 兜底 */
  }
  await fsp.rm(dir, { recursive: true, force: true })
}

/** 读文本文件；不存在/不可读返回 null */
function readTextSafe(p: string): string | null {
  try {
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  } catch {
    return null
  }
}

/** 启动总超时：端口解析 + HTTP 就绪探测共用（首次重建 web profile 需 pnpm 安装） */
const START_TIMEOUT_MS = 60_000
/** 运行时升级探针超时：隔离临时 home 首次初始化 profile 可能较慢 */
const PROBE_RUNTIME_TIMEOUT_MS = 120_000
const PROBE_TIMEOUT_MS = 2_000
const PROBE_INTERVAL_MS = 100
const RUNTIME_PIN_KEY = 'dsh.runtime.pin'
const RUNTIME_IGNORED_KEY = 'dsh.runtime.ignored'

/** 格式化 spawn 的 'error' 事件参数（spawn 失败 / V8 FatalError 诊断信息）。 */
function formatChildError(d: unknown): string {
  if (d instanceof Error) return d.message
  if (typeof d !== 'object' || d === null) return String(d)
  const o = d as { type?: unknown; location?: unknown; report?: unknown }
  const parts: string[] = []
  if (typeof o.type === 'string' && o.type) parts.push(o.type)
  if (typeof o.location === 'string' && o.location) parts.push(o.location)
  if (typeof o.report === 'string' && o.report) parts.push(o.report)
  return parts.join('\n') || '未知错误'
}

/**
 * 整树终止进程（Windows）：spawn 的 kill() 只杀直接子进程，
 * DSH 派生的 node-pty pwsh 孙进程会孤儿化，必须 taskkill /T 连带整棵树（已实测）。
 */
function killTree(pid: number | undefined): void {
  if (pid === undefined) return
  try {
    execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
  } catch {
    /* 已退出或无权 */
  }
}

let cachedFullPath: string | null = null
/**
 * 从注册表读取系统+用户 PATH 并展开 %VAR%（进程内缓存）。
 * 应用可能被裁剪 PATH 的环境启动（opencode 桌面子进程不含系统/用户 PATH），
 * 导致 DSH server 缺少 git / vfox 等工具目录；这里兜底补全。
 */
function fullUserPath(): string {
  if (cachedFullPath !== null) return cachedFullPath
  const parts: string[] = []
  const keys = [
    'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment',
    'HKCU\\Environment',
  ]
  for (const key of keys) {
    try {
      const r = execFileSync('reg', ['query', key, '/v', 'Path'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      })
      const m = r.match(/\bPath\s+REG_(?:EXPAND_)?SZ\s+(.+)/i)
      if (m) parts.push(m[1])
    } catch {
      /* reg 不可用则跳过该段 */
    }
  }
  cachedFullPath = expandPathVars(
    parts.join(';'),
    process.env as Record<string, string | undefined>,
  )
  return cachedFullPath
}

class DshManager {
  private static _inst: DshManager | null = null
  static getInstance(): DshManager {
    if (!this._inst) this._inst = new DshManager()
    return this._inst
  }

  private child: ChildProcess | null = null
  private port: number | null = null
  /** DSH stdout 打印的完整入口 URL（`dsh web: http://…/?token=…`），随 server 生命周期 */
  private webUrl: string | null = null
  /** webUrl 是否已随状态推送过（stdout 解析补发用，避免重复） */
  private webUrlEmitted = false
  private dataDir = ''
  private listeners = new Set<StatusListener>()
  private pluginLogListeners = new Set<PluginLogListener>()
  private pluginDoneListeners = new Set<PluginDoneListener>()
  private upgradeLogListeners = new Set<UpgradeLogListener>()
  private upgradeDoneListeners = new Set<UpgradeDoneListener>()
  /** 运行时升级过程中正在跑的子进程（pnpm add / 启动探针），stop() 需整树终止 */
  private upgradePending: ChildProcess | null = null
  /** 升级进行中（含无子进程阶段，如 registry 查询）；与插件操作互斥 */
  private upgradeActive = false
  private pluginPending: {
    child: ChildProcess
    action: 'add' | 'remove'
    name: string
    resolve: (r: { ok: boolean; error?: string }) => void
  } | null = null
  /** 最近一次通过的升级预演（升级前置条件；profile 变更即失效） */
  private lastPreflight: { to: string; fingerprint: string } | null = null

  init(opts: { dataDir: string }): void {
    this.dataDir = opts.dataDir
    this.migrateLegacyRuntime()
    const userDir = this.activeUserRuntimeDir()
    if (userDir) this.applyRuntimePatches(userDir)
    this.healProfile()
  }

  /** 订阅状态变化（启动/停止/退出），返回取消订阅函数 */
  onChange(cb: StatusListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  onPluginLog(cb: PluginLogListener): () => void {
    this.pluginLogListeners.add(cb)
    return () => this.pluginLogListeners.delete(cb)
  }

  onPluginDone(cb: PluginDoneListener): () => void {
    this.pluginDoneListeners.add(cb)
    return () => this.pluginDoneListeners.delete(cb)
  }

  onUpgradeLog(cb: UpgradeLogListener): () => void {
    this.upgradeLogListeners.add(cb)
    return () => this.upgradeLogListeners.delete(cb)
  }

  onUpgradeDone(cb: UpgradeDoneListener): () => void {
    this.upgradeDoneListeners.add(cb)
    return () => this.upgradeDoneListeners.delete(cb)
  }

  private emit(): void {
    const s = this.status()
    for (const l of this.listeners) {
      try {
        l(s)
      } catch {
        /* 监听器异常不影响主流程 */
      }
    }
  }

  private emitPluginLog(chunk: string): void {
    for (const l of this.pluginLogListeners) {
      try {
        l(chunk)
      } catch {
        /* noop */
      }
    }
  }

  /** 落盘 + 广播应用日志（core/app-log）；dataDir 未初始化时跳过 */
  private log(level: 'info' | 'warn' | 'error', message: string, detail?: string): void {
    if (!this.dataDir) return
    appendAppLog(this.dataDir, { level, source: 'dsh', message, detail })
  }

  private emitPluginDone(result: DshPluginDone): void {
    for (const l of this.pluginDoneListeners) {
      try {
        l(result)
      } catch {
        /* noop */
      }
    }
  }

  private emitUpgradeLog(chunk: string): void {
    for (const l of this.upgradeLogListeners) {
      try {
        l(chunk)
      } catch {
        /* noop */
      }
    }
  }

  private emitUpgradeDone(result: DshUpgradeDone): void {
    for (const l of this.upgradeDoneListeners) {
      try {
        l(result)
      } catch {
        /* noop */
      }
    }
  }

  /**
   * 内置（随包/开发仓库）DSH 运行时根：含 node_modules/@deepseek-ai/dsh 与 bin/pnpm.exe。
   * 打包后固定为 resourcesPath/dsh；dev 下 app.getAppPath()/cwd 已是仓库根直接命中；
   * __dirname 在构建产物里（out/main/...）向上数层查找 resources/dsh。
   * 不包含用户升级覆盖层（见 findBase）。
   */
  private bundledBase(): string {
    if (app.isPackaged) return join(process.resourcesPath, 'dsh')

    const candidates = [
      join(app.getAppPath(), 'resources', 'dsh'),
      join(process.cwd(), 'resources', 'dsh'),
    ]
    let cur = __dirname
    for (let i = 0; i < 6 && cur && cur !== join(cur, '..'); i++) {
      candidates.push(join(cur, 'resources', 'dsh'))
      cur = join(cur, '..')
    }
    for (const c of candidates) {
      if (
        existsSync(join(c, 'bin', 'pnpm.exe')) &&
        existsSync(join(c, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      ) {
        return c
      }
    }
    for (const c of candidates) {
      if (existsSync(join(c, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) return c
    }
    return candidates[0]
  }

  private hasDshBin(dir: string): boolean {
    return existsSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  }

  /** 运行期 vendor patch（win32 黑窗 + Electron 42 的 app-boot internal require 补丁） */
  private applyRuntimePatches(baseDir: string): {
    win32: ReturnType<typeof applyWin32ProcessNoWindowPatch>
    appBoot: ReturnType<typeof applyDshAppBootRequirePatch>
  } {
    return {
      win32: applyWin32ProcessNoWindowPatch(baseDir),
      appBoot: applyDshAppBootRequirePatch(baseDir),
    }
  }

  /** 用户运行时根目录（<userData>/dsh-runtime）；版本目录在 versions/ 下 */
  private userRuntimeDir(): string {
    return join(app.getPath('userData'), 'dsh-runtime')
  }

  private userVersionsDir(): string {
    return join(this.userRuntimeDir(), 'versions')
  }

  private activeStatePath(): string {
    return activeStatePath(this.userRuntimeDir())
  }

  private readRuntimeState(): RuntimeState | null {
    return readRuntimeStateFromDisk(this.userRuntimeDir(), (dir) => this.hasDshBin(dir))
  }

  private writeRuntimeState(state: RuntimeState): void {
    writeRuntimeStateToDisk(this.userRuntimeDir(), state)
  }

  /**
   * 旧版用户运行时只有根目录 node_modules。启动/升级前将其迁入 versions/<v>
   * 并写入 active.json，后续版本切换才能保留上一版本。
   */
  private migrateLegacyRuntime(): void {
    try {
      const migrated = migrateLegacyRuntime(this.userRuntimeDir(), (dir) => this.hasDshBin(dir))
      if (migrated) {
        this.cachedVersion = undefined
        console.log(
          `[dsh] 已迁移用户运行时到版本目录：${join(this.userRuntimeDir(), migrated.dir)}`,
        )
      }
    } catch (e) {
      this.log('warn', '旧用户运行时迁移失败，继续使用旧布局', String(e))
    }
  }

  /** 当前生效的用户运行时目录；没有用户覆盖层时为 null */
  private activeUserRuntimeDir(): string | null {
    const state = this.readRuntimeState()
    if (state) {
      const dir = join(this.userRuntimeDir(), state.dir)
      if (this.hasDshBin(dir)) return dir
    }
    return null
  }

  /**
   * 定位生效的 DSH 运行时根。优先级：
   * 1. DSH_DEV_DIR（显式 dev 覆盖；设置后应用内升级被禁用）
   * 2. 用户升级覆盖层 active.json（或旧单目录布局）
   * 3. 内置 resources/dsh
   * 用户覆盖层让「应用内升级的版本」在应用更新后仍然生效。
   */
  private findBase(): string {
    const env = process.env
    if (env.DSH_DEV_DIR && this.hasDshBin(env.DSH_DEV_DIR)) return env.DSH_DEV_DIR
    const userDir = this.activeUserRuntimeDir()
    if (userDir) return userDir
    return this.bundledBase()
  }

  /** 解析 DSH 运行时路径 */
  private resolvePaths(): ResolvedPaths {
    const env = process.env
    const base = this.findBase()
    const dshBin = join(base, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const home = env.DSH_HOME ? env.DSH_HOME : join(this.dataDir, 'dsh')
    return { base, dshBin, home }
  }

  isReady(): DshReadyInfo {
    const { dshBin } = this.resolvePaths()
    if (!existsSync(dshBin)) {
      // 区分「base 目录存在但 @deepseek-ai 被清空」（DSH home 的 junction 被递归删除
      // 会穿透清空 base，见 AGENTS.md dev 陷阱）与「从未 build 过」，给可操作提示。
      const dshPkgDir = join(join(this.findBase(), 'node_modules', '@deepseek-ai', 'dsh'))
      if (existsSync(dshPkgDir)) {
        return {
          ready: false,
          reason: `本地 DSH 运行时被清空（${dshPkgDir}），可能由递归删除 DSH home 穿透 junction 导致，请运行 npm run build:dsh 恢复`,
        }
      }
      return {
        ready: false,
        reason: `未找到 DSH 入口: ${dshBin}（开发环境请运行 npm run build:dsh）`,
      }
    }
    return { ready: true }
  }

  /** DSH 运行时版本（读取 vendored package.json，缓存；不可用返回 null） */
  version(): string | null {
    const cached = this.cachedVersion
    if (cached !== undefined) return cached
    const { dshBin } = this.resolvePaths()
    if (!existsSync(dshBin)) return null
    try {
      const pkg = JSON.parse(readFileSync(join(dshBin, '..', '..', 'package.json'), 'utf8'))
      return (this.cachedVersion = typeof pkg.version === 'string' ? pkg.version : null)
    } catch {
      return (this.cachedVersion = null)
    }
  }

  private cachedVersion: string | null | undefined

  /**
   * 启动自愈（应用启动时执行，先于任何用户操作）：
   * 1. store 清理：pnpm 大版本升级（v10→v11）后旧 store 链接的 node_modules 不兼容，
   *    读取 node_modules/.modules.yaml 的 packageManager 主版本，不同则清理
   *    （package.json 保留，下次装插件时 pnpm 自动重建）。
   * 2. bundle 对账：pnpm 失败导致 reconcile 未执行时，依赖已记录但 bundles 缺失，
   *    双向同步补账（见 computeBundleSync）。
   */
  private healProfile(): void {
    const nmDir = join(this.profileDir(), 'node_modules')
    const modulesYaml = join(nmDir, '.modules.yaml')
    if (existsSync(modulesYaml)) {
      try {
        const content = readFileSync(modulesYaml, 'utf8')
        // packageManager: pnpm@10.12.1 → 提取主版本号
        const match = content.match(/packageManager:\s*pnpm@(\d+)\./)
        if (match && match[1] !== '11') {
          rmSync(nmDir, { recursive: true, force: true })
          console.log(`[dsh] 已清理不兼容的 node_modules（pnpm v${match[1]}→v11 store 格式升级）`)
        }
      } catch {
        /* heal 失败不影响启动 */
      }
    }
    this.reconcileBundles()
    this.healProfileBuildPolicy()
  }

  /**
   * 固化 web profile 的 pnpm 构建策略（根治 pnpm 11 的 build-scripts 拦截门）：
   * - dangerouslyAllowAllBuilds: true：所有依赖的 preinstall/install/postinstall 自动执行，
   *   不再报 ERR_PNPM_IGNORED_BUILDS，也不再被写入 allowBuilds 的占位符污染。
   * - minimumReleaseAge: 0：关闭 24h 发布龄供应链门槛（pnpm 11 默认 1440 分钟，会拒绝刚发布的插件）。
   * 幂等：保留其它键，仅移除 allowBuilds 块并追加这两个策略键。
   */
  private healProfileBuildPolicy(): void {
    const yamlPath = join(this.profileDir(), 'pnpm-workspace.yaml')
    if (!existsSync(yamlPath)) return
    try {
      const raw = readFileSync(yamlPath, 'utf8')
      const kept: string[] = []
      let inAllowBuilds = false
      for (const line of raw.split(/\r?\n/)) {
        const t = line.trim()
        if (/^allowBuilds:/.test(t)) {
          inAllowBuilds = true
          continue
        }
        if (inAllowBuilds) {
          if (t && !/^[\t ]/.test(line)) inAllowBuilds = false
          else continue
        }
        if (/^dangerouslyAllowAllBuilds:|^minimumReleaseAge:/.test(t)) continue
        kept.push(line)
      }
      const base = kept.join('\n').trim()
      const next = `${base}${base ? '\n' : ''}dangerouslyAllowAllBuilds: true\nminimumReleaseAge: 0\n`
      if (raw.trim() !== next.trim()) {
        writeFileSync(yamlPath, next)
        console.log(`[dsh] 已固化 pnpm 构建策略（dangerouslyAllowAllBuilds）: ${yamlPath}`)
      }
    } catch {
      /* heal 失败不影响主流程 */
    }
  }

  /**
   * 与 DSH resolveBundleDir 同语义：两个锚点任一可解析出 dsh.bundle 声明即为合法层。
   * 除声明外还要求声明的 patch 文件真实存在（isBundleAnchorResolvable）——
   * DSH loadOverlayPatches 对缺失的 overlay 文件硬抛错，声明在而文件缺失的
   * bundle 会让启动必崩（dsh-opencode-zen 事故），此处剔除后由 reconcileBundles
   * 写回 bundles，插件保留为普通依赖（列表显示「未生效」）。
   */
  private isResolvableBundle(name: string): boolean {
    const anchors = [
      join(this.profileDir(), 'node_modules', name),
      join(this.resolvePaths().base, 'node_modules', name),
    ]
    const readText = (p: string): string | null => {
      try {
        return existsSync(p) ? readFileSync(p, 'utf8') : null
      } catch {
        return null
      }
    }
    return anchors.some((dir) => isBundleAnchorResolvable(dir, readText, existsSync))
  }

  /**
   * 双向对齐 dependencies 与 dsh.profile.bundles（根治「pnpm 失败导致 reconcile
   * 未执行」的半成品状态）。幂等：无差异时不写盘。
   */
  private reconcileBundles(): void {
    const pkgPath = join(this.profileDir(), 'package.json')
    if (!existsSync(pkgPath)) return
    try {
      const manifest = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        dsh?: { profile?: { bundles?: string[] } }
      }
      const deps = manifest.dependencies ?? {}
      if (Object.keys(deps).length === 0) return
      const { bundles, changed } = computeBundleSync(
        manifest.dsh?.profile?.bundles ?? [],
        deps,
        (name) => this.isResolvableBundle(name),
      )
      if (!changed) return
      manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
      writeFileSync(pkgPath, JSON.stringify(manifest, null, 2))
      console.log(`[dsh] bundles 已自愈同步: ${bundles.join(', ')}`)
    } catch {
      /* 对账失败不影响主流程 */
    }
  }

  /**
   * 构建 DSH 子进程环境：继承应用环境但清理 Electron 注入的运行期变量
   * （NODE_OPTIONS / ELECTRON_RUN_AS_NODE / ELECTRON_*），避免污染 run-as-node 子进程
   * 里的纯 Node 运行时；再设置 DSH 所需项。extra 由调用方按用途追加（server/插件共用）。
   */
  private buildEnv(
    home: string,
    extra: Record<string, string> = {},
    baseOverride?: string,
  ): Record<string, string> {
    const base = baseOverride ?? this.resolvePaths().base
    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...extra }
    delete env.NODE_OPTIONS
    delete env.ELECTRON_RUN_AS_NODE
    for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_')) delete env[k]
    env.DSH_HOME = home
    env.NODE_PATH = join(base, 'node_modules')
    // pnpm 生命周期脚本（node buildcheck.js / node-gyp rebuild 等）需要 PATH 上有 `node`。
    // 由 electron-as-node 垫片充当（零额外二进制、ABI 与 DSH 运行时同为 Electron Node、GUI 子系统不开控制台窗口）。
    // node-bin 前置、bin（pnpm.exe）次之；末尾合并系统+用户注册表 PATH，补全被启动上下文裁剪的工具目录
    // （git / vfox 等，否则终端 vfox 报错、git 面板认不出仓库——已实测 opencode 子进程 PATH 缺这两者）。
    const nodeBin = this.ensureNodeShim(home)
    const merged = mergePathDirs(env.PATH ?? '', fullUserPath())
    env.PATH = `${nodeBin}${delimiter}${join(base, 'bin')}${delimiter}${merged}`
    // 兼容性加固：dsh-better-sidebar 的 defaultShell 会命中 Microsoft Store 的
    // WindowsApps pwsh 别名桩（0 字节 reparse point），node-pty 无法 spawn，
    // 终端报 "File not found"。此处把它解析为确定可用的 shell。
    // 用户显式 config.shell / 已设置 DSH_SIDEBAR_SHELL 优先级更高，不受影响。
    if (!(env.DSH_SIDEBAR_SHELL && env.DSH_SIDEBAR_SHELL.trim())) {
      const sidebarShell = resolveSidebarShellOverride()
      if (sidebarShell) env.DSH_SIDEBAR_SHELL = sidebarShell
    }
    return env
  }

  /**
   * 确保 `node` 垫片存在：在 DSH home 下生成 node.cmd，把 `node` 解析到应用自身
   * （process.execPath），以 ELECTRON_RUN_AS_NODE 模式充当纯 Node 运行。幂等：
   * execPath 变化（dev/打包切换）时自动重写。
   */
  private ensureNodeShim(home: string): string {
    const dir = join(home, 'node-bin')
    mkdirSync(dir, { recursive: true })
    const shim = join(dir, 'node.cmd')
    const content = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath.replace(/"/g, '""')}" %*\r\n`
    try {
      if (readFileSync(shim, 'utf8') !== content) writeFileSync(shim, content)
    } catch {
      writeFileSync(shim, content) // 首次创建或文件损坏
    }
    return dir
  }

  /** 主进程预占一个空闲 loopback 端口（net 层完成，避免 stdout 解析竞态） */
  private async reservePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
      const srv = createServer()
      srv.unref()
      srv.on('error', reject)
      srv.listen(0, '127.0.0.1', () => {
        const port = (srv.address() as AddressInfo).port
        srv.close(() => resolve(port))
      })
    })
  }

  /** DSH server PID 锁文件（放在 home 里，随数据目录迁移） */
  private pidLockFile(): string {
    return join(this.resolvePaths().home, 'dsh-server.pid')
  }

  /**
   * 启动前清理上次会话残留的 DSH server。应用被强制退出（crash/强杀）时，
   * 子进程可能孤儿化并继续持有 DSH 内部锁（如 dsh-client-ui-task-board 的
   * ledger lock），新实例启动会报 "already owned by process <pid>" 而失败。
   * 读取锁文件里的 pid，进程仍存活则整树终止。
   */
  private cleanupStaleServer(): void {
    let pid: number
    try {
      pid = Number(readFileSync(this.pidLockFile(), 'utf8').trim())
    } catch {
      return // 无锁 / 不可读
    }
    if (!Number.isInteger(pid) || pid <= 0) return
    try {
      process.kill(pid, 0) // 探活：不存在会抛 ESRCH
    } catch {
      return // 进程已退出，无需清理
    }
    try {
      execFileSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore',
        windowsHide: true,
      })
      console.warn(`[dsh] 已清理上次会话残留的 DSH server (pid ${pid})`)
      this.log('warn', `已清理上次会话残留的 DSH server (pid ${pid})`)
    } catch {
      /* 已退出或无权 */
    }
  }

  /** 写入 DSH server PID 锁（仅本实例 spawn 出的 server 才写） */
  private writePidLock(pid: number): void {
    try {
      writeFileSync(this.pidLockFile(), String(pid))
    } catch {
      /* 锁写入失败不影响运行 */
    }
  }
  private clearPidLock(pid: number): void {
    try {
      if (readFileSync(this.pidLockFile(), 'utf8').trim() === String(pid)) {
        rmSync(this.pidLockFile(), { force: true })
      }
    } catch {
      /* noop */
    }
  }

  /** HTTP 探测：能建立连接并返回响应即视为服务就绪 */
  private async probe(port: number): Promise<boolean> {
    try {
      await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
      return true
    } catch {
      return false
    }
  }

  async start(
    opts?: { apiKey?: string; model?: string },
    repaired = false,
    portRetried = false,
    quarantineRounds = 0,
  ): Promise<{ ok: boolean; port?: number; error?: string }> {
    if (this.child) return { ok: true, port: this.port ?? undefined }
    const { dshBin, home } = this.resolvePaths()
    if (!existsSync(dshBin)) {
      const err = `未找到 DSH 入口: ${dshBin}`
      this.log('error', '启动失败', err)
      return { ok: false, error: err }
    }
    try {
      mkdirSync(home, { recursive: true })
      // 清理上次会话残留的 DSH server（应用强退可能留下孤儿进程占用 task-board 等锁）
      this.cleanupStaleServer()
      const apiKey = opts?.apiKey || process.env.DEEPSEEK_API_KEY || ''
      const extra: Record<string, string> = { TERM: 'xterm-256color' }
      if (apiKey) extra.DEEPSEEK_API_KEY = apiKey
      if (opts?.model) extra.DSH_MODEL = opts.model
      const env = this.buildEnv(home, extra)

      // 主进程预占空闲 loopback 端口，spawn 后立即对已知端口探测，免去「等回显」往返
      const port = await this.reservePort()
      this.port = port
      this.webUrl = null
      this.webUrlEmitted = false
      this.emit()
      this.log(
        'info',
        `启动 DSH Web UI（端口 ${port}${repaired ? '，已重建 web profile' : ''}${portRetried ? '，已重试端口' : ''}）`,
      )
      console.log('[dsh] 启动: run-as-node spawn', dshBin, `--profile web --no-open --port ${port}`)
      // 必须使用 ELECTRON_RUN_AS_NODE spawn + --expose-internals：打包版 Electron 的
      // utilityProcess 会静默吞掉 --expose-internals 的效果（子进程 execArgv 可见 flag，
      // 但 node:internal/* 仍不可达），cordis-plugin-loader 因此解析不了 profile 插件，
      // cordis-plugin-hmr 报 "--expose-internals is required for HMR service"，插件树加载
      // 失败、进程退出。run-as-node 模式即纯 Node，flag 正常生效（打包/dev 均已实测）。
      const child = spawn(
        process.execPath,
        ['--expose-internals', dshBin, '--profile', 'web', '--no-open', '--port', String(port)],
        {
          cwd: home,
          env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )
      this.child = child
      // 并行加载：spawn 成功即下发 running+port（此时 webUrl 未到，渲染层可先
      // 挂载容器/占位），token 行到后再补发，不再等探测通过串行。
      this.emit()

      let stderrBuf = ''
      child.on('error', (e) => {
        const detail = formatChildError(e)
        stderrBuf += detail + '\n'
        if (this.child === child) {
          this.child = null
          this.port = null
          this.emit()
        }
        this.log('error', '子进程 spawn 失败', detail)
        console.error('[dsh] 启动失败:', detail)
      })
      child.stdout?.on('data', (d) => {
        // 必须持续消费 stdout，否则管道缓冲写满会阻塞 DSH
        const line = d.toString().trim()
        if (line) {
          console.log('[dsh:stdout]', line)
          this.log('info', line)
        }
        // 0.1.5 起 web server 需要 token：从「dsh web: http://…/?token=…」行提取完整入口。
        // token 行可能晚于 HTTP 探测通过（启动竞态），解析到后立即补发一次状态，
        // 否则渲染层只拿到 port、webview 停在无 token 的 401 白页。
        const m = line.match(/^dsh web:\s+(https?:\/\/\S+)/)
        if (m && !this.webUrl) {
          this.webUrl = m[1]
          if (this.child && !this.webUrlEmitted) {
            this.webUrlEmitted = true
            this.emit()
          }
        }
      })
      child.stderr?.on('data', (d) => {
        const msg = d.toString()
        stderrBuf += msg
        const line = msg.trim()
        if (line) {
          console.error('[dsh:stderr]', line)
          this.log('warn', line)
        }
      })
      child.on('exit', (code) => {
        if (child.pid !== undefined) this.clearPidLock(child.pid)
        if (this.child !== child) return // 已被 stop() 主动接管
        this.child = null
        this.port = null
        this.webUrl = null
        this.emit()
        if (code && code !== 0) {
          this.log(
            'warn',
            `Web UI 进程退出 code=${code}`,
            stderrBuf.trim().split('\n').slice(-60).join('\n'),
          )
          console.warn(`[dsh] Web UI 退出 code=${code}`)
        }
      })

      // 等待 spawn 成功后写 PID 锁并启动超时窗口，避免模块加载前的空转计入。
      await new Promise<void>((resolve) => {
        child.once('spawn', () => {
          if (child.pid !== undefined) this.writePidLock(child.pid)
          resolve()
        })
        child.once('exit', () => resolve())
      })

      // 等待「HTTP 探测通过」，总超时 START_TIMEOUT_MS
      const deadline = Date.now() + START_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (this.child !== child) {
          // 子进程在启动期内意外退出：多半是 web profile 损坏/不兼容
          // （bundles 缺少核心 web 包 @deepseek-ai/dsh-web-app 或 webServer 服务未注册）。
          // 按 manifest 判定是否重建（物理 node_modules 路径在此部署下恒不存在，
          // 按物理路径判断会误删用户插件）：bundles 缺失核心包或 manifest 不可读时重建一次。
          if (!repaired) {
            let manifestRaw: string | null = null
            try {
              manifestRaw = readFileSync(join(home, 'profiles', 'web', 'package.json'), 'utf8')
            } catch {
              /* 不存在/不可读 → 视为需要重建 */
            }
            if (shouldRebuildWebProfile(manifestRaw)) {
              try {
                rmSync(join(home, 'profiles', 'web'), { recursive: true, force: true })
                this.log(
                  'warn',
                  'web profile 缺少核心包 @deepseek-ai/dsh-web-app，已重建并自动重启',
                )
                console.warn(
                  '[dsh] web profile 缺少核心包 @deepseek-ai/dsh-web-app，已重建并自动重启',
                )
              } catch (e) {
                this.log(
                  'error',
                  '清理损坏的 web profile 失败',
                  e instanceof Error ? e.stack : String(e),
                )
                console.error('[dsh] 清理损坏的 web profile 失败:', e)
              }
              return this.start(opts, true)
            }
          }
          // 插件启动崩溃自动隔离（S）：stderr 可归因到具体 entry（非核心包）时，
          // 向 profile cordis.patch.yml 追加 disabled 隔离块并重试（最多 3 轮，逐个摘除肇事插件）。
          // 无法归因（如端口抢占）时落到下面的端口重试/报错路径。
          if (quarantineRounds < 3) {
            const failure = parseBootFailure(stderrBuf)
            const target = failure ? this.resolveQuarantineTarget(failure) : null
            if (target) {
              this.applyQuarantine(target.entryId, target.name, failure!.detail)
              this.log(
                'warn',
                `已自动隔离插件入口 ${target.entryId}${target.name ? `（${target.name}）` : ''}，重试启动`,
              )
              console.warn(`[dsh] 已自动隔离插件入口 ${target.entryId}，重试启动`)
              return this.start(opts, repaired, portRetried, quarantineRounds + 1)
            }
          }
          // 无核心包缺失但启动即退：多为预留端口被抢占（TOCTOU），换新端口重试一次。
          if (!portRetried) {
            this.log(
              'warn',
              '启动后立即退出，换端口重试一次',
              stderrBuf.trim().split('\n').slice(-60).join('\n'),
            )
            console.warn('[dsh] 启动后立即退出，换端口重试一次')
            return this.start(opts, false, true)
          }
          const detail = stderrBuf.trim().split('\n').slice(-12).join('\n')
          this.log(
            'error',
            'DSH Web UI 进程启动后立即退出（可能 profile 配置错误）',
            stderrBuf.trim().split('\n').slice(-60).join('\n'),
          )
          return {
            ok: false,
            error: `DSH Web UI 进程启动后立即退出（可能 profile 配置错误）\n${detail}`,
          }
        }
        if (this.port && (await this.probe(this.port))) {
          // token 行可能晚于探测通过（stdout 竞态）：短暂等待 url 就位再返回，
          // 给渲染层一个带完整入口的状态（最多 5s，超时不阻塞返回）。
          const waitDeadline = Date.now() + 5_000
          while (!this.webUrl && Date.now() < waitDeadline) {
            await new Promise((r) => setTimeout(r, PROBE_INTERVAL_MS))
            if (this.child !== child) break
          }
          this.emit()
          return { ok: true, port: this.port }
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      await this.stop()
      const detail = stderrBuf.trim().split('\n').slice(-12).join('\n')
      const message = `DSH 启动超时${START_TIMEOUT_MS / 1000}s 未就绪）`
      this.log('error', message, stderrBuf.trim().split('\n').slice(-60).join('\n'))
      return {
        ok: false,
        error: `${message}\n${detail}`,
      }
    } catch (e) {
      const message = 'DSH 启动异常'
      const detail = e instanceof Error ? (e.stack ?? e.message) : String(e)
      this.log('error', message, detail)
      await this.stop()
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 停止。spawn 模式下 kill() 只杀直接子进程，这里用 taskkill /T /F 连带终止
   * 整棵进程树（含 node-pty 派生的 pwsh 孙进程，已实测）。应用被强杀时子进程
   * 会孤儿化，由 cleanupStaleServer（PID 锁）在下次启动时兜底清理。
   * 同时终止进行中的插件操作子进程。
   */
  async stop(): Promise<void> {
    const pending = this.pluginPending
    if (pending) {
      killTree(pending.child.pid)
      this.finishPlugin(pending, false, '操作已取消（DSH 正在停止）')
    }
    // 升级中的 pnpm/探针子进程也整树终止（不置空，交给其 exit 处理器 resolve 后走回滚）
    if (this.upgradePending) killTree(this.upgradePending.pid)
    const child = this.child
    if (!child) return
    this.child = null
    this.port = null
    this.webUrl = null
    this.emit()
    this.log('info', '已停止 DSH Web UI')
    if (child.pid !== undefined) this.clearPidLock(child.pid)
    killTree(child.pid)
  }

  status(): DshStatus {
    return {
      running: !!this.child,
      port: this.child ? (this.port ?? undefined) : undefined,
      url: this.child ? (this.webUrl ?? undefined) : undefined,
    }
  }

  // -----------------------------------------------------------------
  // 运行时升级 + 兼容性检测
  // -----------------------------------------------------------------

  /** 读取覆盖层元数据（active.json / 旧 zdn-runtime.json）；不存在/损坏返回 null */
  private readRuntimeMeta(): RuntimeMeta | null {
    const state = this.readRuntimeState()
    if (!state) return null
    return {
      version: state.version,
      source: 'user',
      at: state.at,
      vendorPatchApplied: state.vendorPatchApplied === true,
    }
  }

  /** 读取 npm registry 元信息（dist-tags + 版本列表 + 发布时间 + addon 声明） */
  private async fetchDshRegistryMeta(): Promise<{
    distTags: Record<string, string>
    versions: RuntimeVersionMeta[]
  } | null> {
    try {
      const r = await fetch('https://registry.npmjs.org/@deepseek-ai%2Fdsh', {
        signal: AbortSignal.timeout(10_000),
      })
      if (!r.ok) return null
      const j = (await r.json()) as {
        'dist-tags'?: Record<string, string>
        versions?: Record<string, { deprecated?: unknown; dependencies?: Record<string, string> }>
        time?: Record<string, string>
      }
      const distTags = j['dist-tags'] ?? {}
      const tagByVersion = new Map<string, string[]>()
      for (const [tag, version] of Object.entries(distTags)) {
        if (typeof version !== 'string') continue
        tagByVersion.set(version, [...(tagByVersion.get(version) ?? []), tag])
      }
      const hostAddon = ADDON_HOST_VERSION
      const versions: RuntimeVersionMeta[] = Object.entries(j.versions ?? {})
        .filter(([version]) => validSemver(version))
        .map(([version, m]) => {
          const addonRange = m?.dependencies?.['node-addon-require-builtin'] ?? null
          return {
            version,
            publishedAt: j.time?.[version] ? Date.parse(j.time[version]) : null,
            addonRange,
            deprecated: typeof m?.deprecated === 'string' && m.deprecated ? m.deprecated : null,
            tags: tagByVersion.get(version) ?? [],
            hostAddonCompatible: isAddonRangeCompatible(addonRange, hostAddon),
          }
        })
        .sort((a, b) => rcompare(a.version, b.version))
      return { distTags, versions }
    } catch {
      return null
    }
  }

  /** 将 dist-tag 名（latest/next/alpha）映射为具体版本号并校验；无法解析返回 null */
  private async resolveTargetVersion(
    target: string,
  ): Promise<{ ref: string | null; distTags: Record<string, string> | null }> {
    const meta = await this.fetchDshRegistryMeta()
    const distTags = meta?.distTags ?? null
    const ref = (distTags && distTags[target]) || target
    return { ref: validSemver(ref) ? ref : null, distTags }
  }

  /** 目标 dsh manifest 的 @deepseek-ai/* 依赖 → 代表版本（minVersion），供升级预演的 peer 解析 */
  private coreVersionsFromManifest(manifest: Record<string, unknown>): Record<string, string> {
    const deps = (manifest.dependencies ?? {}) as Record<string, string>
    const out: Record<string, string> = {}
    for (const [name, range] of Object.entries(deps)) {
      if (!name.startsWith('@deepseek-ai/')) continue
      let v: string | null
      try {
        v = minVersion(range)?.version ?? null
      } catch {
        v = null
      }
      if (v) out[name] = v
    }
    return out
  }

  /** 将已装插件读为体检/预演输入（manifest 不可读为 null，fail-open）；profile 不可读返回 [] */
  private installedPluginEntries(): PluginManifestEntry[] {
    let plugins: Array<DshPluginInfo & { active?: boolean }>
    try {
      plugins = this.collectPlugins()
    } catch {
      return []
    }
    return plugins.map((p) => ({
      name: p.name,
      version: p.version,
      active: p.active !== false,
      manifest: this.readPackageManifest(p.name),
    }))
  }

  /**
   * 收集需要做完整性校验的包名：顶层依赖 + profile/bundle patch 中 insert 的 entry 包名
   * （覆盖 @linxin666/dsh-web-all 这类「传递依赖被插入为 loader entry」的情形）。
   */
  private collectEntryPackageNames(): string[] {
    const names = new Set<string>()
    try {
      for (const p of this.collectPlugins()) names.add(p.name)
    } catch {
      /* profile 不可读：仅靠 patch 扫描 */
    }
    const paths: string[] = [join(this.profileDir(), 'cordis.patch.yml')]
    try {
      const manifest = JSON.parse(
        readFileSync(join(this.profileDir(), 'package.json'), 'utf8'),
      ) as {
        dsh?: { profile?: { bundles?: string[] } }
      }
      for (const b of manifest?.dsh?.profile?.bundles ?? []) {
        const dir = this.resolvePackageDir(b)
        if (!dir) continue
        try {
          const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
            dsh?: { bundle?: { patch?: string } }
          }
          const rel = pkg?.dsh?.bundle?.patch
          if (typeof rel === 'string' && rel) paths.push(join(dir, rel))
        } catch {
          /* bundle manifest 不可读则跳过 */
        }
      }
    } catch {
      /* profile manifest 不可读：只扫 profile patch */
    }
    for (const p of paths) {
      const text = readTextSafe(p)
      if (!text) continue
      for (const e of collectPatchEntries(text)) {
        if (!e.name) continue
        const pkg = packageNameFromEntry(e.name)
        if (pkg) names.add(pkg)
      }
    }
    return [...names].sort()
  }

  /** 安装完整性体检：逐包校验目录/package.json/入口文件是否真实存在 */
  private installIntegrity(): PackageIntegrityResult[] {
    return this.collectEntryPackageNames().map((name) =>
      checkPackageInstallIntegrity({
        name,
        packageDir: this.resolvePackageDir(name),
        readText: readTextSafe,
        exists: existsSync,
      }),
    )
  }

  private runtimePrefs(): { pinned: string | null; ignored: string[] } {
    try {
      const settings = getAllSettings()
      const pinnedRaw = settings[RUNTIME_PIN_KEY]?.trim() ?? ''
      const ignoredRaw = settings[RUNTIME_IGNORED_KEY]?.trim() ?? ''
      let ignored: unknown = []
      if (ignoredRaw) {
        try {
          ignored = JSON.parse(ignoredRaw)
        } catch {
          ignored = []
        }
      }
      return {
        pinned: validSemver(pinnedRaw) ? pinnedRaw : null,
        ignored: Array.isArray(ignored)
          ? ignored.filter((v): v is string => typeof v === 'string' && !!validSemver(v))
          : [],
      }
    } catch {
      return { pinned: null, ignored: [] }
    }
  }

  /** 锁定/取消锁定当前版本（只影响推荐，不阻止手动升级） */
  async setRuntimePin(version: string | null): Promise<{ ok: boolean; error?: string }> {
    const v = (version ?? '').trim()
    if (v && !validSemver(v)) return { ok: false, error: `无效版本号：${v}` }
    try {
      setSetting(RUNTIME_PIN_KEY, v)
      this.log('info', v ? `已锁定 DSH 运行时版本：${v}` : '已取消 DSH 运行时版本锁定')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 忽略/恢复某个版本（推荐会跳到下一个可用版本） */
  async setRuntimeIgnored(
    version: string,
    ignored: boolean,
  ): Promise<{ ok: boolean; ignored?: string[]; error?: string }> {
    const v = version.trim()
    if (!validSemver(v)) return { ok: false, error: `无效版本号：${v}` }
    try {
      const { ignored: current } = this.runtimePrefs()
      const next = new Set(current)
      if (ignored) next.add(v)
      else next.delete(v)
      setSetting(RUNTIME_IGNORED_KEY, JSON.stringify([...next].sort()))
      return { ok: true, ignored: [...next].sort() }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 查询运行时版本与 npm 上可升级目标（不落地，仅信息） */
  async checkRuntimeUpdate(): Promise<DshRuntimeUpdateInfo> {
    const current = this.version()
    const hasUserOverride = !!this.activeUserRuntimeDir()
    const registry = await this.fetchDshRegistryMeta()
    const distTags = registry?.distTags ?? null
    const latest = distTags?.latest ?? distTags?.next ?? null
    const { pinned, ignored } = this.runtimePrefs()
    const recommended = registry
      ? pickRecommendedRuntime({
          current,
          versions: registry.versions,
          distTags,
          pinned,
          ignored,
        })
      : (pinned ?? latest)
    const state = this.readRuntimeState()
    return {
      ok: true,
      current,
      hasUserOverride,
      meta: hasUserOverride ? this.readRuntimeMeta() : null,
      distTags,
      latest,
      recommended,
      versions: registry?.versions ?? [],
      pinned,
      ignored,
      previous: state?.previous ? { version: state.previous.version, at: state.previous.at } : null,
      host: hostRuntimeInfo(),
      error: registry ? undefined : '网络不可达，无法获取版本列表',
    }
  }

  /** 目标版本发布说明：GitHub release（dsh-v<v> / v<v>）优先，npm 描述兜底 */
  async getRuntimeReleaseNotes(version: string): Promise<DshRuntimeNotes> {
    const v = version.trim()
    if (!validSemver(v)) {
      return {
        ok: false,
        version: v,
        title: v,
        body: '',
        url: '',
        source: 'error',
        error: `无效版本号：${v}`,
      }
    }
    const repo = 'deepseek-ai/deepseek-harness'
    for (const tag of [`dsh-v${v}`, `v${v}`]) {
      try {
        const r = await fetch(
          `https://api.github.com/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`,
          {
            signal: AbortSignal.timeout(8_000),
            headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'zdn-notes' },
          },
        )
        if (!r.ok) continue
        const j = (await r.json()) as {
          name?: unknown
          body?: unknown
          html_url?: unknown
          published_at?: unknown
        }
        const body = typeof j.body === 'string' ? j.body.trim() : ''
        const title = typeof j.name === 'string' && j.name ? j.name : tag
        if (!body && !title) continue
        return {
          ok: true,
          version: v,
          title,
          body: body || title,
          url:
            typeof j.html_url === 'string'
              ? j.html_url
              : `https://github.com/${repo}/releases/tag/${tag}`,
          source: 'github',
          publishedAt: typeof j.published_at === 'string' ? Date.parse(j.published_at) : null,
        }
      } catch {
        /* 尝试下一个 tag / npm fallback */
      }
    }
    try {
      const r = await fetch(`https://registry.npmjs.org/@deepseek-ai%2Fdsh/${v}`, {
        signal: AbortSignal.timeout(8_000),
      })
      if (r.ok) {
        const j = (await r.json()) as { description?: unknown }
        return {
          ok: true,
          version: v,
          title: `@deepseek-ai/dsh@${v}`,
          body:
            typeof j.description === 'string' && j.description
              ? j.description
              : `Published @deepseek-ai/dsh@${v} on npm.`,
          url: `https://www.npmjs.com/package/@deepseek-ai/dsh/v/${v}`,
          source: 'npm',
        }
      }
    } catch {
      /* fallthrough */
    }
    return {
      ok: false,
      version: v,
      title: `@deepseek-ai/dsh@${v}`,
      body: '',
      url: `https://github.com/${repo}/releases`,
      source: 'error',
      error: '无法获取发布说明（网络不可达或 release 不存在）',
    }
  }

  /** 已装插件兼容性体检（对当前运行时） */
  async checkPluginCompatibility(): Promise<{
    ok: boolean
    plugins?: PluginCompatStatus[]
    integrity?: PackageIntegrityResult[]
    error?: string
  }> {
    const ready = this.isReady()
    if (!ready.ready) return { ok: false, error: ready.reason }
    return {
      ok: true,
      plugins: summarizePluginStatuses({
        plugins: this.installedPluginEntries(),
        dshVersion: this.version(),
        nodeVersion: process.versions.node,
        resolveRuntimePackageVersion: (n) => this.resolveRuntimePackageVersion(n),
      }),
      integrity: this.installIntegrity(),
    }
  }

  /** 升级前预演：目标版本对已装插件的兼容性影响（只返回会失效的插件）+ 当前安装完整性 */
  async previewUpgrade(target: string): Promise<{
    ok: boolean
    from?: string | null
    to?: string
    crossMinor?: boolean
    breaking?: PluginUpgradeImpact[]
    integrity?: PackageIntegrityResult[]
    error?: string
  }> {
    const t = target.trim()
    if (!t) return { ok: false, error: '请填写目标版本' }
    const { ref, distTags } = await this.resolveTargetVersion(t)
    if (!ref) {
      return {
        ok: false,
        error: distTags ? `无法识别目标版本：${t}` : '网络不可达，无法校验目标版本',
      }
    }
    const manifest = await this.fetchRegistryManifest('@deepseek-ai/dsh', ref)
    if (!manifest) {
      return {
        ok: false,
        error: `无法获取 @deepseek-ai/dsh@${ref} 的清单（网络不可达或版本不存在）`,
      }
    }
    const breaking = simulatePluginsAgainstTarget({
      plugins: this.installedPluginEntries(),
      targetDshVersion: ref,
      targetCoreVersions: this.coreVersionsFromManifest(manifest),
      nodeVersion: process.versions.node,
    })
    const from = this.version()
    return {
      ok: true,
      from,
      to: ref,
      crossMinor: !sameMinorVersion(from, ref),
      breaking,
      integrity: this.installIntegrity(),
    }
  }
  /** profile 指纹：预演通过后若插件清单/配置变化，跨 minor 升级需重新预演 */
  private profileFingerprint(): string {
    const dir = this.profileDir()
    return `${readTextSafe(join(dir, 'package.json')) ?? ''}\n${readTextSafe(join(dir, 'cordis.patch.yml')) ?? ''}`
  }

  /** 完整插件闭包（顶层依赖 + bundle patch entry 包 + 其全部传递依赖） */
  private pluginClosure(): PluginClosureNode[] {
    return collectPluginClosure({
      roots: this.collectEntryPackageNames(),
      readManifest: (name) => this.readPackageManifest(name),
    })
  }

  /** 对目标运行时跑完整闭包的严格兼容判定（只判定真正的 DSH 插件包） */
  private checkClosureAgainstTarget(
    ref: string,
    crossMinor: boolean,
    targetCoreVersions: Record<string, string | undefined>,
  ): PluginTargetIssue[] {
    const out: PluginTargetIssue[] = []
    for (const node of this.pluginClosure()) {
      if (!node.manifest || !isDshPluginManifest(node.manifest)) continue
      const found = checkPluginAgainstTarget({
        manifest: node.manifest,
        targetDshVersion: ref,
        targetCoreVersions,
        nodeVersion: process.versions.node,
        crossMinor,
      })
      const errors = found.filter((i) => i.severity === 'error').map((i) => i.message)
      const warnings = found.filter((i) => i.severity === 'warning').map((i) => i.message)
      if (errors.length === 0 && warnings.length === 0) continue
      out.push({
        package: node.name,
        version: node.version,
        root: node.root,
        parent: node.parent,
        errors,
        warnings,
      })
    }
    return out
  }

  /** 报告按顶层插件聚合（同一 bundle 的多个子包不重复刷屏） */
  private aggregateIssues(nodes: PluginTargetIssue[]): PluginTargetIssue[] {
    const versions = new Map(this.pluginClosure().map((n) => [n.name, n.version]))
    const byRoot = new Map<string, PluginTargetIssue>()
    for (const n of nodes) {
      let cur = byRoot.get(n.root)
      if (!cur) {
        cur = {
          package: n.root,
          version: versions.get(n.root) ?? '',
          root: n.root,
          parent: null,
          errors: [],
          warnings: [],
          children: [],
        }
        byRoot.set(n.root, cur)
      }
      if (n.package !== n.root && !cur.children!.includes(n.package)) cur.children!.push(n.package)
      const prefix = n.package === n.root ? '' : `${n.package}: `
      cur.errors.push(...n.errors.map((e) => `${prefix}${e}`))
      for (const w of n.warnings) if (!cur.warnings.includes(w)) cur.warnings.push(w)
    }
    return [...byRoot.values()]
  }

  /** 读取目标运行时实际安装的 @deepseek-ai/* 版本表（缺失的 peer 据此判定） */
  private installedCoreVersions(base: string): Record<string, string> {
    const out: Record<string, string> = {}
    const dir = join(base, 'node_modules', '@deepseek-ai')
    if (!existsSync(dir)) return out
    try {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory() && !e.isSymbolicLink()) continue
        const raw = readTextSafe(join(dir, e.name, 'package.json'))
        if (!raw) continue
        try {
          const v = (JSON.parse(raw) as { version?: unknown }).version
          if (typeof v === 'string' && v) out[`@deepseek-ai/${e.name}`] = v
        } catch {
          /* 单个包 manifest 损坏：忽略 */
        }
      }
    } catch {
      /* 目录不可读：视为没有核心包（严格判定会据此报缺失） */
    }
    return out
  }

  /** 读取 npm registry 的完整 packument（含每个版本的 manifest），供推荐版本扫描 */
  private async fetchRegistryPackument(
    name: string,
  ): Promise<Record<string, Record<string, unknown>> | null> {
    try {
      const r = await fetch(`https://registry.npmjs.org/${name.replace('/', '%2F')}`, {
        signal: AbortSignal.timeout(15_000),
      })
      if (!r.ok) return null
      const j = (await r.json()) as { versions?: Record<string, Record<string, unknown>> }
      return j.versions ?? null
    } catch {
      return null
    }
  }

  /**
   * 升级前预演（每次升级都跑，跨 minor 亦以此放行）：
   * 1. 临时目录安装目标运行时 → 读取真实 @deepseek-ai/* 版本表
   * 2. 复制真实 profile 清单到临时 home → pnpm install
   * 3. 完整闭包严格兼容判定（目标缺 peer / 开放区间 / 版本不符）
   * 4. 用目标运行时真实启动这套插件 → 归因加载失败
   * 5. 失败时扫 registry 推荐可兼容的插件版本，并用推荐组合再启动一次验证
   * 全程只动临时目录，不碰真实 profile；通过的目标写入 lastPreflight。
   */
  async preflightUpgrade(target: string): Promise<DshPreflightResult> {
    const from = this.version()
    const fail = (error: string, to = target, crossMinor = false): DshPreflightResult => ({
      ok: false,
      from,
      to,
      crossMinor,
      declaredIssues: [],
      probeOk: false,
      probeFailures: [],
      recommendations: [],
      integrity: this.installIntegrity(),
      error,
    })
    if (process.env.DSH_DEV_DIR) {
      return fail('DSH_DEV_DIR 已设置（开发覆盖），预演已禁用')
    }
    if (this.upgradeActive || this.pluginPending) return fail('已有操作进行中，请稍候')
    const t = target.trim()
    if (!t) return fail('请填写目标版本')
    const ready = this.isReady()
    if (!ready.ready) return fail(ready.reason ?? 'DSH 运行时不可用')

    const { ref, distTags } = await this.resolveTargetVersion(t)
    if (!ref) {
      return fail(distTags ? `无法识别目标版本：${t}` : '网络不可达，无法校验目标版本')
    }
    const crossMinor = !!from && !sameMinorVersion(from, ref)
    const manifest = await this.fetchRegistryManifest('@deepseek-ai/dsh', ref)
    if (!manifest) {
      return fail(
        `无法获取 @deepseek-ai/dsh@${ref} 的清单（网络不可达或版本不存在）`,
        ref,
        crossMinor,
      )
    }
    const bundled = this.bundledBase()
    const pnpmExe = join(bundled, 'bin', 'pnpm.exe')
    if (!existsSync(pnpmExe)) return fail(`未找到自带 pnpm：${pnpmExe}`, ref, crossMinor)

    const tempRoot = join(app.getPath('temp'), `zdn-dsh-preflight-${Date.now()}`)
    const runtimeDir = join(tempRoot, 'runtime')
    const probeHome = join(tempRoot, 'home')
    const profileSrc = this.profileDir()
    const profileDst = join(probeHome, 'profiles', 'web')
    this.upgradeActive = true
    try {
      this.emitUpgradeLog(
        `\n[dsh] 升级前预演：${from ?? '（未知）'} → ${ref}（${crossMinor ? '跨 minor' : '同 minor'}）\n`,
      )
      this.log('info', `DSH 升级前预演开始：${from ?? '未知'} → ${ref}`)

      // 1) 临时安装目标运行时（与升级同一套清单/锁策略）
      this.seedRuntimeFiles(runtimeDir, bundled, ref, from ? sameMinorVersion(from, ref) : false)
      this.emitUpgradeLog('[dsh] 预演：安装目标运行时…\n')
      const add = await this.runPnpmAdd(runtimeDir, pnpmExe, ref)
      if (!add.ok) {
        return fail(`预演时目标运行时安装失败：${add.error ?? '未知错误'}`, ref, crossMinor)
      }
      const patches = this.applyRuntimePatches(runtimeDir)
      this.emitUpgradeLog(
        `[dsh] vendor patch：win32=${patches.win32.applied ? '已应用' : (patches.win32.reason ?? '跳过')}；app-boot=${patches.appBoot.applied ? '已应用' : (patches.appBoot.reason ?? '跳过')}\n`,
      )
      const targetCore = this.installedCoreVersions(runtimeDir)

      // 2) 复制真实 profile 清单到临时 home（只复制声明文件，不复制 node_modules）
      mkdirSync(profileDst, { recursive: true })
      let hasProfile = false
      for (const f of [
        'package.json',
        'pnpm-lock.yaml',
        'pnpm-workspace.yaml',
        'cordis.patch.yml',
        'cordis.yml',
      ]) {
        const raw = readTextSafe(join(profileSrc, f))
        if (raw === null) continue
        writeFileSync(join(profileDst, f), raw)
        if (f === 'package.json') hasProfile = true
      }

      let probeOk = true
      let probeError: string | undefined
      let probeFailures: ProbeFailure[] = []
      if (hasProfile) {
        this.emitUpgradeLog('[dsh] 预演：安装 profile 插件依赖…\n')
        const inst = await this.runPnpm(
          profileDst,
          pnpmExe,
          ['install', '--force', '--node-linker=hoisted'],
          probeHome,
        )
        if (!inst.ok) {
          probeOk = false
          probeError = `预演时 profile 插件依赖安装失败：${inst.error ?? '未知错误'}`
        }
      }

      // 3) 声明层：完整闭包 vs 目标真实核心包版本
      const declaredNodes = this.checkClosureAgainstTarget(ref, crossMinor, targetCore)
      const declaredIssues = this.aggregateIssues(declaredNodes)

      // 4) 实机：用目标运行时启动这套真实插件
      if (probeOk) {
        this.emitUpgradeLog('[dsh] 预演：用目标运行时启动真实插件集…\n')
        const probe = await this.probeRuntime(runtimeDir, { home: probeHome })
        probeOk = probe.ok
        probeError = probe.error
        probeFailures = probe.failures
      }

      const declaredBlocked = declaredIssues.some((i) => i.errors.length > 0)
      const ok = probeOk && !declaredBlocked
      let recommendations: UpgradeRecommendation[] = []
      if (!ok) {
        this.emitUpgradeLog('[dsh] 预演：查找可兼容的插件版本…\n')
        recommendations = await this.computeRecommendations(
          ref,
          crossMinor,
          targetCore,
          declaredNodes,
          probeFailures,
        )
        await this.verifyRecommendations(runtimeDir, probeHome, profileDst, recommendations)
      } else {
        this.lastPreflight = { to: ref, fingerprint: this.profileFingerprint() }
        this.emitUpgradeLog('\n[dsh] 预演通过：目标运行时与现有插件可一起启动\n')
      }
      this.log(
        ok ? 'info' : 'warn',
        `DSH 升级前预${ok ? '通过' : '未通过'}${ref}`,
        ok ? undefined : probeError,
      )
      return {
        ok,
        from,
        to: ref,
        crossMinor,
        declaredIssues,
        probeOk,
        probeError,
        probeFailures,
        recommendations,
        integrity: this.installIntegrity(),
      }
    } catch (e) {
      return fail(e instanceof Error ? e.message : String(e), ref, crossMinor)
    } finally {
      try {
        await safeRmAsync(tempRoot)
      } catch {
        /* 临时目录清理失败不影响结果 */
      }
      this.upgradePending = null
      this.upgradeActive = false
    }
  }

  /**
   * 为失败插件寻找可兼容的升级版本：
   * - 顶层插件：直接扫 registry 版本，取最高「严格兼容」版本
   * - 传递插件：归因到顶层 root，要求候选 root 的 dependencies[child] 能解析到兼容子版本
   * 只给建议，不自动安装（用户确认后再升级插件）。
   */
  private async computeRecommendations(
    ref: string,
    crossMinor: boolean,
    targetCore: Record<string, string | undefined>,
    declaredNodes: PluginTargetIssue[],
    probeFailures: ProbeFailure[],
  ): Promise<UpgradeRecommendation[]> {
    const closure = this.pluginClosure()
    const byName = new Map(closure.map((n) => [n.name, n]))
    const tops = new Set(Object.keys(this.readProfileDeps() ?? {}))
    const failing = new Set<string>()
    for (const i of declaredNodes) if (i.errors.length > 0) failing.add(i.package)
    for (const f of probeFailures) {
      const pkg = f.package ?? (f.name ? packageNameFromEntry(f.name) : null)
      if (pkg) failing.add(pkg)
    }
    const packuments = new Map<string, Record<string, Record<string, unknown>> | null>()
    const getPackument = async (
      name: string,
    ): Promise<Record<string, Record<string, unknown>> | null> => {
      if (!packuments.has(name)) packuments.set(name, await this.fetchRegistryPackument(name))
      return packuments.get(name) ?? null
    }
    /** 可推荐 = 无硬阻断（跨 minor 的开放区间等 warning 不足以否决候选） */
    const compatible = (manifest: Record<string, unknown>): boolean =>
      checkPluginAgainstTarget({
        manifest,
        targetDshVersion: ref,
        targetCoreVersions: targetCore,
        nodeVersion: process.versions.node,
        crossMinor,
      }).every((i) => i.severity !== 'error')

    const directRoots = new Set<string>()
    const childrenByRoot = new Map<string, Set<string>>()
    for (const name of failing) {
      // 运行时核心包不提供「升级建议」（应换目标运行时版本）
      if (name.startsWith('@deepseek-ai/')) continue
      const node = byName.get(name)
      if (tops.has(name) || !node || node.name === node.root) {
        directRoots.add(node?.root ?? name)
        continue
      }
      const set = childrenByRoot.get(node.root) ?? new Set<string>()
      set.add(name)
      childrenByRoot.set(node.root, set)
    }

    const recommendations: UpgradeRecommendation[] = []
    for (const root of new Set([...directRoots, ...childrenByRoot.keys()])) {
      const rootNode = byName.get(root)
      const children = [...(childrenByRoot.get(root) ?? [])]
      const rootPack = await getPackument(root)
      const childCompat = new Map<string, string[]>()
      for (const child of children) {
        const pack = await getPackument(child)
        childCompat.set(
          child,
          pack
            ? Object.keys(pack)
                .filter((v) => validSemver(v) && pack[v] && compatible(pack[v]))
                .sort(rcompare)
            : [],
        )
      }
      const missingChild = children.find((c) => (childCompat.get(c) ?? []).length === 0)
      let recommended: string | null = null
      if (rootPack) {
        recommended = selectHighestCompatibleVersion(Object.keys(rootPack), (v) => {
          const m = rootPack[v]
          if (!m || !compatible(m)) return false
          for (const child of children) {
            const range = (m.dependencies as Record<string, string> | undefined)?.[child]
            // 候选顶层插件已不再依赖该子插件（移除/替换）→ 视为修复
            if (!range) continue
            const ok = (childCompat.get(child) ?? []).some((cv) => {
              try {
                return satisfies(cv, range, { includePrerelease: true })
              } catch {
                return false
              }
            })
            if (!ok) return false
          }
          return true
        })
      }
      const recManifest = recommended ? rootPack?.[recommended] : null
      const dropped = children.filter(
        (c) => !(recManifest?.dependencies as Record<string, string> | undefined)?.[c],
      )
      recommendations.push({
        package: root,
        current: rootNode?.version || null,
        recommended,
        kind: children.length > 0 ? 'transitive' : 'direct',
        children: children.length > 0 ? children : undefined,
        note: !rootPack
          ? '顶层插件非 registry 来源或网络不可达，无法自动推荐'
          : recommended
            ? children.length > 0
              ? dropped.length === children.length
                ? `升级 ${root} 已不再依赖 ${children.join('、')}`
                : `升级 ${root} 将带入兼容的 ${children.filter((c) => !dropped.includes(c)).join('、')}`
              : undefined
            : missingChild
              ? `子插件 ${missingChild} 无兼容版本，升级 ${root} 也无法修复`
              : children.length > 0
                ? `暂无同时兼容的 ${root} 版本（可尝试直接安装 ${children[0]}@${childCompat.get(children[0])?.[0] ?? '兼容版本'}）`
                : '暂无兼容版本',
      })
    }
    return recommendations
  }

  /**
   * 用推荐版本改写临时 profile 的顶层依赖，重装并用目标运行时再启动一次：
   * 通过则标记 verified（保证用户照此升级插件后能无缝使用），否则标明未验证。
   */
  private async verifyRecommendations(
    runtimeDir: string,
    probeHome: string,
    profileDst: string,
    recommendations: UpgradeRecommendation[],
  ): Promise<void> {
    const actionable = recommendations.filter((r) => r.recommended)
    if (actionable.length === 0) return
    const pkgPath = join(profileDst, 'package.json')
    const raw = readTextSafe(pkgPath)
    if (!raw) return
    try {
      const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> }
      pkg.dependencies = { ...(pkg.dependencies ?? {}) }
      for (const r of actionable) {
        if (r.recommended) pkg.dependencies[r.package] = r.recommended
      }
      writeFileSync(pkgPath, JSON.stringify(pkg, null, 2))
      // 依赖 spec 已变，删掉旧锁让 pnpm 重新解析（--force 会重建 node_modules）
      await fsp.rm(join(profileDst, 'pnpm-lock.yaml'), { force: true })
      this.emitUpgradeLog('[dsh] 预演：按推荐版本安装插件并验证…\n')
      const pnpmExe = join(this.bundledBase(), 'bin', 'pnpm.exe')
      const inst = await this.runPnpm(
        profileDst,
        pnpmExe,
        ['install', '--force', '--node-linker=hoisted'],
        probeHome,
      )
      if (!inst.ok) {
        for (const r of actionable) {
          r.verified = false
          r.note = `推荐组合安装失败：${inst.error ?? '未知错误'}`
        }
        return
      }
      const probe = await this.probeRuntime(runtimeDir, { home: probeHome })
      for (const r of actionable) {
        r.verified = probe.ok
        r.note = probe.ok
          ? '已通过目标运行时实机验证'
          : `推荐组合启动失败：${probe.error ?? '未知错误'}`
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      for (const r of actionable) {
        r.verified = false
        r.note = `推荐验证失败：${msg}`
      }
    }
  }

  /**
   * 应用内升级 DSH 运行时到目标版本（dist-tag 或精确版本）。
   * 落点为 <userData>/dsh-runtime/versions/<v>（应用更新不会覆盖）。
   * 带备份/回滚 + 真实启动探针：失败自动回到升级前运行时；首次升级失败则回退内置。
   */
  async upgradeRuntime(target: string): Promise<DshUpgradeDone> {
    const from = this.version()
    const done = (r: Omit<DshUpgradeDone, 'from'>): DshUpgradeDone => {
      const full = { ...r, from }
      this.emitUpgradeDone(full)
      return full
    }
    if (process.env.DSH_DEV_DIR) {
      return done({
        ok: false,
        to: target,
        error: 'DSH_DEV_DIR 已设置（开发覆盖），应用内升级已禁用',
      })
    }
    if (this.upgradeActive || this.pluginPending) {
      return done({ ok: false, to: target, error: '已有操作进行中，请稍候' })
    }
    const ready = this.isReady()
    if (!ready.ready)
      return done({ ok: false, to: target, error: ready.reason ?? 'DSH 运行时不可用' })

    this.upgradeActive = true
    const wasRunning = !!this.child
    const root = this.userRuntimeDir()
    let targetDir: string | null = null
    let oldState: RuntimeState | null = null
    let ref: string | null = null
    try {
      const resolved = await this.resolveTargetVersion(target.trim())
      ref = resolved.ref
      if (!ref) {
        throw new Error(
          resolved.distTags ? `无法识别目标版本：${target}` : '网络不可达，无法校验目标版本',
        )
      }
      if (from === ref) throw new Error(`当前已经是 ${ref}`)
      // 每次升级都必须先通过「升级前预演」；预演后 profile 若变化（装/卸插件）
      // 指纹不匹配，需要重新预演。
      {
        const pre = this.lastPreflight
        if (!pre || pre.to !== ref || pre.fingerprint !== this.profileFingerprint()) {
          throw new Error(
            `未通过预演的运行时升级（${from ?? '未知'} → ${ref}）：请先执行「预演」，通过后再升级。`,
          )
        }
      }

      const bundled = this.bundledBase()
      const pnpmExe = join(bundled, 'bin', 'pnpm.exe')
      if (!existsSync(pnpmExe)) throw new Error(`未找到自带 pnpm：${pnpmExe}`)

      if (wasRunning) await this.stop()
      this.migrateLegacyRuntime()
      oldState = this.readRuntimeState()

      this.emitUpgradeLog(`\n[dsh] 升级 DSH 运行时 ${from ?? '（未知）'} → ${ref}\n`)
      this.log('info', `DSH 运行时升级开始：${from ?? '未知'} → ${ref}`)

      targetDir = join(this.userVersionsDir(), runtimeVersionDirName(ref))
      if (existsSync(targetDir)) await safeRmAsync(targetDir)
      mkdirSync(targetDir, { recursive: true })
      this.seedRuntimeFiles(targetDir, bundled, ref, from ? sameMinorVersion(from, ref) : false)

      const add = await this.runPnpmAdd(targetDir, pnpmExe, ref)
      if (!add.ok) throw new Error(add.error ?? 'pnpm 安装失败')

      const patches = this.applyRuntimePatches(targetDir)
      this.emitUpgradeLog(
        `\n[dsh] vendor patch：win32=${patches.win32.applied ? '已应用' : (patches.win32.reason ?? '跳过')}；app-boot=${patches.appBoot.applied ? '已应用' : (patches.appBoot.reason ?? '跳过')}\n`,
      )
      const patch = patches.win32

      this.emitUpgradeLog(`\n[dsh] 启动探针（新运行时）…\n`)
      const probe = await this.probeRuntime(targetDir)
      if (!probe.ok) throw new Error(`启动探针失败：${probe.error ?? '未知错误'}`)

      const previous: RuntimeStateEntry | undefined = oldState
        ? {
            version: oldState.version,
            dir: oldState.dir,
            at: oldState.at,
            vendorPatchApplied: oldState.vendorPatchApplied,
          }
        : undefined
      this.writeRuntimeState({
        version: ref,
        dir: relative(root, targetDir),
        at: Date.now(),
        vendorPatchApplied: patch.applied,
        previous,
      })
      this.cachedVersion = undefined

      if (wasRunning) {
        const started = await this.start()
        if (!started.ok) {
          throw new Error(`新运行时已安装，但启动失败：${started.error ?? '未知错误'}`)
        }
      }

      // 用户主动升级成功：解除“锁定当前版本”，避免推荐仍停在旧版
      try {
        setSetting(RUNTIME_PIN_KEY, '')
      } catch {
        /* 设置写入失败不影响升级结果 */
      }
      await this.cleanupRuntimeVersions([targetDir, previous ? join(root, previous.dir) : ''])
      this.log('info', `DSH 运行时升级成功：${ref}`)
      this.emitUpgradeLog(`\n[dsh] 升级成功：${ref}\n`)
      return done({ ok: true, to: ref })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.emitUpgradeLog(`\n[dsh] 升级失败，回滚：${msg}\n`)
      this.log('error', 'DSH 运行时升级失败，已回滚', msg)
      try {
        if (targetDir) await safeRmAsync(targetDir)
        if (oldState) this.writeRuntimeState(oldState)
        else await fsp.rm(this.activeStatePath(), { force: true })
        this.cachedVersion = undefined
        if (wasRunning) await this.start()
      } catch (rollbackErr) {
        this.log(
          'error',
          '运行时升级回滚失败',
          rollbackErr instanceof Error ? rollbackErr.message : String(rollbackErr),
        )
      }
      return done({ ok: false, to: ref ?? target, reverted: true, error: msg })
    } finally {
      this.upgradePending = null
      this.upgradeActive = false
      // 预演只在「升级前」有效：升级/回滚都会改动运行时或 profile，必须重新预演
      this.lastPreflight = null
    }
  }

  /**
   * 备份 DSH_HOME（会话、profile 清单、凭据/配置），排除 node_modules 与运行时目录。
   * 升级可能迁移 Session 格式，官方也建议首次启动新版本前备份。
   */
  async backupDshHome(): Promise<{ ok: boolean; path?: string; error?: string }> {
    const { home } = this.resolvePaths()
    if (!existsSync(home)) return { ok: false, error: `DSH_HOME 不存在：${home}` }
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const dest = join(app.getPath('userData'), 'dsh-backups', `dsh-home-${stamp}`)
    const excluded = new Set([
      'node_modules',
      'dsh-runtime',
      'dsh-runtimes',
      'dsh-backups',
      'update-stage',
      'update-cache',
      'engine-bak',
    ])
    try {
      mkdirSync(dest, { recursive: true })
      await fsp.cp(home, dest, {
        recursive: true,
        force: true,
        filter: (src) => {
          const rel = relative(home, src)
          if (!rel) return true
          return !rel.split(sep).some((part) => excluded.has(part))
        },
      })
      this.log('info', `DSH 数据已备份：${dest}`)
      return { ok: true, path: dest }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.log('error', 'DSH 数据备份失败', msg)
      return { ok: false, error: msg }
    }
  }

  /** 只保留当前/上一版本目录，清掉更早的版本（safeRm 避免 junction 穿透） */
  private async cleanupRuntimeVersions(keepDirs: string[]): Promise<void> {
    const versions = this.userVersionsDir()
    if (!existsSync(versions)) return
    const keep = new Set(keepDirs.filter(Boolean))
    try {
      for (const e of readdirSync(versions, { withFileTypes: true })) {
        if (!e.isDirectory() && !e.isSymbolicLink()) continue
        const dir = join(versions, e.name)
        if (keep.has(dir)) continue
        await safeRmAsync(dir)
      }
    } catch {
      /* 清理失败不影响升级结果 */
    }
  }

  /** 回退到上一用户版本（保留当前版本，可再次切回） */
  async restorePreviousRuntime(): Promise<{ ok: boolean; version?: string; error?: string }> {
    if (process.env.DSH_DEV_DIR) {
      return { ok: false, error: 'DSH_DEV_DIR 已设置（开发覆盖），无法回退' }
    }
    if (this.upgradeActive || this.pluginPending) {
      return { ok: false, error: '已有操作进行中，请稍候' }
    }
    const root = this.userRuntimeDir()
    const state = this.readRuntimeState()
    const prev = state?.previous
    if (!state || !prev) return { ok: false, error: '没有上一用户版本可回退' }
    const prevDir = join(root, prev.dir)
    if (!this.hasDshBin(prevDir)) return { ok: false, error: `上一版本目录不可用：${prevDir}` }
    const wasRunning = !!this.child
    if (wasRunning) await this.stop()
    try {
      this.applyRuntimePatches(prevDir)
      this.emitUpgradeLog(`\n[dsh] 回退运行时：${state.version} → ${prev.version}\n`)
      this.writeRuntimeState({
        version: prev.version,
        dir: prev.dir,
        at: Date.now(),
        vendorPatchApplied: prev.vendorPatchApplied,
        previous: {
          version: state.version,
          dir: state.dir,
          at: state.at,
          vendorPatchApplied: state.vendorPatchApplied,
        },
      })
      this.cachedVersion = undefined
      if (wasRunning) {
        const started = await this.start()
        if (!started.ok) throw new Error(started.error ?? '回退后启动失败')
      }
      this.log('info', `DSH 运行时已回退：${prev.version}`)
      this.emitUpgradeLog(`\n[dsh] 已回退到 ${prev.version}\n`)
      this.emitUpgradeDone({ ok: true, from: state.version, to: prev.version })
      return { ok: true, version: prev.version }
    } catch (e) {
      // 切回原状态，尽量恢复服务
      this.writeRuntimeState(state)
      this.cachedVersion = undefined
      if (wasRunning) await this.start()
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 回退到内置运行时：删除用户覆盖层（存在时），随后重启（若运行中） */
  async revertRuntime(): Promise<{ ok: boolean; error?: string }> {
    if (process.env.DSH_DEV_DIR) {
      return { ok: false, error: 'DSH_DEV_DIR 已设置（开发覆盖），无法回退' }
    }
    if (this.upgradeActive || this.pluginPending)
      return { ok: false, error: '已有操作进行中，请稍候' }
    const userDir = this.userRuntimeDir()
    if (!existsSync(userDir)) return { ok: true }
    const oldVersion = this.readRuntimeState()?.version ?? null
    const wasRunning = !!this.child
    if (wasRunning) await this.stop()
    try {
      await safeRmAsync(userDir)
      this.cachedVersion = undefined
      this.log('info', '已回退到内置 DSH 运行时')
      this.emitUpgradeLog('\n[dsh] 已回退到内置 DSH 运行时\n')
      if (wasRunning) void this.start()
      this.emitUpgradeDone({
        ok: true,
        from: oldVersion,
        to: this.version() ?? oldVersion ?? '',
      })
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 重装 profile 依赖（修复「pnpm 认为已装、实为空目录」的坏安装）。
   * 停 DSH → 备份清单 → 删除 profiles/web/node_modules → 自带 pnpm install --force →
   * 重新对账 bundles。插件与配置（cordis.patch.yml / package.json）保留。
   */
  async repairProfileDeps(): Promise<{ ok: boolean; error?: string }> {
    if (process.env.DSH_DEV_DIR) {
      return { ok: false, error: 'DSH_DEV_DIR 已设置（开发覆盖），已禁用' }
    }
    if (this.upgradeActive || this.pluginPending)
      return { ok: false, error: '已有操作进行中，请稍候' }
    const ready = this.isReady()
    if (!ready.ready) return { ok: false, error: ready.reason }
    const profile = this.profileDir()
    if (!existsSync(join(profile, 'package.json'))) return { ok: true } // 尚未初始化/未装过插件
    const bundled = this.bundledBase()
    const pnpmExe = join(bundled, 'bin', 'pnpm.exe')
    if (!existsSync(pnpmExe)) return { ok: false, error: `未找到自带 pnpm：${pnpmExe}` }

    this.upgradeActive = true
    const wasRunning = !!this.child
    try {
      if (wasRunning) await this.stop()
      this.log('info', '开始重装 DSH profile 依赖')
      this.emitUpgradeLog(`\n[dsh] 重装 profile 依赖：${profile}\n`)
      this.healProfileBuildPolicy()
      const nm = join(profile, 'node_modules')
      if (existsSync(nm)) await safeRmAsync(nm)
      const r = await this.runPnpm(profile, pnpmExe, [
        'install',
        '--force',
        '--node-linker=hoisted',
      ])
      if (!r.ok) throw new Error(r.error ?? 'pnpm install 失败')
      this.reconcileBundles()
      this.log('info', 'DSH profile 依赖重装完成')
      this.emitUpgradeLog('\n[dsh] profile 依赖重装完成\n')
      if (wasRunning) void this.start()
      return { ok: true }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      this.log('error', 'DSH profile 依赖重装失败', msg)
      this.emitUpgradeLog(`\n[dsh] profile 依赖重装失败${msg}\n`)
      if (wasRunning) void this.start()
      return { ok: false, error: msg }
    } finally {
      this.upgradePending = null
      this.upgradeActive = false
    }
  }

  /**
   * 初始化覆盖层清单（不复制内置 node_modules，避免同步大拷贝阻塞主进程）：
   * - package.json 固定目标版本
   * - pnpm-workspace.yaml 固化 hoisted + 允许全部 build scripts + 关闭发布龄门槛
   * - 同 minor 时拷贝内置 pnpm-lock.yaml（钉 cordis 五件套，防 v1.8.14 浮动崩溃）
   */
  private seedRuntimeFiles(
    dest: string,
    bundled: string,
    ref: string,
    copyLockfile: boolean,
  ): void {
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'package.json'), JSON.stringify(buildRuntimePackageJson(ref), null, 2))
    writeFileSync(
      join(dest, 'pnpm-workspace.yaml'),
      'packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: true\ndangerouslyAllowAllBuilds: true\nminimumReleaseAge: 0\n',
    )
    const lock = join(bundled, 'pnpm-lock.yaml')
    if (copyLockfile && existsSync(lock)) {
      try {
        cpSync(lock, join(dest, 'pnpm-lock.yaml'))
      } catch {
        /* lockfile 拷贝失败不阻断（pnpm 会重新解析，探针兜底） */
      }
    }
  }

  /** 在覆盖层运行自带 pnpm add，固定目标版本（--ignore-scripts 与构建期一致） */
  private runPnpmAdd(
    base: string,
    pnpmExe: string,
    version: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return this.runPnpm(base, pnpmExe, [
      'add',
      `@deepseek-ai/dsh@${version}`,
      '--node-linker=hoisted',
      '--ignore-scripts',
    ])
  }

  /** 运行自带 pnpm（流式输出到升级日志 + 应用日志），升级与修复共用 */
  private runPnpm(
    base: string,
    pnpmExe: string,
    args: string[],
    home?: string,
  ): Promise<{ ok: boolean; error?: string }> {
    return new Promise((resolve) => {
      const child = spawn(pnpmExe, args, {
        cwd: base,
        env: { ...this.buildEnv(home ?? this.resolvePaths().home) },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      this.upgradePending = child
      let tail = ''
      child.stdout?.on('data', (d) => {
        const s = d.toString()
        this.emitUpgradeLog(s)
        const line = s.trim()
        if (line) this.log('info', line)
      })
      child.stderr?.on('data', (d) => {
        const s = d.toString()
        tail = (tail + s).slice(-2000)
        this.emitUpgradeLog(s)
      })
      child.on('error', (e) => {
        if (this.upgradePending !== child) return
        this.upgradePending = null
        resolve({ ok: false, error: formatChildError(e) })
      })
      child.on('exit', (code) => {
        if (this.upgradePending !== child) return
        this.upgradePending = null
        resolve(
          code === 0
            ? { ok: true }
            : { ok: false, error: `pnpm 退出码 ${code}${tail.trim() ? `${tail.trim()}` : ''}` },
        )
      })
    })
  }

  /**
   * 真实启动探针：以生产一致的 run-as-node + --expose-internals spawn 目标运行时，
   * 等 HTTP 就绪即成功（--dump-config 抓不到 cordis HMR 竞态，必须真起）。
   * 不改变 this.child/this.port、不写 pid 锁、不发状态；结束整树 kill。
   *
   * opts.home 由升级预演传入（真实 profile 清单的临时副本）；不传则自建临时 home。
   * 无论哪种都只动临时目录，绝不碰真实 profile（新运行时会迁移 profile）。
   */
  private async probeRuntime(
    base: string,
    opts?: { home?: string },
  ): Promise<{ ok: boolean; error?: string; failures: ProbeFailure[] }> {
    const dshBin = join(base, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    if (!existsSync(dshBin)) {
      return { ok: false, error: `未找到入口 ${dshBin}`, failures: [] }
    }
    const ownsHome = !opts?.home
    const probeHome = opts?.home ?? join(app.getPath('temp'), `zdn-dsh-probe-${Date.now()}`)
    if (ownsHome) {
      try {
        mkdirSync(probeHome, { recursive: true })
      } catch (e) {
        return {
          ok: false,
          error: `无法创建探针目录：${e instanceof Error ? e.message : String(e)}`,
          failures: [],
        }
      }
    }
    let port: number
    try {
      port = await this.reservePort()
    } catch (e) {
      if (ownsHome) await safeRmAsync(probeHome)
      return { ok: false, error: e instanceof Error ? e.message : String(e), failures: [] }
    }
    const child = spawn(
      process.execPath,
      ['--expose-internals', dshBin, '--profile', 'web', '--no-open', '--port', String(port)],
      {
        cwd: probeHome,
        env: { ...this.buildEnv(probeHome, {}, base), ELECTRON_RUN_AS_NODE: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
    this.upgradePending = child
    let stderr = ''
    let exited = false
    child.stdout?.on('data', (d) => this.emitUpgradeLog(d.toString()))
    child.stderr?.on('data', (d) => {
      stderr = (stderr + d.toString()).slice(-8000)
    })
    child.on('error', (e) => {
      stderr += `\n${formatChildError(e)}`
      exited = true
    })
    child.on('exit', () => {
      exited = true
    })
    try {
      const deadline = Date.now() + PROBE_RUNTIME_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (exited) {
          const tail = stderr.trim().split('\n').slice(-12).join('\n')
          this.log('warn', '新运行时启动探针失败', stderr.trim().split('\n').slice(-60).join('\n'))
          const failures = this.probeFailuresFrom(stderr)
          const missing = parseMissingPluginPackages(stderr)
          if (missing.length > 0) {
            return {
              ok: false,
              error: `新运行时缺少依赖包：${missing.join('、')}（${tail || '无输出'}）`,
              failures,
            }
          }
          return { ok: false, error: `新运行时启动即退出：${tail || '无输出'}`, failures }
        }
        if (await this.probe(port)) return { ok: true, failures: [] }
        await new Promise((r) => setTimeout(r, 250))
      }
      this.log('warn', '新运行时启动探针超时', stderr.trim().split('\n').slice(-60).join('\n'))
      return {
        ok: false,
        error: `启动探针超时（${PROBE_RUNTIME_TIMEOUT_MS / 1000}s）`,
        failures: this.probeFailuresFrom(stderr),
      }
    } finally {
      killTree(child.pid)
      if (this.upgradePending === child) this.upgradePending = null
      if (ownsHome) {
        try {
          await safeRmAsync(probeHome)
        } catch {
          /* 清理失败不影响结果 */
        }
      }
    }
  }

  /** 从启动 stderr 汇总失败项（loader entry + 找不到的包），供预演报告展示 */
  private probeFailuresFrom(stderr: string): ProbeFailure[] {
    const out: ProbeFailure[] = []
    for (const f of parseBootFailures(stderr)) {
      const pkg = f.entryName ? packageNameFromEntry(f.entryName) : null
      out.push({
        entryId: f.entryId,
        name: f.entryName,
        package: pkg ?? undefined,
        reason: f.detail,
      })
    }
    for (const pkg of parseMissingPluginPackages(stderr)) {
      if (out.some((o) => o.package === pkg)) continue
      out.push({ package: pkg, reason: `找不到包 ${pkg}` })
    }
    return out
  }

  // -----------------------------------------------------------------
  // 插件管理：`dsh plugin` 本质是 pnpm 转发器（硬编码 spawnSync("pnpm")），
  // 因此把自带 pnpm.exe 所在目录前置进子进程 PATH 即可脱离系统依赖运行。
  // 对账逻辑保证「用户装的插件 = profile package.json 的 dependencies」，
  // 列表读取无需解析 dsh.profile（YAML）。
  // -----------------------------------------------------------------

  private profileDir(): string {
    return join(this.resolvePaths().home, 'profiles', 'web')
  }

  async listPlugins(): Promise<{
    ok: boolean
    plugins?: Array<DshPluginInfo & { active?: boolean }>
    quarantined?: QuarantineRecord[]
    error?: string
  }> {
    const ready = this.isReady()
    if (!ready.ready) return { ok: false, error: ready.reason }
    const quarantined = this.readQuarantineLedger()
    const pkgPath = join(this.profileDir(), 'package.json')
    if (!existsSync(pkgPath)) return { ok: true, plugins: [], quarantined } // 尚未初始化/未装过插件
    try {
      return { ok: true, plugins: this.collectPlugins(), quarantined }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /** 同步读取已装插件（含 active）；profile package.json 不存在返回 []，解析失败抛错（调用方处理） */
  private collectPlugins(): Array<DshPluginInfo & { active?: boolean }> {
    const pkgPath = join(this.profileDir(), 'package.json')
    if (!existsSync(pkgPath)) return []
    const raw = readFileSync(pkgPath, 'utf8')
    const manifest = JSON.parse(raw) as {
      dependencies?: Record<string, string>
      dsh?: { profile?: { bundles?: string[] } }
    }
    const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
    // 未进 bundles = 安装中断（reconcile 未执行），DSH 不会加载
    return parseInstalledPlugins(raw).map((p) => ({ ...p, active: bundles.has(p.name) }))
  }

  /**
   * 安装/卸载插件。spec 作为单个 argv 元素原样转发（已由 isValidPluginSpec 校验）。
   * 首次调用时 CLI 会自动从随包模板初始化 web profile。
   * 自动修复链（按序尝试，任一成功即止）：
   * 1. ERR_PNPM_UNEXPECTED_STORE → 清理旧 store 的 node_modules 后重试
   * 2. ERR_PNPM_IGNORED_BUILDS → 解析全部被拦截包名，--allow-build 放行后重试
   * 3. 瞬时网络错误 → 原样重试一次
   * 4. 仍带被拦截构建脚本 → 再次固化构建策略后重试
   * 安装（add）成功后追加安全门链（任一失败自动回滚卸载）：
   * 1. G2a 已落盘 manifest 兼容性复核（dsh/node 版本要求 + @deepseek-ai/* peer）
   * 2. G2b patch entry id 重复检测（DSH 按 id 匹配 patch，重复会静默互相覆盖）
   * 3. G3 import 预检（run-as-node `await import(pkg)`，捕获入口缺失/导入即崩）
   * 4. `--dump-config` 启动预检：失败且输出指向本次新增依赖 → 回滚；失败与新增
   *    依赖无关、或安装前依赖集读不到（首次初始化，无法 diff）→ 只报错不回滚
   * 无论成败，结束后 reconcileBundles() 补账（根治「依赖已记录但 bundle 层缺失」）。
   * dsh:pluginDone 只在最终结果发一次（成功事件不再早于预检发出，
   * 避免「先 toast 安装成功、后回滚」的矛盾 UI）。
   */
  async pluginAction(
    action: 'add' | 'remove',
    spec: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.pluginPending) return { ok: false, error: '已有插件操作进行中，请稍候' }
    if (this.upgradeActive) return { ok: false, error: 'DSH 运行时升级进行中，请稍候' }
    const ready = this.isReady()
    if (!ready.ready) return { ok: false, error: ready.reason }
    if (!isValidPluginSpec(spec)) return { ok: false, error: `非法的插件标识：${spec}` }

    // G1：registry 插件安装前兼容性预检（DSH 版本要求 / engines.node / @deepseek-ai/* peer）。
    // 网络不可达或非 registry spec 时 fail-open，交给 pnpm 与后续门禁。
    if (action === 'add') {
      const classified = classifyPluginSpec(spec)
      if (classified.kind === 'registry') {
        const manifest = await this.fetchRegistryManifest(classified.name, classified.version)
        if (manifest) {
          const issues = checkPluginCompatibility({
            manifest,
            dshVersion: this.version(),
            nodeVersion: process.versions.node,
            resolveRuntimePackageVersion: (n) => this.resolveRuntimePackageVersion(n),
          })
          if (issues.length > 0) {
            const error = `插件不兼容，已拒绝安装：${issues.join('；')}`
            this.log('warn', error)
            console.warn(`[dsh] ${error}`)
            this.emitPluginLog(`\n[dsh] ${error}\n`)
            return { ok: false, error }
          }
        }
      }
    }

    const { dshBin, home } = this.resolvePaths()
    mkdirSync(home, { recursive: true })
    // profile 已存在时先固化 pnpm 构建策略，让首次尝试就不被 build-scripts 拦截。
    this.healProfileBuildPolicy()
    // 注：pnpm 11 不再读取 npm_config_*，发布龄/构建策略统一由 healProfileBuildPolicy
    // 写入 profile 的 pnpm-workspace.yaml（minimumReleaseAge: 0 + dangerouslyAllowAllBuilds: true）。
    this.log('info', `插件操作 ${action}: ${spec}`)

    // 预检回滚依赖「安装前后依赖 diff」：before 读不到（profile 不存在/损坏）→ null，
    // findNewDependencies 返回空 → 不回滚（首次初始化落盘的模板依赖不参与 diff）。
    const beforeDeps = this.readProfileDeps()

    const runDshPlugin = (
      act: 'add' | 'remove',
      target: string,
      extraArgs: string[] = [],
    ): Promise<{ ok: boolean; error?: string }> =>
      new Promise((resolve) => {
        // 与 server 同理：必须使用 run-as-node spawn（见 start() 内注释，打包版
        // utilityProcess 会吞掉 --expose-internals）。
        const child = spawn(
          process.execPath,
          ['--expose-internals', dshBin, 'plugin', '--profile', 'web', act, target, ...extraArgs],
          {
            cwd: home,
            env: { ...this.buildEnv(home), ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          },
        )
        const pending = { child, action: act, name: target, resolve }
        this.pluginPending = pending
        let stderrTail = ''
        child.stdout?.on('data', (d) => {
          const s = d.toString()
          this.emitPluginLog(s)
          this.log('info', s.trim())
        })
        child.stderr?.on('data', (d) => {
          const s = d.toString()
          stderrTail = (stderrTail + s).slice(-2000)
          this.emitPluginLog(s)
          this.log('warn', s.trim())
        })
        child.on('error', (e) => {
          if (this.pluginPending !== pending) return
          this.finishPlugin(pending, false, `子进程错误：${formatChildError(e)}`)
        })
        child.on('exit', (code) => {
          if (this.pluginPending !== pending) return // 已被 stop() 接管
          const ok = code === 0
          const error = ok
            ? undefined
            : `pnpm 退出码 ${code}${stderrTail.trim() ? `${stderrTail.trim()}` : ''}`
          this.finishPlugin(pending, ok, error)
        })
      })

    // `--dump-config` 只组合 patch 层（不 import 条目、不绑定端口），DSH 运行时
    // 也可安全执行；输出经闭包 preflightOutput 回传（finishPlugin 只带 ok/error）。
    let preflightOutput = ''
    const runPreflight = (): Promise<{ ok: boolean; error?: string }> =>
      new Promise((resolve) => {
        const child = spawn(
          process.execPath,
          ['--expose-internals', dshBin, '--profile', 'web', '--dump-config'],
          {
            cwd: home,
            env: { ...this.buildEnv(home), ELECTRON_RUN_AS_NODE: '1' },
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true,
          },
        )
        const pending = { child, action: 'add' as const, name: spec, resolve }
        this.pluginPending = pending
        const capture = (d: Buffer) => {
          preflightOutput = (preflightOutput + d.toString()).slice(-4000)
        }
        child.stdout?.on('data', capture)
        child.stderr?.on('data', capture)
        // 预检正常秒级；超时则 kill 整树兜底（与 plugin-manager 的 90s 一致）
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          killTree(child.pid)
        }, 90_000)
        child.on('error', (e) => {
          if (this.pluginPending !== pending) return
          clearTimeout(timer)
          this.finishPlugin(pending, false, `预检子进程错误：${formatChildError(e)}`)
        })
        child.on('exit', (code) => {
          if (this.pluginPending !== pending) return
          clearTimeout(timer)
          const ok = code === 0
          const tail = preflightOutput.trim()
          const error = ok
            ? undefined
            : timedOut
              ? '启动预检超时（60s）'
              : `启动预检失败（退出码 ${code}）${tail ? `\n${tail.slice(-1500)}` : ''}`
          this.finishPlugin(pending, ok, error)
        })
      })

    /** add 成功后的启动预检 + 自动回滚；返回最终结果（可能被预检改写为失败） */
    const preflightOrRollback = async (): Promise<{ ok: boolean; error?: string }> => {
      console.log('[dsh] 启动预检（--dump-config）…')
      this.log('info', '启动预检（--dump-config）…')
      this.emitPluginLog('\n[dsh] 启动预检（--dump-config）…\n')
      preflightOutput = ''
      const pre = await runPreflight()
      if (pre.ok) return { ok: true }
      // stop() 取消：不回滚、不改写错误
      if (pre.error?.includes('操作已取消')) return pre
      const tail = (preflightOutput.trim() || pre.error || '').trim()
      const newDeps = findNewDependencies(beforeDeps, this.readProfileDeps() ?? {})
      const culprit = matchCulprit(newDeps, tail)
      if (culprit.length > 0) {
        const name = culprit[0]
        console.warn(`[dsh] 启动预检失败，自动回滚 ${name}`)
        this.log('warn', `启动预检失败，自动回滚 ${name}`, tail)
        this.emitPluginLog(`\n[dsh] 启动预检失败，自动回滚 ${name}\n`)
        const rb = await runDshPlugin('remove', name)
        if (rb.ok) return { ok: false, error: `启动预检失败，已自动回滚 ${name}\n${tail}` }
        return {
          ok: false,
          error: `启动预检失败，且回滚 ${name} 失败（${rb.error ?? '未知错误'}）：${tail}`,
        }
      }
      const reason =
        beforeDeps === null ? '首次初始化无法比对依赖，未回滚' : '与本次安装无关，未回滚'
      this.log('error', `启动预检失败（${reason}）`, tail)
      this.emitPluginLog(`\n[dsh] 启动预检失败（${reason}）\n`)
      return { ok: false, error: `启动预检失败（${reason}）：${tail}` }
    }

    const runWithRetries = async (): Promise<{ ok: boolean; error?: string }> => {
      // 首次尝试
      let last = await runDshPlugin(action, spec)
      if (last.ok) return last

      // 1) ERR_PNPM_UNEXPECTED_STORE：旧 store（v10）链接的 node_modules 与 v11 不兼容，
      //    删除 node_modules 后重试（package.json 保留，pnpm 会重建）
      if (last.error?.includes('ERR_PNPM_UNEXPECTED_STORE')) {
        const nmDir = join(this.profileDir(), 'node_modules')
        if (existsSync(nmDir)) {
          console.log('[dsh] 检测到 pnpm store 格式升级，清理 node_modules 后重试')
          this.log('warn', '检测到 pnpm store 格式升级，清理 node_modules 后重试')
          this.emitPluginLog('\n[dsh] 检测到 pnpm store 格式升级，清理 node_modules 后重试\n')
          rmSync(nmDir, { recursive: true, force: true })
          last = await runDshPlugin(action, spec)
          if (last.ok) return last
        }
      }

      // 2) ERR_PNPM_IGNORED_BUILDS：解析全部被拦截包名，一次放行后重试
      const pkgs = parseIgnoredBuildPackages(last.error ?? '')
      if (pkgs.length > 0) {
        console.log(`[dsh] pnpm 拦截 build scripts，自动放行并重试: ${pkgs.join(', ')}`)
        this.log('warn', `pnpm 拦截 build scripts，自动放行并重试: ${pkgs.join(', ')}`, last.error)
        this.emitPluginLog(`\n[dsh] 自动重试：放行 build scripts ${pkgs.join(', ')}\n`)
        last = await runDshPlugin(
          action,
          spec,
          pkgs.map((p) => `--allow-build=${p}`),
        )
        if (last.ok) return last
      }

      // 3) 瞬时网络错误：原样重试一次
      if (
        /timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|FetchError|error \(\d+\)/i.test(last.error ?? '')
      ) {
        console.log('[dsh] 检测到瞬时网络错误，自动重试一次')
        this.log('warn', '检测到瞬时网络错误，自动重试一次', last.error)
        this.emitPluginLog('\n[dsh] 自动重试（瞬时网络错误）\n')
        last = await runDshPlugin(action, spec)
        if (last.ok) return last
      }

      // 4) 以上均失败且仍带被拦截构建脚本时，再次固化策略后重试。
      //    覆盖「占位符污染 yaml 且 --allow-build 又因策略漂移失效」的残余场景。
      if (!last.ok && pkgs.length > 0) {
        console.log('[dsh] 构建脚本仍被拦截，再次固化构建策略后重试')
        this.log('warn', '构建脚本仍被拦截，再次固化构建策略后重试', last.error)
        this.emitPluginLog('\n[dsh] 自动重试：重新固化 pnpm 构建策略\n')
        this.healProfileBuildPolicy()
        last = await runDshPlugin(action, spec)
      }

      return last
    }

    let result: { ok: boolean; error?: string } | null = null
    try {
      result = await runWithRetries()
      if (result.ok && action === 'add') {
        // G2/G3：落盘复核（兼容性/重复 patch id/import 预检），失败自动回滚
        const gate = await this.postInstallGates(beforeDeps)
        if (gate) {
          this.emitPluginLog(`\n[dsh] ${gate.error}\n`)
          if (gate.rollback) {
            this.log('warn', `${gate.error}，自动回滚 ${gate.rollback}`)
            const rb = await runDshPlugin('remove', gate.rollback)
            result = rb.ok
              ? { ok: false, error: `${gate.error}，已自动回滚 ${gate.rollback}` }
              : {
                  ok: false,
                  error: `${gate.error}；回滚 ${gate.rollback} 失败（${rb.error ?? '未知错误'}）`,
                }
          } else {
            result = { ok: false, error: gate.error }
          }
        } else {
          result = await preflightOrRollback()
        }
      }
    } finally {
      // 根治半成品状态：pnpm 失败时官方 reconcile 不执行，这里无论成败都补账
      // （回滚卸载后同样在此清掉残留的 bundles 条目）。
      this.reconcileBundles()
      // 卸载成功：同步清掉该包相关的隔离台账记录（entry 可能是子路径形式
      if (action === 'remove' && result?.ok) {
        const ledger = this.readQuarantineLedger().filter(
          (r) => r.name !== spec && !(r.name && r.name.startsWith(`${spec}/`)),
        )
        this.writeQuarantineLedger(ledger)
      }
    }
    if (!result) return { ok: false, error: '插件操作异常中断' }
    this.emitPluginDone({ action, name: spec, ok: result.ok, error: result.error })
    return result
  }

  /** 读取 profile package.json 的 dependencies；不存在/不可读返回 null（不参与预检 diff） */
  private readProfileDeps(): Record<string, unknown> | null {
    try {
      const p = join(this.profileDir(), 'package.json')
      if (!existsSync(p)) return null
      const manifest = JSON.parse(readFileSync(p, 'utf8')) as {
        dependencies?: Record<string, unknown>
      }
      return manifest.dependencies ?? {}
    } catch {
      return null
    }
  }

  // -----------------------------------------------------------------
  // 插件安全门（G1 预检 / G2 复核 / G3 import 预检 / S 启动崩溃隔离）
  // -----------------------------------------------------------------

  /** 包目录解析（profile node_modules 优先，其次安装目录 node_modules）；不可解析返回 null */
  private resolvePackageDir(name: string): string | null {
    const anchors = [
      join(this.profileDir(), 'node_modules', name),
      join(this.resolvePaths().base, 'node_modules', name),
    ]
    return anchors.find((dir) => existsSync(join(dir, 'package.json'))) ?? null
  }

  /** 读取已落盘包的 package.json；不存在/不可读返回 null */
  private readPackageManifest(name: string): Record<string, unknown> | null {
    const dir = this.resolvePackageDir(name)
    if (!dir) return null
    try {
      return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<string, unknown>
    } catch {
      return null
    }
  }

  /** 运行时包版本解析（G1/G2 peer 复核用）：base/profile node_modules 任一命中 */
  private resolveRuntimePackageVersion(pkgName: string): string | null {
    const manifest = this.readPackageManifest(pkgName)
    const v = manifest?.version
    return typeof v === 'string' && v ? v : null
  }

  /**
   * 从 npm registry 取插件 manifest（G1 预检用）。
   * version 为精确版本或 dist-tag 时直取对应 manifest；range（^ ~ 等）URL 直取时
   * 退化为 latest。网络不可达/404 返回 null（fail-open，交给 pnpm 阶段自然失败）。
   */
  private async fetchRegistryManifest(
    name: string,
    version?: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const base = `https://registry.npmjs.org/${name.replace('/', '%2F')}`
      // registry 只支持精确版本与 dist-tag 的路径；range 含运算符无法直取
      const ref = version && /^[A-Za-z0-9._-]+$/.test(version) ? version : 'latest'
      const r = await fetch(`${base}/${ref}`, { signal: AbortSignal.timeout(10_000) })
      if (!r.ok) return null
      return (await r.json()) as Record<string, unknown>
    } catch {
      return null
    }
  }

  /** 读取隔离台账（DSH home/zdn-quarantine.json）；不存在/损坏返回空数组 */
  private readQuarantineLedger(): QuarantineRecord[] {
    try {
      const p = join(this.resolvePaths().home, 'zdn-quarantine.json')
      return parseQuarantineLedger(existsSync(p) ? readFileSync(p, 'utf8') : null)
    } catch {
      return []
    }
  }

  private writeQuarantineLedger(records: QuarantineRecord[]): void {
    try {
      writeFileSync(
        join(this.resolvePaths().home, 'zdn-quarantine.json'),
        JSON.stringify(records, null, 2),
      )
    } catch (e) {
      this.log('error', '隔离台账写入失败', e instanceof Error ? e.message : String(e))
    }
  }

  /** 台账 upsert（按 entryId）；隔离块已存在时也补账，保证列表可见 */
  private recordQuarantine(record: QuarantineRecord): void {
    const ledger = this.readQuarantineLedger().filter((r) => r.entryId !== record.entryId)
    ledger.push(record)
    this.writeQuarantineLedger(ledger)
  }

  /**
   * 把启动失败归因到可隔离的 entry：核心包（@deepseek-ai/*）与 cordis Include
   * 包装层绝不隔离；pending 类只有 name 时经 patch 扫描映射到 entry id。
   */
  private resolveQuarantineTarget(failure: BootFailure): { entryId: string; name?: string } | null {
    const name = failure.entryName
    if (name?.startsWith('@deepseek-ai/')) return null
    if (failure.entryId) {
      if (failure.entryId === 'include') return null
      return { entryId: failure.entryId, name }
    }
    if (!name) return null
    const id = this.findEntryIdByName(name)
    return id ? { entryId: id, name } : null
  }

  /** 从 profile cordis.patch.yml + 各 bundle patch 扫描 insert 的 name → id 映射 */
  private findEntryIdByName(name: string): string | null {
    const paths: string[] = [join(this.profileDir(), 'cordis.patch.yml')]
    try {
      const manifest = JSON.parse(
        readFileSync(join(this.profileDir(), 'package.json'), 'utf8'),
      ) as {
        dsh?: { profile?: { bundles?: string[] } }
      }
      for (const b of manifest?.dsh?.profile?.bundles ?? []) {
        const dir = this.resolvePackageDir(b)
        if (!dir) continue
        try {
          const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as {
            dsh?: { bundle?: { patch?: string } }
          }
          const rel = pkg?.dsh?.bundle?.patch
          if (typeof rel === 'string' && rel) paths.push(join(dir, rel))
        } catch {
          /* bundle manifest 不可读则跳过 */
        }
      }
    } catch {
      /* profile manifest 不可读则只扫 profile patch */
    }
    for (const p of paths) {
      let text: string
      try {
        text = existsSync(p) ? readFileSync(p, 'utf8') : ''
      } catch {
        continue
      }
      if (!text) continue
      for (const e of collectPatchEntries(text)) {
        // name 可能是 entry 的子路径导出（@scope/pkg/sub）：归到该 entry
        if (e.name === name || (e.name && name.startsWith(`${e.name}/`))) return e.id
      }
    }
    return null
  }

  /**
   * 写隔离块到 profile cordis.patch.yml（幂等：已有该 entryId 块只补台账）+ 更新台账。
   * 后置的 `disabled: true` 条目按 id 覆盖先前声明，loader 直接不加载该 entry。
   */
  private applyQuarantine(entryId: string, name: string | undefined, reason: string): boolean {
    if (name?.startsWith('@deepseek-ai/') || entryId === 'include') return false
    const patchPath = join(this.profileDir(), 'cordis.patch.yml')
    let text: string
    try {
      text = existsSync(patchPath) ? readFileSync(patchPath, 'utf8') : ''
    } catch {
      text = ''
    }
    const record: QuarantineRecord = { entryId, name, reason: reason.slice(0, 500), at: Date.now() }
    if (!hasQuarantineBlock(text, entryId)) {
      try {
        writeFileSync(patchPath, `${text.trimEnd()}\n\n${renderQuarantineBlock(entryId)}`)
      } catch (e) {
        this.log(
          'error',
          `隔离块写入失败（${entryId}）`,
          e instanceof Error ? e.message : String(e),
        )
        return false
      }
    }
    this.recordQuarantine(record)
    return true
  }

  /** 恢复被自动隔离的 entry：移除 patch 里的隔离块 + 清台账。重启 DSH 后生效。 */
  restoreQuarantine(entryId: string): { ok: boolean; error?: string } {
    if (!entryId || entryId.startsWith('-'))
      return { ok: false, error: `非法的 entry id: ${entryId}` }
    try {
      const patchPath = join(this.profileDir(), 'cordis.patch.yml')
      if (existsSync(patchPath)) {
        const raw = readFileSync(patchPath, 'utf8')
        const next = removeQuarantineBlocks(raw, entryId)
        if (next !== raw) writeFileSync(patchPath, next)
      }
      this.writeQuarantineLedger(this.readQuarantineLedger().filter((r) => r.entryId !== entryId))
      this.log('info', `已恢复被隔离的插件入口 ${entryId}（重启 DSH 后生效）`)
      return { ok: true }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * G3 import 预检：以与生产一致的 run-as-node + --expose-internals 方式
   * `await import('<pkg>')`（cwd=profile，解析 hoisted 直依赖），验证包可被
   * loader 导入（捕获 patch 声明缺失、入口文件缺失等安装期问题）。
   */
  private runImportProbe(pkgName: string): Promise<{ ok: boolean; error?: string }> {
    const { home } = this.resolvePaths()
    const profileDir = this.profileDir()
    return new Promise((resolve) => {
      const child = spawn(
        process.execPath,
        [
          '--expose-internals',
          '--input-type=module',
          '-e',
          `await import(${JSON.stringify(pkgName)})`,
        ],
        {
          cwd: profileDir,
          env: { ...this.buildEnv(home), ELECTRON_RUN_AS_NODE: '1' },
          stdio: ['ignore', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )
      let output = ''
      const capture = (d: Buffer) => {
        output = (output + d.toString()).slice(-2000)
      }
      child.stdout?.on('data', capture)
      child.stderr?.on('data', capture)
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        killTree(child.pid)
      }, 30_000)
      child.on('error', (e) => {
        clearTimeout(timer)
        resolve({ ok: false, error: `导入预检子进程错误：${formatChildError(e)}` })
      })
      child.on('exit', (code) => {
        clearTimeout(timer)
        if (code === 0) resolve({ ok: true })
        else {
          resolve({
            ok: false,
            error: timedOut
              ? '导入预检超时（60s）'
              : `导入预检失败（退出码 ${code}）${output.trim() ? `\n${output.trim().slice(-1000)}` : ''}`,
          })
        }
      })
    })
  }

  /**
   * G2：add 成功后的复核链（对每个新增依赖）：
   * a. 已落盘 manifest 复核兼容性（覆盖 git spec / registry 版本漂移）
   * b. 新包 patch 的 entry id 不得与 profile / 其它 bundle 重复（DSH 按 id 匹配 patch，重复会静默互相覆盖）
   * c. import 预检（G3）
   * 返回 null = 全部通过；否则带 rollback（要回滚的包名）与错误描述。
   */
  private async postInstallGates(
    beforeDeps: Record<string, unknown> | null,
  ): Promise<{ error: string; rollback?: string } | null> {
    const afterDeps = this.readProfileDeps() ?? {}
    const newDeps = findNewDependencies(beforeDeps, afterDeps)
    if (newDeps.length === 0) return null // 首次初始化：无法定位新装包，跳过（preflight 仍会跑）
    for (const name of newDeps) {
      const installed = this.readPackageManifest(name)
      if (installed) {
        const issues = checkPluginCompatibility({
          manifest: installed,
          dshVersion: this.version(),
          nodeVersion: process.versions.node,
          resolveRuntimePackageVersion: (n) => this.resolveRuntimePackageVersion(n),
        })
        if (issues.length > 0)
          return { error: `插件不兼容（${issues.join('；')}）`, rollback: name }
      }
      const dup = this.findDuplicatePatchIds(name)
      if (dup) return { error: dup, rollback: name }
      console.log(`[dsh] 导入预检（import ${name}）…`)
      const probe = await this.runImportProbe(name)
      if (!probe.ok) {
        return { error: `插件导入预检失败：${probe.error ?? '未知错误'}`, rollback: name }
      }
    }
    return null
  }

  /** G2b：新包 patch 的 entry id 与 profile / 其它 bundle 的重复检测 */
  private findDuplicatePatchIds(newName: string): string | null {
    const readText = (p: string): string | null => {
      try {
        return existsSync(p) ? readFileSync(p, 'utf8') : null
      } catch {
        return null
      }
    }
    const dir = this.resolvePackageDir(newName)
    if (!dir) return null
    const pkgRaw = readText(join(dir, 'package.json'))
    if (!pkgRaw) return null
    let patchRel = './cordis.patch.yml'
    try {
      const rel = (JSON.parse(pkgRaw) as { dsh?: { bundle?: { patch?: string } } })?.dsh?.bundle
        ?.patch
      if (typeof rel === 'string' && rel) patchRel = rel
    } catch {
      return null
    }
    const newIds = collectPatchEntryIds(readText(join(dir, patchRel)) ?? '')
    if (newIds.length === 0) return null
    const existing = new Set<string>(
      collectPatchEntryIds(readText(join(this.profileDir(), 'cordis.patch.yml')) ?? ''),
    )
    try {
      const manifest = JSON.parse(
        readFileSync(join(this.profileDir(), 'package.json'), 'utf8'),
      ) as {
        dsh?: { profile?: { bundles?: string[] } }
      }
      for (const b of manifest?.dsh?.profile?.bundles ?? []) {
        if (b === newName) continue
        const bdir = this.resolvePackageDir(b)
        if (!bdir) continue
        const bRaw = readText(join(bdir, 'package.json'))
        if (!bRaw) continue
        let bRel = './cordis.patch.yml'
        try {
          const rel = (JSON.parse(bRaw) as { dsh?: { bundle?: { patch?: string } } })?.dsh?.bundle
            ?.patch
          if (typeof rel === 'string' && rel) bRel = rel
        } catch {
          continue
        }
        for (const id of collectPatchEntryIds(readText(join(bdir, bRel)) ?? '')) existing.add(id)
      }
    } catch {
      /* profile manifest 不可读：只比 profile patch */
    }
    const dup = newIds.filter((id) => existing.has(id))
    return dup.length > 0 ? `patch id 冲突：${dup.join(', ')} 已被现有 bundle 占用` : null
  }

  private finishPlugin(
    pending: NonNullable<DshManager['pluginPending']>,
    ok: boolean,
    error?: string,
  ): void {
    if (this.pluginPending !== pending) return
    this.pluginPending = null
    if (!ok) {
      this.log('error', `插件操作 ${pending.action} ${pending.name} 失败`, error)
      console.error(`[dsh] plugin ${pending.action} ${pending.name} 失败:`, error)
    } else {
      this.log('info', `插件操作 ${pending.action} ${pending.name} 成功`)
    }
    pending.resolve(ok ? { ok: true } : { ok: false, error })
  }
}

export const dshManager = DshManager.getInstance()
