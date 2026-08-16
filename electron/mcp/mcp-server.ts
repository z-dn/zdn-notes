import readline from 'readline'
import { Database } from 'sql.js'
import { loadConfig, allowedOperations, OperationKey, MpcConfig } from './config'
import {
  taskCreate, taskList, taskGetById, taskUpdateStatus, taskUpdate, taskDelete,
  withDb, closeCachedDb,
} from './db'

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
}

// ---- 工具定义 + 执行 ----
interface ToolSpec {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  // 通过 withDb 执行；write 操作会被权限白名单过滤
  run: (db: Database, args: Record<string, unknown>) => Promise<unknown> | unknown
}

function buildTools(cfg: MpcConfig): ToolSpec[] {
  const tools: ToolSpec[] = []
  const push = (perm: OperationKey, spec: Omit<ToolSpec, 'name'> & { name?: string }) => {
    if (!allowedOperations(cfg).includes(perm)) return
    tools.push({
      name: spec.name!,
      description: spec.description,
      inputSchema: spec.inputSchema,
      run: spec.run,
    })
  }

  push('task:create', {
    name: 'task_create',
    description: '创建一条待办任务',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '任务标题（必填）' },
        description: { type: 'string', description: '任务详情（Markdown）' },
        status: { type: 'string', enum: ['todo', 'done'], description: 'todo/done' },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'], description: '优先级' },
        dueDate: { type: 'number', description: '截止时间戳(ms)' },
        startDate: { type: 'number', description: '开始时间戳(ms)' },
        reminderTime: { type: 'number', description: '提醒时间戳(ms)' },
        tags: { type: 'array', items: { type: 'string' }, description: '标签' },
        owner: { type: 'string', description: '负责人' },
        categoryId: { type: 'string', description: '分类 id；缺省归入未分类' },
      },
      required: ['title'],
    },
    run: (db, a) => taskCreate(db, a as any),
  })

  push('task:read_list', {
    name: 'task_list',
    description: '列出待办任务，可按状态/标题关键词过滤',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['todo', 'done'], description: '按状态过滤' },
        search: { type: 'string', description: '按标题模糊搜索' },
      },
    },
    run: (db, a) => taskList(db, { status: a.status as string, search: a.search as string }),
  })

  push('task:read_detail', {
    name: 'task_get',
    description: '按 id 查询单个任务详情',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '任务 id（必填）' } },
      required: ['id'],
    },
    run: (db, a) => taskGetById(db, a.id as string),
  })

  push('task:update_status', {
    name: 'task_update_status',
    description: '切换任务状态（todo/done）；标记 done 会级联完成其子任务',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '任务 id（必填）' },
        status: { type: 'string', enum: ['todo', 'done'], description: '目标状态（必填）' },
      },
      required: ['id', 'status'],
    },
    run: (db, a) => taskUpdateStatus(db, a.id as string, a.status as string),
  })

  push('task:update', {
    name: 'task_update',
    description: '更新任务内容（标题/详情/优先级/时间/标签/负责人/分类等）',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '任务 id（必填）' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] },
        dueDate: { type: ['number', 'null'] },
        startDate: { type: ['number', 'null'] },
        reminderTime: { type: ['number', 'null'] },
        tags: { type: 'array', items: { type: 'string' } },
        owner: { type: 'string' },
        categoryId: { type: ['string', 'null'] },
      },
      required: ['id'],
    },
    run: (db, a) => taskUpdate(db, a.id as string, a as Record<string, unknown>),
  })

  push('task:delete', {
    name: 'task_delete',
    description: '删除任务（连同其子任务）',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: '任务 id（必填）' } },
      required: ['id'],
    },
    run: (db, a) => taskDelete(db, a.id as string),
  })

  return tools
}

// ---- 请求处理（对传输层中立） ----
export class McpServer {
  private cfg: MpcConfig
  private tools: ToolSpec[]
  private initialized: boolean
  private waitMs: number
  private dataDir?: string
  private callQueue: Promise<void> = Promise.resolve()
  private delegate: ((req: JsonRpcRequest) => Promise<JsonRpcResponse | null>) | null
  private dbSource: (() => Database) | null
  private afterWrite: (() => void) | null
  private configFile?: string

  constructor(opts?: McpServerOpts) {
    this.configFile = opts?.configFile
    this.cfg = loadConfig(opts ? { configFile: opts.configFile } : undefined)
    this.waitMs = opts?.waitMs ?? this.cfg.maxWaitLockMs
    this.dataDir = opts?.dataDir?.trim() || (process.env.ZDNOTES_DATA_DIR ?? undefined)
    this.tools = buildTools(this.cfg)
    this.delegate = opts?.delegate ?? null
    this.dbSource = opts?.dbSource ?? null
    this.afterWrite = opts?.afterWrite ?? null
    this.initialized = opts?.trusted ?? false
  }

  // 配置（agent-mcp-config.json）变更后重载：重新生成工具白名单。
  reloadConfig(): void {
    this.cfg = loadConfig(this.configFile ? { configFile: this.configFile } : undefined)
    this.waitMs = this.cfg.maxWaitLockMs
    this.tools = buildTools(this.cfg)
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
            if (this.dbSource) {
              const r = (tool.run as any)(this.dbSource(), args)
              if (!this.isReadonly(tool.name)) this.afterWrite?.()
              return r
            }
            return withDb((db) => (tool.run as any)(db, args), {
              dataDir: this.dataDir,
              waitMs: this.waitMs,
              readonly: this.isReadonly(tool.name),
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

  private readonlySet = new Set([
    'task_list', 'task_get', 'category_list',
  ])
  private isReadonly(name: string): boolean {
    return this.readonlySet.has(name)
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
