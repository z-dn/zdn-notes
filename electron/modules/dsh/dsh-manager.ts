import { app, utilityProcess, type UtilityProcess } from 'electron'
import { delimiter, join } from 'path'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { createServer, type AddressInfo } from 'net'
import {
  computeBundleSync,
  isValidPluginSpec,
  parseIgnoredBuildPackages,
  parseInstalledPlugins,
  shouldRebuildWebProfile,
  type DshPluginInfo,
} from './plugin-spec'
import { resolveSidebarShellOverride } from './shell-resolve'
import { expandPathVars, mergePathDirs } from './path-env'

// ===================================================================
// DshManager —— 主进程内管理 DSH Web UI 子进程的生命周期。
//
// 关键架构（见 docs/dsh-integration-plan.md）：
//   - DSH 官方是 Web UI：`dsh web` 在 loopback 起一个本地 HTTP 服务（默认 127.0.0.1:3080）。
//   - DSH 服务端跑在 Electron 的 utilityProcess 子进程里（utilityProcess.fork 直接加载
//     @deepseek-ai/dsh 的 bin.js，Electron 内置 Node 24 与 DSH 要求 `^22.19 || >=24` 兼容），
//     不再随包分发独立 node.exe；`dsh web` 是普通 HTTP 服务，**不需要 TTY**。
//   - 渲染层用 <webview> 加载 http://127.0.0.1:<port> 展示官方 Web UI。
//   - node_modules / pnpm.exe / 配置（DSH_HOME）随包分发，零系统依赖。
//   - 端口由主进程预占空闲 loopback 端口后以 --port 传入（不再解析 stdout），
//     fork 后立即对已知端口做 HTTP 探测，省掉「等 DSH 回显端口」的往返。
//
// 就绪判定：对预留端口做 HTTP 探测确认真正可服务。
// 状态变化通过 onChange 推给模块层（ctx.send → 'dsh:statusChanged'）。
// ===================================================================

export interface DshStatus {
  running: boolean
  port?: number
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

interface ResolvedPaths {
  base: string
  dshBin: string
  home: string
}

/** 启动总超时：端口解析 + HTTP 就绪探测共用（首次重建 web profile 需 pnpm 安装，留足余量） */
const START_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 2_000

/**
 * 格式化 utilityProcess 的 'error' 事件参数（V8 FatalError 时可能带 Node diagnostic report）。
 * Electron 类型对 'error' 只标了 'FatalError' 字面量，运行期 payload 为 { type, location, report }，
 * 这里按 unknown 防御性提取。
 */
function formatUtilityError(d: unknown): string {
  if (typeof d !== 'object' || d === null) return String(d)
  const o = d as { type?: unknown; location?: unknown; report?: unknown }
  const parts: string[] = []
  if (typeof o.type === 'string' && o.type) parts.push(o.type)
  if (typeof o.location === 'string' && o.location) parts.push(o.location)
  if (typeof o.report === 'string' && o.report) parts.push(o.report)
  return parts.join('\n') || '未知错误'
}

let cachedFullPath: string | null = null
/**
 * 从注册表读取系统+用户 PATH 并展开 %VAR%（进程内缓存）。
 * 应用可能被裁剪 PATH 的环境启动（opencode 桌面子进程不含系统/用户 PATH），
 * 导致 DSH server 缺 git / vfox 等工具目录；这里兜底补全。
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
  cachedFullPath = expandPathVars(parts.join(';'), process.env as Record<string, string | undefined>)
  return cachedFullPath
}

class DshManager {
  private static _inst: DshManager | null = null
  static getInstance(): DshManager {
    if (!this._inst) this._inst = new DshManager()
    return this._inst
  }

  private child: UtilityProcess | null = null
  private port: number | null = null
  private dataDir = ''
  private listeners = new Set<StatusListener>()
  private pluginLogListeners = new Set<PluginLogListener>()
  private pluginDoneListeners = new Set<PluginDoneListener>()
  private pluginPending:
    | {
        child: UtilityProcess
        action: 'add' | 'remove'
        name: string
        resolve: (r: { ok: boolean; error?: string }) => void
      }
    | null = null

  init(opts: { dataDir: string }): void {
    this.dataDir = opts.dataDir
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

  private emitPluginDone(result: DshPluginDone): void {
    for (const l of this.pluginDoneListeners) {
      try {
        l(result)
      } catch {
        /* noop */
      }
    }
  }

  /**
   * 定位 DSH 运行时根目录（含 node_modules/@deepseek-ai/dsh 与 bin/pnpm.exe）。
   * 打包后固定为 resourcesPath/dsh；dev 下 app.getAppPath()/cwd 已是仓库根直接命中，
   * __dirname 在构建产物里（out/main/...）向上数层找 resources/dsh。
   */
  private findBase(): string {
    const env = process.env
    if (app.isPackaged) return join(process.resourcesPath, 'dsh')
    if (env.DSH_DEV_DIR && existsSync(join(env.DSH_DEV_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))) {
      return env.DSH_DEV_DIR
    }

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
      // 会穿透清空 base，见 AGENTS.md dev 陷阱）与「从未 build 过」，给可操作提示
      const dshPkgDir = join(join(this.findBase(), 'node_modules', '@deepseek-ai', 'dsh'))
      if (existsSync(dshPkgDir)) {
        return {
          ready: false,
          reason: `本地 DSH 运行时被清空（${dshPkgDir}），可能由递归删除 DSH home 穿透 junction 导致，请运行 npm run build:dsh 恢复`,
        }
      }
      return { ready: false, reason: `未找到 DSH 入口: ${dshBin}（开发环境请运行 npm run build:dsh）` }
    }
    return { ready: true }
  }

  /**
   * 启动自愈（app 启动时执行，先于任何用户操作）：
   * 1. store 清理：pnpm 大版本升级（v10→v11）后旧 store 链接的 node_modules 不兼容，
   *    读 node_modules/.modules.yaml 的 packageManager 主版本，不同则清理
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
   * - dangerouslyAllowAllBuilds: true → 所有依赖的 preinstall/install/postinstall 自动执行，
   *   不再报 ERR_PNPM_IGNORED_BUILDS，也不再被写进 allowBuilds 的占位符污染。
   * - minimumReleaseAge: 0 → 关闭 24h 发布龄供应链门槛（pnpm 11 默认 1440 分钟，会拒绝刚发布的插件）。
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

  /** 与 DSH resolveBundleDir 同语义：两个锚点任一可解析出 dsh.bundle 声明即为合法层 */
  private isResolvableBundle(name: string): boolean {
    const anchors = [
      join(this.profileDir(), 'node_modules', name, 'package.json'),
      join(this.resolvePaths().base, 'node_modules', name, 'package.json'),
    ]
    for (const p of anchors) {
      try {
        if (!existsSync(p)) continue
        const pkg = JSON.parse(readFileSync(p, 'utf8')) as {
          dsh?: { bundle?: { patch?: unknown } }
        }
        if (pkg.dsh?.bundle?.patch !== undefined) return true
      } catch {
        /* 读坏文件视为不可解析 */
      }
    }
    return false
  }

  /**
   * 双向对齐 dependencies 与 dsh.profile.bundles（根治「pnpm 失败后 reconcile
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
   * 构建 DSH 子进程环境：继承应用环境但清掉 Electron 注入的运行期变量
   * （NODE_OPTIONS / ELECTRON_RUN_AS_NODE / ELECTRON_*），避免污染 utilityProcess
   * 里的纯 Node 运行时；再设 DSH 所需项。extra 由调用方按用途追加（server/插件共用）。
   */
  private buildEnv(home: string, extra: Record<string, string> = {}): Record<string, string> {
    const { base } = this.resolvePaths()
    const env: Record<string, string> = { ...(process.env as Record<string, string>), ...extra }
    delete env.NODE_OPTIONS
    delete env.ELECTRON_RUN_AS_NODE
    for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_')) delete env[k]
    env.DSH_HOME = home
    env.NODE_PATH = join(base, 'node_modules')
    // pnpm 生命周期脚本（node buildcheck.js / node-gyp rebuild 等）需要 PATH 上有 `node`：
    // 用 electron-as-node 垫片充当（零额外二进制、ABI 与 DSH 运行时同为 Electron Node、GUI 子系统不开控制台窗口）。
    // node-bin 前置、bin（pnpm.exe）次之；末尾合并系统+用户注册表 PATH，补全被启动上下文裁剪的工具目录
    // （git / vfox 等，否则终端 vfox 报错、git 面板认不出仓库——已实测 opencode 子进程 PATH 缺这两者）。
    const nodeBin = this.ensureNodeShim(home)
    const merged = mergePathDirs(env.PATH ?? '', fullUserPath())
    env.PATH = `${nodeBin}${delimiter}${join(base, 'bin')}${delimiter}${merged}`
    // 兼容性加固：dsh-better-sidebar 的 defaultShell 会命中 Store 的
    // WindowsApps pwsh 别名桩（0 字节 reparse point），node-pty 无法 spawn，
    // 终端报 "File not found"。此处把它解析为确定可用的 shell。
    // 用户显式 config.shell / 已设的 DSH_SIDEBAR_SHELL 优先级更高，不受影响。
    if (!(env.DSH_SIDEBAR_SHELL && env.DSH_SIDEBAR_SHELL.trim())) {
      const sidebarShell = resolveSidebarShellOverride()
      if (sidebarShell) env.DSH_SIDEBAR_SHELL = sidebarShell
    }
    return env
  }

  /**
   * 确保 `node` 垫片存在：在 DSH home 下生成 node.cmd，把 `node` 解析到应用自身
   * （process.execPath）以 ELECTRON_RUN_AS_NODE 模式充当纯 Node 运行。幂等：
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

  /** 主进程预占一个空闲 loopback 端口（net 层完成，无 stdout 解析竞态） */
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
  ): Promise<{ ok: boolean; port?: number; error?: string }> {
    if (this.child) return { ok: true, port: this.port ?? undefined }
    const { dshBin, home } = this.resolvePaths()
    if (!existsSync(dshBin)) return { ok: false, error: `未找到 DSH 入口: ${dshBin}` }
    try {
      mkdirSync(home, { recursive: true })
      const apiKey = opts?.apiKey || process.env.DEEPSEEK_API_KEY || ''
      const extra: Record<string, string> = { TERM: 'xterm-256color' }
      if (apiKey) extra.DEEPSEEK_API_KEY = apiKey
      if (opts?.model) extra.DSH_MODEL = opts.model
      const env = this.buildEnv(home, extra)

      // 主进程预占空闲 loopback 端口，fork 后立即对已知端口探测，免去「等回显」往返
      const port = await this.reservePort()
      this.port = port
      this.emit()
      console.log('[dsh] 启动: utilityProcess', dshBin, `--profile web --no-open --port ${port}`)
      const child = utilityProcess.fork(
        dshBin,
        ['--profile', 'web', '--no-open', '--port', String(port)],
        {
          cwd: home,
          env,
          stdio: 'pipe',
          serviceName: 'zdn-dsh',
          // DSH 的 cordis-plugin-loader 需要访问 Node 内部模块（internal/modules/esm/loader）。
          // Electron 的 Node 不暴露 node-addon-require-builtin 依赖的 V8 符号，必须显式
          // 传入 --expose-internals 走 loader 的 execArgv 分支。
          execArgv: ['--expose-internals'],
        },
      )
      this.child = child

      let stderrBuf = ''
      child.on('error', (e) => {
        stderrBuf += formatUtilityError(e) + '\n'
        if (this.child === child) {
          this.child = null
          this.port = null
          this.emit()
        }
        console.error('[dsh] 启动失败:', formatUtilityError(e))
      })
      child.stderr?.on('data', (d) => {
        const msg = d.toString()
        stderrBuf += msg
        const line = msg.trim()
        if (line) console.error('[dsh:stderr]', line)
      })
      child.on('exit', (code) => {
        if (this.child !== child) return // 已被 stop() 主动接管
        this.child = null
        this.port = null
        this.emit()
        if (code && code !== 0) console.warn(`[dsh] Web UI 退出 code=${code}`)
      })

      // 等真实 spawn 后再起超时窗口，避免 fork/模块加载前的空转计入
      await new Promise<void>((resolve) => {
        child.once('spawn', () => resolve())
        child.once('exit', () => resolve())
      })

      // 等待「HTTP 探测通过」，总超时 START_TIMEOUT_MS
      const deadline = Date.now() + START_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (this.child !== child) {
          // 子进程在启动期内意外退出：多半是 web profile 损坏/不兼容
          // （bundles 缺少核心 web 包 @deepseek-ai/dsh-web-app → webServer 服务未注册）。
          // 按 manifest 判定是否重建（物理 node_modules 路径在此部署下恒不存在，
          // 按物理路径判断会误删用户插件）：仅 bundles 缺失核心包或 manifest 不可读时重建一次。
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
                console.warn('[dsh] web profile 缺少核心包 @deepseek-ai/dsh-web-app，已重建并自动重试')
              } catch (e) {
                console.error('[dsh] 清理损坏的 web profile 失败:', e)
              }
              return this.start(opts, true)
            }
          }
          // 无核心包缺失但启动即退：多为预留端口被抢占（TOCTOU），换新端口重试一次
          if (!portRetried) {
            console.warn('[dsh] 启动后立即退出，换端口重试一次')
            return this.start(opts, false, true)
          }
          const detail = stderrBuf.trim().split('\n').slice(-12).join('\n')
          return {
            ok: false,
            error: `DSH Web UI 进程启动后立即退出（可能 profile 配置错误）\n${detail}`,
          }
        }
        if (this.port && (await this.probe(this.port))) {
          this.emit()
          return { ok: true, port: this.port }
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      await this.stop()
      const detail = stderrBuf.trim().split('\n').slice(-12).join('\n')
      return {
        ok: false,
        error: `DSH 启动超时（${START_TIMEOUT_MS / 1000}s 未就绪）\n${detail}`,
      }
    } catch (e) {
      await this.stop()
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 停止。utilityProcess.kill() 会连带终止整棵进程树（含 node-pty 派生的 pwsh 孙进程，
   * 已实测），无需 taskkill；应用退出时 Electron 也会自动回收 utility 进程。
   * 同时终止进行中的插件操作子进程。
   */
  async stop(): Promise<void> {
    const pending = this.pluginPending
    if (pending) {
      try {
        pending.child.kill()
      } catch {
        /* noop */
      }
      this.finishPlugin(pending, false, '操作已取消（DSH 正在停止）')
    }
    const child = this.child
    if (!child) return
    this.child = null
    this.port = null
    this.emit()
    try {
      child.kill()
    } catch {
      /* noop */
    }
  }

  status(): DshStatus {
    return { running: !!this.child, port: this.child ? this.port ?? undefined : undefined }
  }

  // -----------------------------------------------------------------
  // 插件管理：`dsh plugin` 本质是 pnpm 转发器（硬编码 spawnSync("pnpm")），
  // 因此把自带 pnpm.exe 所在目录前置进子进程 PATH 即可离系统依赖运行。
  // 对账逻辑保证「用户装的插件 = profile package.json 的 dependencies」，
  // 列表读取无需解析 dsh.profile（YAML）。
  // -----------------------------------------------------------------

  private profileDir(): string {
    return join(this.resolvePaths().home, 'profiles', 'web')
  }

  async listPlugins(): Promise<{
    ok: boolean
    plugins?: Array<DshPluginInfo & { active?: boolean }>
    error?: string
  }> {
    const ready = this.isReady()
    if (!ready.ready) return { ok: false, error: ready.reason }
    const pkgPath = join(this.profileDir(), 'package.json')
    if (!existsSync(pkgPath)) return { ok: true, plugins: [] } // 尚未初始化/未装过
    try {
      const manifest = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
        dependencies?: Record<string, string>
        dsh?: { profile?: { bundles?: string[] } }
      }
      const bundles = new Set(manifest.dsh?.profile?.bundles ?? [])
      const plugins = parseInstalledPlugins(readFileSync(pkgPath, 'utf8')).map((p) => ({
        ...p,
        // 未进 bundles = 安装中断（reconcile 未执行），DSH 不会加载
        active: bundles.has(p.name),
      }))
      return { ok: true, plugins }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 安装/卸载插件。spec 作为单个 argv 元素原样转发（已过 isValidPluginSpec 校验）。
   * 首次调用时 CLI 会自动从随包模板初始化 web profile。
   * 自动修复链（按序尝试，任一成功即止）：
   * 1. ERR_PNPM_UNEXPECTED_STORE → 清理旧 store 的 node_modules 后重试
   * 2. ERR_PNPM_IGNORED_BUILDS → 解析全部被拦截包名，--allow-build 放行后重试
   * 3. 瞬时网络错误 → 原样重试一次
   * 无论成败，结束后 reconcileBundles() 补账（根治「依赖已记录但 bundle 层缺失」）。
   */
  async pluginAction(action: 'add' | 'remove', spec: string): Promise<{ ok: boolean; error?: string }> {
    if (this.pluginPending) return { ok: false, error: '已有插件操作进行中，请稍候' }
    const ready = this.isReady()
    if (!ready.ready) return { ok: false, error: ready.reason }
    if (!isValidPluginSpec(spec)) return { ok: false, error: `非法的插件标识: ${spec}` }

    const { dshBin, home } = this.resolvePaths()
    mkdirSync(home, { recursive: true })
    // profile 已存在时先固化 pnpm 构建策略，让首次尝试就不被 build-scripts 拦截
    this.healProfileBuildPolicy()
    // 注：pnpm 11 不再读取 npm_config_*，发布龄/构建策略统一由 healProfileBuildPolicy
    // 写入 profile 的 pnpm-workspace.yaml（minimumReleaseAge: 0 + dangerouslyAllowAllBuilds: true）。
    console.log(`[dsh] plugin ${action}:`, spec)

    const runOnce = (extraArgs: string[]): Promise<{ ok: boolean; error?: string }> =>
      new Promise((resolve) => {
        const child = utilityProcess.fork(
          dshBin,
          ['plugin', '--profile', 'web', action, spec, ...extraArgs],
          {
            cwd: home,
            env: this.buildEnv(home),
            stdio: 'pipe',
            serviceName: 'zdn-dsh-plugin',
            execArgv: ['--expose-internals'],
          },
        )
        const pending = { child, action, name: spec, resolve }
        this.pluginPending = pending
        let stderrTail = ''
        child.stdout?.on('data', (d) => this.emitPluginLog(d.toString()))
        child.stderr?.on('data', (d) => {
          const s = d.toString()
          stderrTail = (stderrTail + s).slice(-2000)
          this.emitPluginLog(s)
        })
        child.on('error', (e) => {
          if (this.pluginPending !== pending) return
          this.finishPlugin(pending, false, `utility 进程错误: ${formatUtilityError(e)}`)
        })
        child.on('exit', (code) => {
          if (this.pluginPending !== pending) return // 已被 stop() 接管
          const ok = code === 0
          const error = ok
            ? undefined
            : `pnpm 退出码 ${code}${stderrTail.trim() ? `：${stderrTail.trim()}` : ''}`
          this.finishPlugin(pending, ok, error)
        })
      })

    try {
      // 首次尝试
      let last = await runOnce([])
      if (last.ok) return last

      // 1) ERR_PNPM_UNEXPECTED_STORE：旧 store（v10）链接的 node_modules 与 v11 不兼容，
      //    删除 node_modules 后重试（package.json 保留，pnpm 会重建）。
      if (last.error?.includes('ERR_PNPM_UNEXPECTED_STORE')) {
        const nmDir = join(this.profileDir(), 'node_modules')
        if (existsSync(nmDir)) {
          console.log('[dsh] 检测到 pnpm store 格式升级，清理 node_modules 后重试')
          this.emitPluginLog('\n[dsh] 检测到 pnpm store 格式升级，清理 node_modules 后重试\n')
          rmSync(nmDir, { recursive: true, force: true })
          last = await runOnce([])
          if (last.ok) return last
        }
      }

      // 2) ERR_PNPM_IGNORED_BUILDS：解析全部被拦截包名，一次放行后重试
      const pkgs = parseIgnoredBuildPackages(last.error ?? '')
      if (pkgs.length > 0) {
        console.log(`[dsh] pnpm 拦截了 build scripts，自动放行并重试: ${pkgs.join(', ')}`)
        this.emitPluginLog(`\n[dsh] 自动重试：放行 build scripts ${pkgs.join(', ')}\n`)
        last = await runOnce(pkgs.map((p) => `--allow-build=${p}`))
        if (last.ok) return last
      }

      // 3) 瞬时网络错误：原样重试一次
      if (/timeout|ETIMEDOUT|ECONNRESET|EAI_AGAIN|FetchError|error \(\d+\)/i.test(last.error ?? '')) {
        console.log('[dsh] 检测到瞬时网络错误，自动重试一次')
        this.emitPluginLog('\n[dsh] 自动重试（瞬时网络错误）\n')
        last = await runOnce([])
        if (last.ok) return last
      }

      // 4) 以上均失败且仍带被拦截构建脚本时，再次固化策略后重试，
      //    覆盖「占位符污染 yaml、--allow-build 又因策略漂移失效」的残余场景。
      if (!last.ok && pkgs.length > 0) {
        console.log('[dsh] 构建脚本仍被拦截，再次固化构建策略后重试')
        this.emitPluginLog('\n[dsh] 自动重试：重新固化 pnpm 构建策略\n')
        this.healProfileBuildPolicy()
        last = await runOnce([])
      }

      return last
    } finally {
      // 根治半成品状态：pnpm 失败时官方 reconcile 不执行，这里无论成败都补账
      this.reconcileBundles()
    }
  }

  private finishPlugin(
    pending: NonNullable<DshManager['pluginPending']>,
    ok: boolean,
    error?: string,
  ): void {
    if (this.pluginPending !== pending) return
    this.pluginPending = null
    if (!ok) console.error(`[dsh] plugin ${pending.action} ${pending.name} 失败:`, error)
    this.emitPluginDone({ action: pending.action, name: pending.name, ok, error })
    pending.resolve(ok ? { ok: true } : { ok: false, error })
  }
}

export const dshManager = DshManager.getInstance()
