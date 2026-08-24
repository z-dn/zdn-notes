import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { spawn, spawnSync, type ChildProcess } from 'child_process'

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

interface ResolvedPaths {
  base: string
  nodeBin: string
  dshBin: string
  home: string
}

/** 启动总超时：端口解析 + HTTP 就绪探测共用 */
const START_TIMEOUT_MS = 15_000
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

  init(opts: { dataDir: string }): void {
    this.dataDir = opts.dataDir
  }

  /** 订阅状态变化（启动/停止/退出），返回取消订阅函数 */
  onChange(cb: StatusListener): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
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

  async start(opts?: { apiKey?: string; model?: string }): Promise<{ ok: boolean; port?: number; error?: string }> {
    if (this.child) return { ok: true, port: this.port ?? undefined }
    const { nodeBin, dshBin, home, base } = this.resolvePaths()
    if (!existsSync(nodeBin)) return { ok: false, error: `未找到 node.exe: ${nodeBin}` }
    if (!existsSync(dshBin)) return { ok: false, error: `未找到 DSH 入口: ${dshBin}` }
    try {
      mkdirSync(home, { recursive: true })
      const nodeModules = join(base, 'node_modules')
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        DSH_HOME: home,
        TERM: 'xterm-256color',
        NODE_PATH: nodeModules,
      }
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

      child.on('error', (e) => {
        if (this.child === child) {
          this.child = null
          this.port = null
          this.emit()
        }
        console.error('[dsh] 启动失败:', e.message)
      })
      child.stderr?.on('data', (d) => {
        const msg = d.toString().trim()
        this.parsePort(msg)
        if (msg) console.error('[dsh:stderr]', msg)
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
          return { ok: false, error: 'DSH Web UI 进程启动后立即退出（可能配置错误）' }
        }
        if (this.port && (await this.probe(this.port))) {
          this.emit()
          return { ok: true, port: this.port }
        }
        await new Promise((r) => setTimeout(r, 250))
      }
      await this.stop()
      return { ok: false, error: `DSH 启动超时（${START_TIMEOUT_MS / 1000}s 未就绪）` }
    } catch (e) {
      await this.stop()
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  /**
   * 停止并清理整棵进程树。Windows 下 DSH 可能派生孙进程，
   * 用 taskkill /T 连带终止；其他平台退回 child.kill()。
   */
  async stop(): Promise<void> {
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
}

export const dshManager = DshManager.getInstance()
