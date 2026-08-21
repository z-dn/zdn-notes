import { createServer, IncomingMessage } from 'http'
import { randomBytes } from 'crypto'
import { Database } from 'sql.js'
import { McpServer } from '../mcp/mcp-server'
import { configFileForDataDir } from '../mcp/config'
import type { McpCallLogEntry } from '../mcp/call-log'
import type { ToolRegistry } from '../core/tool-registry'
import type { AppService } from '../core/app-service'

// ===================================================================
// GUI 侧本地 IPC 端点（GUI-IPC 委托模式的服务端）。
//
// GUI 启动时绑 127.0.0.1 随机端口，把 port/token 写进 GUI 锁文件
// （electron/mcp/lock.ts 的 acquireGuiLock）。zdn-mcp 检测到 GUI 在跑时
// 把 tools/call 整包转发到这里：由本端点在自己内存库(getDB())上执行，
// 写后 saveAsync() 落盘并 notify() 通知渲染层刷新。GUI 因此是权威单写者。
//
// 鉴权：Bearer token 每次启动随机；仅接受 POST /mcp；除 JSON-RPC 规定方法外
// 一律 MethodNotFound（复用 McpServer，白名单/校验/返回格式与 MCP 侧一致）。
// ===================================================================

export interface McpIpcServer {
  port: number
  token: string
  stop: () => Promise<void>
  reloadConfig: () => void
  setRegistry: (registry: ToolRegistry) => void
}

export interface McpIpcDeps {
  dataDir: string
  getDB: () => Database
  saveAsync: () => void
  notify: () => void
  registry?: ToolRegistry
  /** 统一业务层（AppService）：供插件 ctx.app 经 app/invoke 委托调用 */
  appService?: AppService
  /** 工具调用完成回调（记录调用日志 + 通知渲染层） */
  onCall?: (call: Omit<McpCallLogEntry, 'id' | 'source'>) => void
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => {
      data += chunk
    })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

export function startMcpIpc(deps: McpIpcDeps): Promise<McpIpcServer> {
  const token = randomBytes(16).toString('hex')
  const server = new McpServer({
    dataDir: deps.dataDir,
    configFile: configFileForDataDir(deps.dataDir),
    trusted: true, // 本端点仅对已握手的 zdn-mcp 开放，跳过握手要求
    dbSource: deps.getDB,
    registry: deps.registry,
    appService: deps.appService,
    onCall: deps.onCall,
    // GUI 端点只执行内置工具；插件工具在独立 MCP 进程执行，永不进入主进程
    excludePlugins: true,
    // 启用分层发现模式：初始 tools/list 只返回核心工具 + 元工具，减少 token 消耗
    layeredDiscovery: true,
    afterWrite: () => {
      deps.saveAsync()
      deps.notify()
    },
  })

  const http = createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if ((req.headers.authorization ?? '') !== 'Bearer ' + token) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32001, message: 'Unauthorized' },
        }),
      )
      return
    }
    if (req.method !== 'POST' || (req.url !== '/mcp' && req.url !== '/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }
    try {
      const body = await readBody(req)
      const requests = JSON.parse(body)
      const arr = Array.isArray(requests) ? requests : [requests]
      const out: unknown[] = []
      for (const item of arr) {
        const resp = await server.handleMessage(JSON.stringify(item))
        if (resp) out.push(resp)
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(arr.length === 1 && !Array.isArray(requests) ? out[0] : out))
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: String(e) } }),
      )
    }
  })

  return new Promise((resolve) => {
    http.listen(0, '127.0.0.1', () => {
      const addr = http.address()
      const port = typeof addr === 'object' && addr ? addr.port : 0
      resolve({
        port,
        token,
        reloadConfig: () => server.reloadConfig(),
        setRegistry: (registry) => server.setRegistry(registry),
        stop: () => new Promise<void>((r) => http.close(() => r())),
      })
    })
  })
}
