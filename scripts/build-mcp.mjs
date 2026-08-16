// ===================================================================
// 构建纯 Node MCP 入口（electron/mcp/index.ts）→ out/mcp/index.cjs
//
// 用途：打包后的 ZDNotes.exe 收到 --zdn-mcp-stdio 时，以
//   ELECTRON_RUN_AS_NODE=1 自举一个纯 Node 子进程跑这个 bundle 做 MCP stdio
//   server（Electron 主进程的 process.stdin 在 Windows 上是坏的：启动即 EOF，
//   无法承载 stdio 传输）。bundle 只含 node 内建 + 外部 sql.js，不含 Electron。
//
// CJS 输出原因：plugin-loader 的沙箱 require 直接引用模块作用域 require，
// CJS 天然可用，无需 createRequire 垫片。
// ===================================================================

import { build } from 'esbuild'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), '..')

await build({
  entryPoints: [resolve(root, 'electron/mcp/index.ts')],
  outfile: resolve(root, 'out/mcp/index.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['sql.js'],
  alias: { '@': resolve(root, 'src') },
  sourcemap: true,
  logLevel: 'info',
})
