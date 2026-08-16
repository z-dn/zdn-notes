import { createServer, IncomingMessage, ServerResponse } from 'http'
import { McpServer, McpServerOpts } from './mcp-server'
import { loadConfig } from './config'

// ===================================================================
// 远程 HTTP/SSE 传输（MCP Streamable HTTP）—— 二期预留的远程模式骨架。
//
// 架构：一个 loopback HTTP 常驻服务，任意 MCP 客户端（智能体）通过
//   POST {host}/mcp  发送 JSON-RPC 消息，响应为 JSON 或 SSE。
// 复用 mcp-server.ts 的 McpServer.handleMessage，业务逻辑零重复。
//
// 安全（本地远程都要做）：
//   - token 鉴权：Authorization: Bearer <token>，token 由 agent-mcp-config.json 配置
//   - 默认只绑 127.0.0.1（loopback）；远程跨机器需显式配置 host + 网络鉴权
//   - CORS 白名单（浏览器客户端元数据请求）
//
// 与 GUI 一致性：通过 db.ts 的 withDb（文件锁 + 单写者 + GUI 优先）保证。
// 多客户端并发由 McpServer.enqueue 串行化。
// ===================================================================

interface HttpServerOpts extends McpServerOpts {
  port?: number
  host?: string
  token?: string
  corsOrigins?: string[]
}

// 解析配置令牌/端口（可来自 opts、环境变量或配置文件）
function readHttpConfig(opts?: HttpServerOpts) {
  const cfg = loadConfig(opts ? { configFile: opts.configFile } : undefined)
  const token =
    opts?.token ??
    process.env.ZDNOTES_MCP_TOKEN ??
    (cfg as unknown as { token?: string }).token ??
    ''
  const port = opts?.port ?? Number(process.env.ZDNOTES_MCP_PORT ?? 0)
  const host = opts?.host ?? process.env.ZDNOTES_MCP_HOST ?? '127.0.0.1'
  const corsOrigins = opts?.corsOrigins ?? []
  return { cfg, token, port, host, corsOrigins }
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (chunk) => { data += chunk })
    req.on('end', () => resolve(data))
    req.on('error', reject)
  })
}

function isAuthorized(req: IncomingMessage, token: string): boolean {
  if (!token) return true // 未配置 token 时允许（本地默认）
  const auth = req.headers.authorization ?? ''
  return auth === 'Bearer ' + token
}

function applyCors(req: IncomingMessage, res: ServerResponse, corsOrigins: string[]) {
  const origin = req.headers.origin
  if (origin && corsOrigins.length) {
    if (corsOrigins.includes('*') || corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', corsOrigins.includes('*') ? '*' : origin)
      res.setHeader('Access-Control-Allow-Headers', 'content-type, authorization')
      res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
      res.setHeader('Access-Control-Max-Age', '86400')
    }
  }
}

export async function runHttpServer(opts?: HttpServerOpts): Promise<{ port: number; host: string }> {
  const { cfg, token, port, host, corsOrigins } = readHttpConfig(opts)
  const server = new McpServer(opts)
  void cfg

  const http = createServer(async (req, res) => {
    applyCors(req, res, corsOrigins)

    // CORS 预检
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    // 鉴权
    if (!isAuthorized(req, token)) {
      res.writeHead(401, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } }))
      return
    }

    // 仅接受 POST /mcp
    if (req.method !== 'POST' || !(req.url === '/mcp' || req.url === '/')) {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Not Found' }))
      return
    }

    try {
      const body = await readBody(req)
      // 支持单对象或 batch 数组
      const requests = JSON.parse(body)
      const arr = Array.isArray(requests) ? requests : [requests]
      const acceptEventStream = (req.headers.accept ?? '').includes('text/event-stream')

      if (acceptEventStream && arr.length === 1) {
        // SSE 响应：单一请求，长连接推送
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        })
        const resp = await server.handleMessage(JSON.stringify(arr[0]))
        if (resp) {
          res.write('event: message\ndata: ' + JSON.stringify(resp) + '\n\n')
        }
        res.write('event: end\ndata: [DONE]\n\n')
        res.end()
      } else {
        // JSON 响应（含 batch）
        res.writeHead(200, { 'Content-Type': 'application/json' })
        const out: unknown[] = []
        for (const item of arr) {
          const resp = await server.handleMessage(JSON.stringify(item))
          if (resp) out.push(resp)
        }
        res.end(JSON.stringify(arr.length === 1 && !Array.isArray(requests) ? out[0] : out))
      }
    } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: String(e) } }),
      )
    }
  })

  return await new Promise((resolve) => {
    http.listen(port, host, () => {
      const addr = http.address()
      const actualPort = typeof addr === 'object' && addr ? addr.port : port
      console.log('[zdn-mcp http] listening on http://' + host + ':' + actualPort + '/mcp')
      if (token) console.log('[zdn-mcp http] authorization enabled (Bearer token required)')
      resolve({ port: actualPort, host })
    })
  })
}