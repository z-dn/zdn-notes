import http from 'http'
import https from 'https'
import { isPrivateHost } from '../main/net-utils'
import type { HttpRequestConfig, HttpRequestResult } from '../core/contracts'

// ===================================================================
// 插件 ctx 的 httpRequest 能力（Node http/https，无 Electron 依赖）。
// 与工具箱 IPC 共用 isPrivateHost 防护策略；可在独立 MCP 进程与 GUI 中共用。
// 本机地址防护：插件默认禁止访问内网/本机，除非设置 allowLocalRequests=true
// （该设置经 settings 表读取，独立进程由 withDb 加载的库提供）。
// ===================================================================

function readAllowLocalRequests(): boolean {
  try {
    // 独立进程：设置存于打开数据库的 settings 表（tool ctx 无 db，这里只读该值）
    // GUI：通过主进程模块注入的读取函数判断（见 buildPluginHttpCapability）
    const g = globalThis as { __zdnAllowLocalRequests?: () => boolean }
    if (typeof g.__zdnAllowLocalRequests === 'function') return g.__zdnAllowLocalRequests()
  } catch {
    /* ignore */
  }
  return false
}

export function buildHttpCapability(opts?: {
  allowLocalRequests?: boolean
}): (config: HttpRequestConfig) => Promise<HttpRequestResult> {
  return async function httpRequest(config) {
    const method = String(config?.method ?? 'GET').toUpperCase()
    const url = String(config?.url ?? '').trim()
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

    if (!validMethods.includes(method)) {
      return { ok: false, error: `不支持的请求方法: ${method}` }
    }
    let parsed: URL
    try {
      parsed = new URL(url)
    } catch {
      return { ok: false, error: 'URL 必须是合法的 http(s) 地址' }
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return { ok: false, error: 'URL 必须以 http:// 或 https:// 开头' }
    }

    const allowLocal = opts?.allowLocalRequests ?? readAllowLocalRequests()
    if (!allowLocal && (await isPrivateHost(parsed.hostname))) {
      return { ok: false, error: '禁止访问内网/本机地址（可在设置中开启）' }
    }

    const headers: Record<string, string> = {}
    if (Array.isArray(config?.headers)) {
      for (const h of config.headers) {
        const key = String(h?.key ?? '').trim()
        if (!key) continue
        const value = h?.value == null ? '' : String(h.value)
        headers[key] = headers[key] === undefined ? value : `${headers[key]}, ${value}`
      }
    }
    const rawBody = config?.body == null ? '' : String(config.body)
    const body = method === 'HEAD' || rawBody === '' ? undefined : rawBody

    const startedAt = Date.now()
    const lib = parsed.protocol === 'https:' ? https : http

    return new Promise<HttpRequestResult>((resolve) => {
      const req = lib.request(
        parsed,
        {
          method,
          headers,
          timeout: 15000,
        },
        (res) => {
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c as Buffer))
          res.on('end', () => {
            const buf = Buffer.concat(chunks)
            const resHeaders: Record<string, string> = {}
            for (const [k, v] of Object.entries(res.headers)) {
              const value = Array.isArray(v) ? v.join(', ') : String(v)
              resHeaders[k] = value
            }
            resolve({
              ok: true,
              status: res.statusCode,
              statusText: res.statusMessage,
              headers: resHeaders,
              body: method === 'HEAD' ? '' : buf.toString('utf-8'),
              timeMs: Date.now() - startedAt,
              size: buf.byteLength,
            })
          })
        },
      )
      req.on('timeout', () => {
        req.destroy(new Error('timeout'))
      })
      req.on('error', (e) => {
        const name = e.name ?? ''
        let message = e.message ?? String(e)
        if (name === 'TimeoutError' || name === 'AbortError' || /timeout/i.test(message))
          message = '请求超时（15s）'
        if (/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH/.test(message)) message = '网络错误，无法连接到服务器'
        resolve({ ok: false, error: message })
      })
      if (body !== undefined) req.write(body)
      req.end()
    })
  }
}