import { app, BrowserWindow, protocol } from 'electron'
import { closeDB } from './database'
import { getDataDir } from './data-location'
import { releaseGuiLock } from '../mcp/lock'
import { runStdio } from '../mcp/mcp-server'
import { runCli } from '../mcp/cli'
import { buildGuiDelegate } from '../mcp/gui-client'
import { startAppShell, AppShell } from './app-shell'
import { createMainWindow } from '../modules/window'

protocol.registerSchemesAsPrivileged([
  { scheme: 'zdn-img', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])

let shell: AppShell | null = null

// ---- MCP 服务 / CLI 入口（打包后智能体可直接以命令行拉起，无需 Node/npm）----
// 必须在单实例锁之前：GUI 在跑时，服务/CLI 进程不能被 requestSingleInstanceLock 挡退。
const mcpArgs = process.argv.slice(1)
if (mcpArgs.includes('--zdn-mcp-stdio')) {
  const dataDir = getDataDir()
  runStdio({ dataDir, delegate: buildGuiDelegate({ dataDir }) })
  // runStdio 由 stdin 生命周期管理，常驻不退出；不建窗口、不抢单实例/GUI 锁
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
      const win = BrowserWindow.getAllWindows()[0]
      if (win) {
        if (win.isMinimized()) win.restore()
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
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (shell) shell.shutdown()
  closeDB()
  releaseGuiLock(getDataDir())
})
