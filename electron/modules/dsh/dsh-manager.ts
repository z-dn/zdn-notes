import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { spawn, type ChildProcess } from 'child_process'

// ===================================================================
// DshManager —— 主进程内管理 DSH Web UI 子进程的生命周期。
//
// 关键架构（见 docs/dsh-integration-plan.md）：
//   - DSH 官方是 Web UI：`dsh web` 在 loopback 起一个本地 HTTP 服务（默认 127.0.0.1:3080）。
//   - 应用自带 console-subsystem 的 node.exe（resources/dsh）来跑 `dsh web` 服务端，
//     与系统 Node 完全隔离；`dsh web` 是普通 HTTP 服务，**不需要 TTY**（区别于 TUI 方案）。
//   - 渲染层用 <webview> 加载 http://127.0.0.1:<port> 展示官方 Web UI。
//   - node.exe / node_modules / 配置（DSH_HOME）全部随包分发，零系统依赖。
// ===================================================================

export interface DshStatus {
  running: boolean
  port?: number
}

export interface DshReadyInfo {
  ready: boolean
  reason?: string
}

interface ResolvedPaths {
  base: string
  nodeBin: string
  dshBin: string
  home: string
}

class DshManager {
  private static _inst: DshManager | null = null
  static getInstance(): DshManager {
    if (!this._inst) this._inst = new DshManager()
    return this._inst
  }

  private child: ChildProcess | null = null
  private port: number | null = null
  private dataDir = ''

  init(opts: { dataDir: string }): void {
    this.dataDir = opts.dataDir
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

      // 让 OS 选一个空闲端口（--port 0），再从 stdout 解析真实端口，避免冲突。
      console.log('[dsh] 启动:', nodeBin, dshBin, '--profile web --no-open --port 0')
      const child = spawn(
        nodeBin,
        [dshBin, '--profile', 'web', '--no-open', '--port', '0'],
        { cwd: home, env, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      this.child = child
      this.port = null

      child.on('error', (e) => {
        this.child = null
        this.port = null
        console.error('[dsh] 启动失败:', e.message)
      })
      child.stderr?.on('data', (d) => {
        const msg = d.toString().trim()
        if (msg) console.error('[dsh:stderr]', msg)
      })
      child.stdout?.on('data', (d) => {
        const msg = d.toString()
        const m = msg.match(/127\.0\.0\.1:(\d+)/)
        if (m) this.port = Number(m[1])
      })
      child.on('exit', (code, signal) => {
        this.child = null
        this.port = null
        if (code && code !== 0) console.warn(`[dsh] Web UI 退出 code=${code} signal=${signal}`)
      })

      // 等待进程存活且从 stdout 解析到端口（最长 ~4s）
      for (let i = 0; i < 16; i++) {
        if (this.child !== child) {
          return { ok: false, error: 'DSH Web UI 进程启动后立即退出（可能配置错误）' }
        }
        if (this.port) break
        await new Promise((r) => setTimeout(r, 250))
      }
      if (!this.port) {
        return { ok: false, error: '未能从 DSH 输出解析到监听端口' }
      }
      return { ok: true, port: this.port }
    } catch (e) {
      this.child = null
      this.port = null
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  stop(): void {
    if (this.child) {
      try {
        this.child.kill()
      } catch {
        /* noop */
      }
      this.child = null
    }
    this.port = null
  }

  status(): DshStatus {
    return { running: !!this.child, port: this.child ? this.port ?? undefined : undefined }
  }
}

export const dshManager = DshManager.getInstance()
