// 示例插件：HTTP 请求（agent-tools/http）
//
// 插件是完整 Node 模块（无沙箱、无依赖限制）：直接用 Node 原生 http/https 发起请求，
// 无需任何平台能力注入。ctx 仅提供 storage / log / dataDir / app 等便利设施。
//
// 工具 key 缺省由 loader 规范为 `<pluginId>.<name>`，可显式覆盖。
// 安装：把本目录整个复制到数据目录下的 agent-tools/http 即可。

const http = require('http')
const https = require('https')

function toHeaders(arr) {
  const out = {}
  if (Array.isArray(arr)) {
    for (const h of arr) {
      const key = String(h?.key ?? '').trim()
      if (key) out[key] = String(h?.value ?? '')
    }
  }
  return out
}

module.exports = {
  tools: [
    {
      key: 'http:request',
      name: 'http_request',
      label: 'HTTP 请求',
      description: '发起一个 HTTP/HTTPS 请求并返回响应（状态码/头/正文/耗时）',
      inputSchema: {
        type: 'object',
        properties: {
          method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'], description: '请求方法，默认 GET' },
          url: { type: 'string', description: '请求地址（必填，http/https）' },
          headers: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: 'string' } } }, description: '请求头' },
          body: { type: 'string', description: '请求体' },
        },
        required: ['url'],
      },
      run: async (ctx, args) => {
        const method = String(args.method ?? 'GET').toUpperCase()
        const url = String(args.url ?? '').trim()
        ctx.log('info', `http_request -> ${method} ${url}`)
        const startedAt = Date.now()
        return new Promise((resolve) => {
          let parsed
          try {
            parsed = new URL(url)
          } catch {
            resolve({ ok: false, error: 'URL 必须是合法的 http(s) 地址' })
            return
          }
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            resolve({ ok: false, error: 'URL 必须以 http:// 或 https:// 开头' })
            return
          }
          const lib = parsed.protocol === 'https:' ? https : http
          const req = lib.request(
            parsed,
            { method, headers: toHeaders(args.headers), timeout: 15000 },
            (res) => {
              let body = ''
              res.setEncoding('utf-8')
              res.on('data', (chunk) => {
                body += chunk
              })
              res.on('end', () => {
                resolve({
                  ok: true,
                  status: res.statusCode,
                  statusText: res.statusMessage,
                  headers: res.headers,
                  body,
                  timeMs: Date.now() - startedAt,
                })
              })
            },
          )
          req.on('timeout', () => req.destroy(new Error('timeout')))
          req.on('error', (e) => resolve({ ok: false, error: e.message }))
          if (args.body && method !== 'GET' && method !== 'HEAD') req.write(String(args.body))
          req.end()
        })
      },
    },
  ],
}