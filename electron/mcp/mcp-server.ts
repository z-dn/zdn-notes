import readline from 'readline'
import { Database } from 'sql.js'
import { loadConfig, MpcConfig } from './config'
import { withDb, closeCachedDb } from './db'
import { ToolRegistry, McpToolSpec } from '../core/tool-registry'
import { TASK_TOOLS } from '../modules/tasks/tools'
import { createPluginStorage } from '../core/plugin-storage'
import { loadPluginsIntoRegistry } from '../core/plugin-loader'
import { buildHttpCapability } from './http-capability'
import type { PluginToolContext } from '../core/contracts'

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
  delegate?: (req: JsonRpcRequest) => Promise<JsonRpcResponse | null>
  // 本地执行时用此数据库源（GUI 进程传 getDB()，写后触发 afterWrite）
  dbSource?: () => Database
  // dbSource 模式下写操作完成后的回调（GUI 落盘 + 通知渲染层）
  afterWrite?: () => void
  // 已受信实例（GUI 侧端点），跳过 initialize 握手要求
  trusted?: boolean
  // 自定义工具注册表（默认构建：内置任务工具；GUI 侧传入含插件的 registry）
  registry?: ToolRegistry
  // 插件 desktop 能力桥（GUI 侧注入；独立进程无桌面能力）
  desktopBridge?: (channel: string, args: unknown[]) => Promise<unknown>
}

// ---- 工具定义 + 执行 ----
interface ToolSpec {
  key: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
  kind: 'builtin' | 'plugin'
  readonly: boolean
  danger: boolean
  pluginId?: string
  pluginPermissions?: string[]
  // 通过 withDb 执行；write 操作会被权限白名单过滤
  run: McpToolSpec['run']
}

function buildTools(cfg: MpcConfig, registry: ToolRegistry): ToolSpec[] {
  return registry.buildMcpTools(cfg)
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
  private desktopBridge: ((channel: string, args: unknown[]) => Promise<unknown>) | null
  private configFile?: string

  constructor(opts?: McpServerOpts) {
    this.configFile = opts?.configFile
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
    this.tools = buildTools(this.cfg, this.registry)
    this.delegate = opts?.delegate ?? null
    this.dbSource = opts?.dbSource ?? null
    this.afterWrite = opts?.afterWrite ?? null
    this.desktopBridge = opts?.desktopBridge ?? null
    this.initialized = opts?.trusted ?? false
  }

  // 配置（agent-mcp-config.json）变更后重载：重新生成工具白名单。
  reloadConfig(): void {
    this.cfg = loadConfig({
      configFile: this.configFile,
      catalog: this.registry.toCatalog(),
    })
    this.waitMs = this.cfg.maxWaitLockMs
    this.tools = buildTools(this.cfg, this.registry)
  }

  // 插件热重载：替换注册表（重建内置+插件）并重建工具白名单。
  setRegistry(registry: ToolRegistry): void {
    this.registry = registry
    this.cfg = loadConfig({
      configFile: this.configFile,
      catalog: this.registry.toCatalog(),
    })
    this.tools = buildTools(this.cfg, this.registry)
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
          // 委托模式（如转发到 GUI 执行）：整包转交，返回非 null 即采用其结果
          if (this.delegate) {
            const delegated = await this.delegate(req)
            if (delegated) return delegated
          }
          const args = p.arguments ?? {}
          const result = await this.enqueue(() => {
            if (tool.kind === 'plugin') {
              // 插件工具：能力 ctx（无 db），storage/日志按插件隔离
              const pluginId = tool.pluginId ?? 'unknown'
              const ctx: PluginToolContext = {
                kind: 'plugin',
                dataDir: this.dataDir ?? '',
                pluginId,
                storage: createPluginStorage(this.dataDir ?? '', pluginId),
                log: (level, msg) => {
                  // 一律写 stderr：stdio 传输的 stdout 只能承载 JSON-RPC
                  const fn =
                    level === 'error' ? console.error : level === 'warn' ? console.warn : console.error
                  fn(`[plugin:${pluginId}]`, msg)
                },
              }
              if (tool.pluginPermissions?.includes('http:request')) {
                ctx.httpRequest = buildHttpCapability()
              }
              if (tool.pluginPermissions?.includes('desktop') && this.desktopBridge) {
                ctx.desktop = (channel, ...args) => this.desktopBridge!(channel, args)
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
            return withDb((db) => tool.run({ kind: 'builtin', db, dataDir: this.dataDir ?? '' }, args), {
              dataDir: this.dataDir,
              waitMs: this.waitMs,
              readonly: tool.readonly,
            })
          })
          return this.result(id, {
            content: [{ type: 'text', text: JSON.stringify(result ?? null) }],
            isError: false,
          })
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
    this.callQueue = next.then(() => undefined, () => undefined)
    return next
  }

  private result(id: string | number | null, result: unknown): JsonRpcResponse {
    return { jsonrpc: '2.0', id, result }
  }
  private error(code: number, message: string, id: string | number | null): JsonRpcResponse {
    return { jsonrpc: '2.0', id, error: { code, message } }
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
    closeCachedDb().finally(() => process.exit(0))
  })
  // 低频：正常退出时关库
  process.on('SIGINT', () => {
    closeCachedDb().finally(() => process.exit(0))
  })
}
