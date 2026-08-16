import http from 'http'
import { resolveDataDir } from './data-location'
import { readGuiEndpoint, GuiEndpoint } from './lock'
import type { JsonRpcRequest, JsonRpcResponse } from './mcp-server'

// ===================================================================
// GUI-IPC 委托：GUI 运行时，zdn-mcp 把 tools/call 整包转发给 GUI 主进程的
// loopback 端点执行（GUI 为权威单写者，见 electron/main/mcp-ipc.ts），
// GUI 不在时回退本地文件模式（withDb + 文件锁）。
//
// 为什么转发整包而不是只转发数据：GUI 端用同一个 McpServer 处理请求，
// 权限白名单、参数校验、返回格式两端天然一致，无需维护两套执行路径。
// ===================================================================

// 构造一个 delegate：GUI 在跑则转发，否则返回 null 让 McpServer 走本地执行。
export function buildGuiDelegate(opts?: { dataDir?: string }): (
  req: JsonRpcRequest,
) => Promise<JsonRpcResponse | null> {
  const dataDir = opts?.dataDir?.trim() || resolveDataDir()
  return async (req: JsonRpcRequest): Promise<JsonRpcResponse | null> => {
    const ep0 = readGuiEndpoint(dataDir)
    if (!ep0) return null
    try {
      return await forwardCall(ep0, req)
    } catch (e) {
      const ep1 = readGuiEndpoint(dataDir)
      if (!ep1) return null // GUI 已退出 → 回退本地文件模式
      if (ep1.port === ep0.port && ep1.token === ep0.token) {
        // endpoint 未变却失败 → GUI 异常，不盲转文件模式（会被 GUI 锁挡住超时）
        throw new Error(
          'GUI 在线但 IPC 委托失败，请稍后重试: ' + (e instanceof Error ? e.message : String(e)),
          { cause: e },
        )
      }
      // GUI 已重启、endpoint 更新 → 用新 endpoint 重试一次
      return await forwardCall(ep1, req)
    }
  }
}

// 向 GUI 本地端点发送单个 JSON-RPC 请求。
export function forwardCall(ep: GuiEndpoint, req: JsonRpcRequest): Promise<JsonRpcResponse> {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(req)
    const request = http.request(
      {
        host: '127.0.0.1',
        port: ep.port,
        path: '/mcp',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          Authorization: 'Bearer ' + ep.token,
        },
      },
      (res) => {
        let data = ''
        res.on('data', (chunk) => {
          data += chunk
        })
        res.on('end', () => {
          if (!res.statusCode || res.statusCode >= 400) {
            reject(new Error('GUI IPC HTTP ' + res.statusCode))
            return
          }
          try {
            resolve(JSON.parse(data) as JsonRpcResponse)
          } catch {
            reject(new Error('invalid GUI IPC response'))
          }
        })
      },
    )
    request.setTimeout(10000, () => {
      request.destroy(new Error('GUI IPC 超时'))
    })
    request.on('error', reject)
    request.write(body)
    request.end()
  })
}