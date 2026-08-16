// 示例插件：HTTP 请求（agent-tools/http）
//
// 运行在受限 VM 沙箱中，只能使用 ctx 提供的授权能力：
//   ctx.httpRequest(config)  — 需 ztool.json 声明权限 "http:request"
//   ctx.storage              — 插件隔离的 KV 存储
//   ctx.log(level, msg)      — 日志
//
// 工具 key 缺省由 loader 规范为 `<pluginId>.<name>`，可显式覆盖。
// 安装：把本目录整个复制到数据目录下的 agent-tools/http 即可。

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
        if (!ctx.httpRequest) {
          return { ok: false, error: '插件未获得 http:request 能力（权限不足）' }
        }
        ctx.log('info', `http_request -> ${args.method ?? 'GET'} ${args.url}`)
        return ctx.httpRequest(args)
      },
    },
  ],
}
