import readline from 'readline'
import { Database } from 'sql.js'
import { loadConfig, MpcConfig } from './config'
import { withDb, closeCachedDb } from './db'
import { ToolRegistry, McpToolSpec } from '../core/tool-registry'
import { TASK_TOOLS } from '../modules/tasks/tools'
import { createPluginStorage } from '../core/plugin-storage'
import { loadPluginsIntoRegistry } from '../core/plugin-loader'
import { truncateArgs } from './call-log'
import type { McpCallLogEntry } from './call-log'
import type { PluginToolContext } from '../core/contracts'
import type { AppService } from '../core/app-service'

// ===================================================================
// stdio MCP server（Model Context Protocol）
// 通过 stdin/stdout 走 JSON-RPC 2.0：
//   - initialize         握手
//   - notifications/initialized 客户端通知
//   - tools/list         返回允许暴露的工具清单（受 agent-mcp-config.json 白名单控制）
//   - tools/call         执行工具
//   其余方法统一报 MethodNotFound。
//
// 传输层设计：本文件的 STDIO 传输只是 MCP 的一种载体。远程(HTTP/SSE)模式未来
// 只需新增一个 HttpTransport，复用 handleMessage / 工具注册 / 数据层，无需改动业务。
//
// 工具来源：统一由 core/tool-registry 构建。内置任务工具在 modules/tasks/tools.ts，
// 插件工具由 ToolRegistry.loadPlugins() 加载后合并（P3 目标）。
// ===================================================================

export interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: string | number | null
  method: string
  params?: Record<string, unknown>
}
export interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: string | number | null
  result?: unknown
  error?: { code: number; message: string; data?: unknown }
}

// 服务器声明支持的协议版本（不再回显客户端版本）
const SUPPORTED_PROTOCOL_VERSION = '2024-11-05'

export interface McpServerOpts {
  configFile?: string
  dataDir?: string
  waitMs?: number
  // 整包委托：返回响应则直接使用；返回 null 回退本地执行（MCP 进程转发到 GUI 用）
  // 仅对内置工具生效；插件工具始终本地执行（独立 MCP 进程），不进主进程。
  delegate?: (req: JsonRpcRequest) => Promise<JsonRpcResponse | null>
  // 本地执行时用此数据库源（GUI 进程传 getDB()，写后触发 afterWrite）
  dbSource?: () => Database
  // dbSource 模式下写操作完成后的回调（GUI 落盘 + 通知渲染层）
  afterWrite?: () => void
  // 已受信实例（GUI 侧端点），跳过 initialize 握手要求
  trusted?: boolean
  // 自定义工具注册表（默认构建：内置任务工具；GUI 侧传入含插件的 registry）
  registry?: ToolRegistry
  // 插件 ctx.app 委托桥（GUI 侧注入）：应用业务层经 loopback 调用；独立进程无 GUI 时缺省
  appBridge?: (channel: string, args: unknown[]) => Promise<unknown>
  // 统一业务层（AppService）：本服务直接处理 app/invoke（GUI loopback 端点用）
  appService?: AppService
  // 仅暴露内置工具（GUI 端点用）：插件工具被排除，确保插件执行永不进入主进程
  excludePlugins?: boolean
  // 分层工具发现模式：初始 tools/list 只返回核心工具 + 元工具，插件工具按需加载
  layeredDiscovery?: boolean
  // 工具调用完成回调（执行方记录调用日志）：不含 id/source，由调用方补齐。
  // 只在本地实际执行时触发——delegate 转发成功时由被转交方记录，避免重复。
  onCall?: (call: Omit<McpCallLogEntry, 'id' | 'source'>) => void
}

// ---- 工具定义 + 执行 ----
interface ToolSpec {
  key: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
  kind: 'builtin' | 'plugin'
  tier: 'core' | 'extended'
  readonly: boolean
  danger: boolean
  pluginId?: string
  // 通过 withDb 执行；write 操作会被权限白名单过滤
  run: McpToolSpec['run']
}

function buildTools(
  cfg: MpcConfig,
  registry: ToolRegistry,
  excludePlugins = false,
  layeredDiscovery = false,
): ToolSpec[] {
  // 分层模式：只返回核心工具；非分层模式：返回所有允许的工具
  const tier = layeredDiscovery ? 'core' : 'all'
  const tools = registry.buildMcpTools(cfg, { tier })

  if (!excludePlugins) return tools
  return tools.filter((t) => t.kind === 'builtin')
}

// ---- 请求处理（对传输层中立） ----
export class McpServer {
  private cfg: MpcConfig
  private tools: ToolSpec[]
  private registry: ToolRegistry
  private initialized: boolean
  private waitMs: number
  private dataDir?: string
  private callQueue: Promise<void> = Promise.resolve()
  private delegate: ((req: JsonRpcRequest) => Promise<JsonRpcResponse | null>) | null
  private dbSource: (() => Database) | null
  private afterWrite: (() => void) | null
  private appBridge: ((channel: string, args: unknown[]) => Promise<unknown>) | null
  private appService: AppService | null
  private configFile?: string
  private excludePlugins: boolean
  private layeredDiscovery: boolean
  private onCall: ((call: Omit<McpCallLogEntry, 'id' | 'source'>) => void) | null

  constructor(opts?: McpServerOpts) {
    this.configFile = opts?.configFile
    this.excludePlugins = opts?.excludePlugins ?? false
    this.layeredDiscovery = opts?.layeredDiscovery ?? false
    this.registry = opts?.registry ?? defaultRegistry()
    this.dataDir = opts?.dataDir?.trim() || (process.env.ZDNOTES_DATA_DIR ?? undefined)
    // 加载第三方插件工具进统一注册表（GUI 侧传入的 registry 已含插件，重复注册会抛错，这里幂等处理）
    if (this.dataDir && !opts?.registry) {
      loadPluginsIntoRegistry(this.registry, this.dataDir)
    }
    this.cfg = loadConfig({
      configFile: opts?.configFile,
      catalog: this.registry.toCatalog(),
    })
    this.waitMs = opts?.waitMs ?? this.cfg.maxWaitLockMs
    this.tools = buildTools(this.cfg, this.registry, this.excludePlugins, this.layeredDiscovery)
    this.delegate = opts?.delegate ?? null
    this.dbSource = opts?.dbSource ?? null
    this.afterWrite = opts?.afterWrite ?? null
    this.appBridge = opts?.appBridge ?? null
    this.appService = opts?.appService ?? null
    this.onCall = opts?.onCall ?? null
    this.initialized = opts?.trusted ?? false
  }

  // 配置（agent-mcp-config.json）变更后重载：重新生成工具白名单。
  reloadConfig(): void {
    this.cfg = loadConfig({
      configFile: this.configFile,
      catalog: this.registry.toCatalog(),
    })
    this.waitMs = this.cfg.maxWaitLockMs
    this.tools = buildTools(this.cfg, this.registry, this.excludePlugins, this.layeredDiscovery)
  }

  // 插件热重载：替换注册表（重建内置+插件）并重建工具白名单。
  setRegistry(registry: ToolRegistry): void {
    this.registry = registry
    this.cfg = loadConfig({
      configFile: this.configFile,
      catalog: this.registry.toCatalog(),
    })
    this.tools = buildTools(this.cfg, this.registry, this.excludePlugins, this.layeredDiscovery)
  }

  get serverInfo() {
    return { name: 'zdn-notes-mcp', version: '1.5.0' }
  }

  // 处理一条请求消息，返回要写回的响应（可为 null，如 notifications 无需回包）
  async handleMessage(line: string): Promise<JsonRpcResponse | null> {
    let req: JsonRpcRequest
    try {
      req = JSON.parse(line) as JsonRpcRequest
    } catch {
      return this.error(-32700, 'Parse error', null)
    }
    if (req.jsonrpc !== '2.0' || typeof req.method !== 'string') {
      return this.error(-32600, 'Invalid Request', req.id ?? null)
    }
    const id = req.id ?? null

    // 握手强制：除 initialize 外的方法（ping / notifications 除外）需先握手
    if (!this.initialized && req.method !== 'initialize') {
      if (req.method !== 'ping' && req.method !== 'notifications/initialized') {
        return this.error(-32000, 'Server not initialized. Call initialize first.', id)
      }
    }

    try {
      switch (req.method) {
        case 'initialize': {
          this.initialized = true
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: SUPPORTED_PROTOCOL_VERSION,
              capabilities: { tools: {} },
              serverInfo: this.serverInfo,
            },
          }
        }
        case 'notifications/initialized':
          return null // 通知，无响应
        case 'ping':
          return { jsonrpc: '2.0', id, result: {} }
        case 'app/invoke': {
          // 插件 ctx.app 委托入口：仅 GUI loopback 端点持有 AppService，独立进程无
          if (!this.appService) {
            return this.error(-32001, 'AppService not available', id)
          }
          const p = (req.params ?? {}) as { channel?: string; args?: unknown[] }
          if (!p.channel || typeof p.channel !== 'string') {
            return this.error(-32602, 'app/invoke 需要 channel 参数', id)
          }
          const invokeArgs = Array.isArray(p.args) ? p.args : []
          const startedAt = Date.now()
          try {
            const result = await this.appService.invoke(p.channel, ...invokeArgs)
            // 审计：ctx.app 写入（如 tool:set 改草稿）与读取均落 call-logs，便于溯源
            this.logCall(
              `ctx.app:${p.channel}`,
              { channel: p.channel, args: invokeArgs },
              startedAt,
              true,
            )
            return this.result(id, result)
          } catch (e) {
            this.logCall(
              `ctx.app:${p.channel}`,
              { channel: p.channel, args: invokeArgs },
              startedAt,
              false,
              e instanceof Error ? e.message : String(e),
            )
            throw e
          }
        }
        case 'tools/list': {
          return {
            jsonrpc: '2.0',
            id,
            result: {
              tools: this.tools.map((t) => ({
                name: t.name,
                description: t.description,
                inputSchema: t.inputSchema,
              })),
            },
          }
        }
        case 'tools/call': {
          const p = (req.params ?? {}) as { name?: string; arguments?: Record<string, unknown> }
          const tool = this.tools.find((t) => t.name === p.name)
          if (!tool) {
            return this.error(-32602, `Unknown tool: ${p.name}`, id)
          }
          // 委托模式（如转发到 GUI 执行）：仅内置工具整包转交（返回非 null 即采用其结果）；
          // 插件工具始终本地执行（独立 MCP 进程），不进主进程。
          if (this.delegate && tool.kind === 'builtin') {
            const delegated = await this.delegate(req)
            if (delegated) return delegated // 已由被转交方记录日志，此处不重复
          }
          const args = p.arguments ?? {}
          const startedAt = Date.now()
          try {
            const result = await this.enqueue(() => {
              if (tool.kind === 'plugin') {
                // 插件工具：全权 Node 能力 + ctx.app 委托应用业务层；storage/日志按插件隔离
                const pluginId = tool.pluginId ?? 'unknown'
                const ctx: PluginToolContext = {
                  kind: 'plugin',
                  dataDir: this.dataDir ?? '',
                  pluginId,
                  storage: createPluginStorage(this.dataDir ?? '', pluginId),
                  log: (level, msg) => {
                    // 一律写 stderr：stdio 传输的 stdout 只能承载 JSON-RPC
                    const fn =
                      level === 'error'
                        ? console.error
                        : level === 'warn'
                          ? console.warn
                          : console.error
                    fn(`[plugin:${pluginId}]`, msg)
                  },
                }
                if (this.appBridge) {
                  ctx.app = (channel, ...args) => this.appBridge!(channel, args)
                }
                return Promise.resolve(tool.run(ctx, args))
              }
              if (this.dbSource) {
                const ctx = {
                  kind: 'builtin' as const,
                  db: this.dbSource(),
                  dataDir: this.dataDir ?? '',
                  save: this.afterWrite ?? undefined,
                }
                const r = tool.run(ctx, args)
                if (!tool.readonly) this.afterWrite?.()
                return Promise.resolve(r)
              }
              return withDb(
                (db) => tool.run({ kind: 'builtin', db, dataDir: this.dataDir ?? '' }, args),
                {
                  dataDir: this.dataDir,
                  waitMs: this.waitMs,
                  readonly: tool.readonly,
                },
              )
            })
            this.logCall(tool.name, args, startedAt, true)
            return this.result(id, {
              content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
              isError: false,
            })
          } catch (e) {
            this.logCall(
              tool.name,
              args,
              startedAt,
              false,
              e instanceof Error ? e.message : String(e),
            )
            throw e
          }
        }
        default:
          return this.error(-32601, `Method not found: ${req.method}`, id)
      }
    } catch (e) {
      return this.error(-32000, e instanceof Error ? e.message : String(e), id)
    }
  }

  // 同一进程内的工具调用串行化：避免并发操作同一个 SQL.js 内存库造成竞态。
  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.callQueue.then(fn, fn)
    // 无论成功失败都让队列继续，但不把错误吞掉
    this.callQueue = next.then(
      () => undefined,
      () => undefined,
    )
    return next
  }

  private result(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result }
  }
  private error(code: number, message: string, id: string | number | null): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } }
  }
  private logCall(
    tool: string,
    args: Record<string, unknown>,
    startedAt: number,
    ok: boolean,
    error?: string,
  ): void {
    this.onCall?.({
      ts: startedAt,
      tool,
      args: truncateArgs(args),
      ok,
      error,
      ms: Date.now() - startedAt,
    })
  }
}

// 默认注册表：内置任务工具。GUI 侧（mcp-ipc）会传入含插件工具的 registry。
export function defaultRegistry(): ToolRegistry {
  const reg = new ToolRegistry()
  reg.registerAll(TASK_TOOLS)
  return reg
}

// ---- stdio 传输 ----
export function runStdio(opts?: McpServerOpts): void {
  // stdout 只承载 JSON-RPC：任何 console.log/warn（含插件在 run() 里误用）都重定向到 stderr
  const origLog = console.log
  const origWarn = console.warn
  console.log = (...a: unknown[]) => console.error(...a)
  console.warn = (...a: unknown[]) => console.error(...a)

  const server = new McpServer(opts)
  const rl = readline.createInterface({ input: process.stdin, terminal: false })
  rl.on('line', (line) => {
    if (!line.trim()) return
    server
      .handleMessage(line)
      .then((resp) => {
        if (resp) process.stdout.write(JSON.stringify(resp) + '\n')
      })
      .catch((e) => {
        const resp = { jsonrpc: '2.0', id: null, error: { code: -32603, message: String(e) } }
        process.stdout.write(JSON.stringify(resp) + '\n')
      })
  })
  rl.on('close', () => {
    console.log = origLog
    console.warn = origWarn
    closeCachedDb().finally(() => process.exit(0))
  })
  // 低频：正常退出时关库
  process.on('SIGINT', () => {
    console.log = origLog
    console.warn = origWarn
    closeCachedDb().finally(() => process.exit(0))
  })
}
