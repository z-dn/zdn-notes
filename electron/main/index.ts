import { app, BrowserWindow, protocol } from 'electron'
import { spawn } from 'child_process'
import path from 'path'
import { fileURLToPath } from 'url'
import { existsSync } from 'fs'
import { closeDB } from './database'
import { getDataDir } from './data-location'
import { releaseGuiLock } from '../mcp/lock'
import { runCli } from '../mcp/cli'
import { startAppShell, AppShell } from './app-shell'
import { createMainWindow } from '../modules/window'
import { getMainWindow } from './window-store'

protocol.registerSchemesAsPrivileged([
  { scheme: 'zdn-img', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])

let shell: AppShell | null = null

// ---- MCP 服务 / CLI 入口（打包后智能体可直接以命令行拉起，无需 Node/npm）----
// 必须在单实例锁之前：GUI 在跑时，服务/CLI 进程不能被 requestSingleInstanceLock 挡退。
const mcpArgs = process.argv.slice(1)
if (mcpArgs.includes('--zdn-mcp-stdio')) {
  // Electron 主进程的 process.stdin 在 Windows 上启动即 EOF（readline 立即 close），
  // 无法承载 MCP stdio 传输。这里以 ELECTRON_RUN_AS_NODE=1 自举一个纯 Node 子进程
  // （out/mcp/index.cjs，由 scripts/build-mcp.mjs 打包）跑 MCP stdio server，
  // 子进程直接继承本进程的 stdin/stdout 管道；本进程保持存活并镜像子进程退出码。
  const dataDir = getDataDir()
  // 相对主 bundle（out/main/index.js）定位：out/main → ../mcp/index.cjs。
  // 开发（electron . 或直接跑 out/main/index.js）与打包（resources/app）布局一致。
  const mainDir = path.dirname(fileURLToPath(import.meta.url))
  const mcpEntry = path.join(mainDir, '..', 'mcp', 'index.cjs')
  if (!existsSync(mcpEntry)) {
    process.stderr.write(`fatal: MCP bundle not found at ${mcpEntry}（请先运行 npm run build:mcp）\n`)
    app.exit(1)
  }
  // 调试：设置 ZDNOTES_MCP_INSPECT=<port> 时给子进程挂 V8 inspector（仅开发用；
  // 不设置则与打包行为完全一致，此环境变量默认不影响线上）。
  const inspectPort = process.env.ZDNOTES_MCP_INSPECT?.trim()
  const childArgs = inspectPort ? [`--inspect=${inspectPort}`, mcpEntry] : [mcpEntry]
  const child = spawn(process.execPath, [...childArgs, '--stdio', '--data-dir', dataDir], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['inherit', 'inherit', 'inherit'],
  })
  child.on('error', (e) => {
    process.stderr.write('fatal: failed to start MCP server: ' + e.message + '\n')
    app.exit(1)
  })
  child.on('exit', (code, signal) => {
    if (signal) process.stderr.write('MCP server terminated by ' + signal + '\n')
    app.exit(code ?? 0)
  })
  // 不建窗口、不抢单实例/GUI 锁；子进程 handle 保持本进程常驻
} else if (mcpArgs.includes('--zdn-mcp-cli')) {
  const idx = mcpArgs.indexOf('--zdn-mcp-cli')
  runCli(mcpArgs.slice(idx + 1))
    .then((code) => app.exit(code))
    .catch((e) => {
      process.stderr.write('fatal: ' + (e instanceof Error ? e.message : String(e)) + '\n')
      app.exit(1)
    })
} else {
  const gotTheLock = app.requestSingleInstanceLock()

  if (!gotTheLock) {
    app.quit()
  } else {
    app.on('second-instance', () => {
      // 聚焦主窗口（而非任意第一个窗口）：主窗口是托盘驻留/通知的锚点
      const win = getMainWindow()
      if (win) {
        if (win.isMinimized()) win.restore()
        if (!win.isVisible()) win.show()
        win.focus()
      }
    })

    app.whenReady().then(async () => {
      shell = await startAppShell()
      createMainWindow()

      app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
      })
    })
  }
}

app.on('window-all-closed', () => {
  // 托盘驻留：所有窗口关闭后应用继续在后台运行（MCP/收件夹/更新等）。
  // 真正退出只经托盘菜单「退出」（触发 before-quit 清理）。
})

app.on('before-quit', () => {
  if (shell) shell.shutdown()
  closeDB()
  releaseGuiLock(getDataDir())
})
