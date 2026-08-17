// ===================================================================
// zdn-mcp 入口分派
//   --stdio   以 MCP server (stdio) 模式运行，供智能体当本地 protocol server 拉起
//   --http    以 MCP Streamable HTTP 常驻服务模式运行（远程/多客户端；loopback + token）
//   （默认）   当作 CLI 使用（task add/list/... 等兜底命令）
//
// 传输层可插拔：stdio 与 http 都复用 mcp-server.ts 的 handleMessage 与数据层(db.ts)。
// ===================================================================

import { runStdio } from './mcp-server'
import { runHttpServer } from './http-server'
import { runCli } from './cli'
import { buildGuiDelegate, buildAppBridge } from './gui-client'
import { configFileForDataDir } from './config'
import { resolveDataDir } from './data-location'
import { appendCallLog, makeCallLogEntry } from './call-log'
import type { McpCallLogEntry } from './call-log'

// 独立 MCP 进程执行的调用（插件工具 / GUI 离线回退本地执行）统一落盘。
// GUI 在线时内置工具经 delegate 转交 GUI，由 GUI 端点记录，这里不会重复。
function mcpCallLogger(dataDir?: string): (call: Omit<McpCallLogEntry, 'id' | 'source'>) => void {
  return (call) => {
    appendCallLog(dataDir?.trim() || resolveDataDir(), makeCallLogEntry({ ...call, source: 'mcp' }))
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)

  // MCP http 常驻模式
  if (argv.includes('--http')) {
    const opts = parseHttpOpts(argv)
    await runHttpServer({
      ...opts,
      delegate: buildGuiDelegate({ dataDir: opts.dataDir }),
      appBridge: buildAppBridge({ dataDir: opts.dataDir }),
      onCall: mcpCallLogger(opts.dataDir),
    })
    return // 常驻，不退出
  }

  // MCP stdio 模式：--stdio 或受智能体拉起时
  if (argv.includes('--stdio')) {
    const opts = parseStdioOpts(argv)
    runStdio({
      ...opts,
      delegate: buildGuiDelegate({ dataDir: opts.dataDir }),
      appBridge: buildAppBridge({ dataDir: opts.dataDir }),
      onCall: mcpCallLogger(opts.dataDir),
    })
    return // 由 stdin 生命周期管理，不会 resolve
  }

  // 纯 CLI 模式
  const code = await runCli(argv)
  process.exitCode = code
}

interface StdioOpts {
  configFile?: string
  dataDir?: string
  waitMs?: number
}
interface HttpCliOpts {
  port?: number
  host?: string
  token?: string
  corsOrigins?: string[]
  configFile?: string
  dataDir?: string
  waitMs?: number
}
function parseStdioOpts(argv: string[]): StdioOpts {
  return parseHttpOpts(argv)
}
function parseHttpOpts(argv: string[]): HttpCliOpts & StdioOpts {
  const opts: HttpCliOpts & StdioOpts = {}
  const take = (flag: string): string | undefined => {
    const idx = argv.indexOf(flag)
    return idx >= 0 && argv[idx + 1] ? argv[idx + 1] : undefined
  }
  const cf = take('--config-file')
  const dd = take('--data-dir')
  const wm = take('--wait-ms')
  const port = take('--port')
  const host = take('--host')
  const token = take('--token')
  const cors = take('--cors-origins')
  if (cf) opts.configFile = cf
  if (dd) {
    opts.dataDir = dd
    // 配置跟随数据目录，保证两端（MCP 进程 / GUI 端点）读同一份 agent-mcp-config.json
    if (!cf) opts.configFile = configFileForDataDir(dd)
  }
  if (wm) opts.waitMs = Number(wm)
  if (port) opts.port = Number(port)
  if (host) opts.host = host
  if (token) opts.token = token
  if (cors)
    opts.corsOrigins = cors
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
  return opts
}

main().catch((e) => {
  process.stderr.write('fatal: ' + (e instanceof Error ? e.stack || e.message : String(e)) + '\n')
  process.exit(1)
})
