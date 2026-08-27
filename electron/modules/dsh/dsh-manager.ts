import { app } from 'electron'
import { delimiter, join } from 'path'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { spawn, spawnSync, type ChildProcess } from 'child_process'
import {
  computeBundleSync,
  isValidPluginSpec,
  parseIgnoredBuildPackages,
  parseInstalledPlugins,
  type DshPluginInfo,
} from './plugin-spec'

// ===================================================================
// DshManager —— 主进程内管理 DSH Web UI 子进程的生命周期。
//
// 关键架构（见 docs/dsh-integration-plan.md）：
//   - DSH 官方是 Web UI：`dsh web` 在 loopback 起一个本地 HTTP 服务（默认 127.0.0.1:3080）。
//   - 应用自带 console-subsystem 的 node.exe（resources/dsh）来跑 `dsh web` 服务端，
//     与系统 Node 完全隔离；`dsh web` 是普通 HTTP 服务，**不需要 TTY**（区别于 TUI 方案）。
//   - 渲染层用 <webview> 加载 http://127.0.0.1:<port> 展示官方 Web UI。
//   - node.exe / node_modules / 配置（DSH_HOME）全部随包分发，零系统依赖。
//
// 就绪判定：stdout/stderr 解析端口（宽松匹配 + 忽略 0）后，
// 再对 http://127.0.0.1:<port> 做 HTTP 探测确认真正可服务。
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
  nodeBin: string
  dshBin: string
  home: string
}

/** 启动总超时：端口解析 + HTTP 就绪探测共用（首次重建 web profile 需 pnpm 安装，留足余量） */
const START_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 2_000

class DshManager {
  private static _inst: DshManager | null = null
  static getInstance(): DshManager {
    if (!this._inst) this._inst = new DshManager()
    return this._inst
  }

  private child: ChildProcess | null = null
  private port: number | null = null
  private dataDir = ''
  private listeners = new Set<StatusListener>()
  private pluginLogListeners = new Set<PluginLogListener>()
  private pluginDoneListeners = new Set<PluginDoneListener>()
  private pluginPending:
    | {
        child: ChildProcess
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
   * 定位 DSH 运行时根目录（含 node.exe + node_modules/@deepseek-ai/dsh）。
   * 打包后固定为 resourcesPath/dsh；dev 下 app.getAppPath() 不指向仓库根，
   * 故从多个锚点（app 路径 / cwd / 本模块目录）向上逐层搜索 resources/dsh。
   */
  private findBase(): string {
    const env = process.env
    if (app.isPackaged) return join(process.resourcesPath, 'dsh')
    if (env.DSH_DEV_DIR && existsSync(join(env.DSH_DEV_DIR, 'node.exe'))) {
      return env.DSH_DEV_DIR
    }

    const anchors = [app.getAppPath(), process.cwd(), __dirname]
    const candidates: string[] = []
    for (const a of anchors) {
      let cur = a
      for (let i = 0; i < 8 && cur && cur !== join(cur, '..'); i++) {
        candidates.push(join(cur, 'resources', 'dsh'))
        cur = join(cur, '..')
      }
    }
    for (const c of candidates) {
      if (
        existsSync(join(c, 'node.exe')) &&
        existsSync(join(c, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
      ) {
        return c
      }
    }
    for (const c of candidates) {
      if (existsSync(join(c, 'node.exe'))) return c
    }
    return candidates[0] ?? join(app.getAppPath(), 'resources', 'dsh')
  }

  /** 解析 DSH 运行时路径 */
  private resolvePaths(): ResolvedPaths {
    const env = process.env
    const base = this.findBase()
    const nodeBin = env.DSH_NODE_BIN ? env.DSH_NODE_BIN : join(base, 'node.exe')
    const dshBin = join(base, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
    const home = env.DSH_HOME ? env.DSH_HOME : join(this.dataDir, 'dsh')
    return { base, nodeBin, dshBin, home }
  }

  isReady(): DshReadyInfo {
    const { nodeBin, dshBin } = this.resolvePaths()
    if (!existsSync(nodeBin)) {
      return { ready: false, reason: `未找到 node.exe: ${nodeBin}` }
    }
    if (!existsSync(dshBin)) {
      return { ready: false, reason: `未找到 DSH 入口: ${dshBin}` }
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

  /** 从子进程输出里解析 loopback 监听端口（--port 0 时 OS 会回显真实端口；忽略占位 0） */
  private parsePort(chunk: string): void {
    if (this.port) return
    const m = chunk.match(/(?:127\.0\.0\.1|localhost):(\d+)/)
    if (!m) return
    const p = Number(m[1])
    if (p > 0) this.port = p
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
  ): Promise<{ ok: boolean; port?: number; error?: string }> {
    if (this.child) return { ok: true, port: this.port ?? undefined }
    const { nodeBin, dshBin, home, base } = this.resolvePaths()
    if (!existsSync(nodeBin)) return { ok: false, error: `未找到 node.exe: ${nodeBin}` }
    if (!existsSync(dshBin)) return { ok: false, error: `未找到 DSH 入口: ${dshBin}` }
    try {
      mkdirSync(home, { recursive: true })
      const nodeModules = join(base, 'node_modules')
      // 继承应用环境，但清掉 Electron 注入的运行期变量（NODE_OPTIONS / ELECTRON_* 等），
      // 否则独立的 node.exe 会因 --require 等选项启动即退出。再显式设置 DSH 所需项。
      const env: Record<string, string> = { ...(process.env as Record<string, string>) }
      delete env.NODE_OPTIONS
      delete env.ELECTRON_RUN_AS_NODE
      for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_')) delete env[k]
      env.DSH_HOME = home
      env.TERM = 'xterm-256color'
      env.NODE_PATH = nodeModules
      env.PATH = `${base}${delimiter}${join(base, 'bin')}${delimiter}${env.PATH ?? ''}`

      const apiKey = opts?.apiKey || process.env.DEEPSEEK_API_KEY || ''
      if (apiKey) env.DEEPSEEK_API_KEY = apiKey
      if (opts?.model) env.DSH_MODEL = opts.model

      // 让 OS 选一个空闲端口（--port 0），再从输出解析真实端口，避免冲突。
      console.log('[dsh] 启动:', nodeBin, dshBin, '--profile web --no-open --port 0')
      const child = spawn(
        nodeBin,
        [dshBin, '--profile', 'web', '--no-open', '--port', '0'],
        { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      this.child = child
      this.port = null
      this.emit()

      let stderrBuf = ''
      child.on('error', (e) => {
        if (this.child === child) {
          this.child = null
          this.port = null
          this.emit()
        }
        console.error('[dsh] 启动失败:', e.message)
      })
      child.stderr?.on('data', (d) => {
        const msg = d.toString()
        stderrBuf += msg
        this.parsePort(msg)
        const line = msg.trim()
        if (line) console.error('[dsh:stderr]', line)
      })
      child.stdout?.on('data', (d) => this.parsePort(d.toString()))
      child.on('exit', (code, signal) => {
        if (this.child !== child) return // 已被 stop() 主动接管
        this.child = null
        this.port = null
        this.emit()
        if (code && code !== 0) console.warn(`[dsh] Web UI 退出 code=${code} signal=${signal}`)
      })

      // 等待「端口解析成功 + HTTP 探测通过」，总超时 START_TIMEOUT_MS
      const deadline = Date.now() + START_TIMEOUT_MS
      while (Date.now() < deadline) {
        if (this.child !== child) {
          // 子进程在启动期内意外退出：多半是 web profile 损坏/不兼容
          // （缺少核心 web 包 @deepseek-ai/dsh-web-app，webServer 服务未注册）。
          // 仅当核心包确实缺失时才自动重建 web profile 并重试一次，避免误删用户插件。
          const webApp = join(home, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-web-app')
          if (!repaired && !existsSync(webApp)) {
            try {
              rmSync(join(home, 'profiles', 'web'), { recursive: true, force: true })
              console.warn('[dsh] web profile 缺少核心包 @deepseek-ai/dsh-web-app，已重建并自动重试')
            } catch (e) {
              console.error('[dsh] 清理损坏的 web profile 失败:', e)
            }
            return this.start(opts, true)
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
   * 停止并清理整棵进程树。Windows 下 DSH 可能派生孙进程，
   * 用 taskkill /T 连带终止；其他平台退回 child.kill()。
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
    const pid = child.pid
    if (pid && process.platform === 'win32') {
      try {
        spawnSync('taskkill', ['/pid', String(pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        })
      } catch {
        /* taskkill 失败时进程随主窗口退出由 OS 回收 */
      }
    } else {
      try {
        child.kill()
      } catch {
        /* noop */
      }
    }
  }

  status(): DshStatus {
    return { running: !!this.child, port: this.child ? this.port ?? undefined : undefined }
  }

  // -----------------------------------------------------------------
  // 插件管理：`dsh plugin` 本质是 pnpm 转发器（硬编码 spawnSync("pnpm")），
  // 因此把自带 pnpm.exe / node.exe 所在目录前置进子进程 PATH 即可离系统依赖运行。
  // 对账逻辑保证「用户装的插件 = profile package.json 的 dependencies」，
  // 列表读取无需解析 dsh.profile（YAML）。
  // -----------------------------------------------------------------

  private profileDir(): string {
    return join(this.resolvePaths().home, 'profiles', 'web')
  }

  /** 子进程环境：DSH_HOME + NODE_PATH + 自带 bin/node 前置的 PATH */
  private childEnv(): Record<string, string> {
    const { home, base } = this.resolvePaths()
    return {
      ...(process.env as Record<string, string>),
      DSH_HOME: home,
      NODE_PATH: join(base, 'node_modules'),
      PATH: `${join(base, 'bin')}${delimiter}${base}${delimiter}${process.env.PATH ?? ''}`,
      // pnpm ≥11 默认开启 24 小时 minimumReleaseAge 供应链策略，
      // 会拒绝刚发布的包；插件市场已自带处理，但 CLI 直装场景仍需关掉。
      npm_config_minimum_release_age: '0',
    }
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

    const { nodeBin, dshBin, home } = this.resolvePaths()
    mkdirSync(home, { recursive: true })
    console.log(`[dsh] plugin ${action}:`, spec)

    const runOnce = (extraArgs: string[]): Promise<{ ok: boolean; error?: string }> =>
      new Promise((resolve) => {
        const child = spawn(
          nodeBin,
          [dshBin, 'plugin', '--profile', 'web', action, spec, ...extraArgs],
          { cwd: home, env: this.childEnv(), stdio: ['ignore', 'pipe', 'pipe'] },
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
          this.finishPlugin(pending, false, e.message)
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
