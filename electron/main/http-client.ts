import { net } from 'electron'
import { getAllSettings } from './database/settings-dao'
import { isPrivateHost } from './net-utils'
import type { HttpRequestConfig, HttpRequestResult } from '../core/contracts'

// ===================================================================
// 共享 HTTP 请求客户端。
// 被工具箱模块（http:request IPC）与插件 ctx 的 httpRequest 能力共用，
// 保证访问内网/本机地址的防护策略一致。
// ===================================================================

export async function httpRequest(config: HttpRequestConfig): Promise<HttpRequestResult> {
  const method = String(config?.method ?? 'GET').toUpperCase()
  const url = String(config?.url ?? '').trim()
  const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

  if (!validMethods.includes(method)) {
    return { ok: false, error: `不支持的请求方法: ${method}` }
  }
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: 'URL 必须以 http:// 或 https:// 开头' }
  }

  try {
    const settings = getAllSettings()
    if (settings.allowLocalRequests !== 'true' && (await isPrivateHost(new URL(url).hostname))) {
      return { ok: false, error: '禁止访问内网/本机地址（可在设置中开启）' }
    }
  } catch {
    // invalid URL: let the request below produce its own error
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
  try {
    const res = await net.fetch(url, {
      method,
      headers,
      body,
      signal: AbortSignal.timeout(15000),
    })
    const resHeaders: Record<string, string> = {}
    res.headers.forEach((value, key) => {
      resHeaders[key] = resHeaders[key] === undefined ? value : `${resHeaders[key]}, ${value}`
    })
    const raw = method === 'HEAD' ? '' : await res.text()
    return {
      ok: true,
      status: res.status,
      statusText: res.statusText,
      headers: resHeaders,
      body: raw,
      timeMs: Date.now() - startedAt,
      size: Buffer.byteLength(raw, 'utf-8'),
    }
  } catch (e) {
    const name = e instanceof Error ? e.name : ''
    let message = e instanceof Error ? e.message : String(e)
    if (name === 'TimeoutError' || name === 'AbortError') message = '请求超时（15s）'
    if (name === 'ERR_FAILED') message = '网络错误，无法连接到服务器'
    return { ok: false, error: message }
  }
}