import { app, BrowserWindow, protocol } from 'electron'
import { closeDB } from './database'
import { APP_USER_MODEL_ID } from './app-id'
import { startAppShell, AppShell } from './app-shell'
import { createMainWindow } from '../modules/window'
import { getMainWindow } from './window-store'

protocol.registerSchemesAsPrivileged([
  { scheme: 'zdn-img', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])

let shell: AppShell | null = null

// 抑制 Chromium 的 `[pid:...:ERROR:...]` 噪音（webview mojo / SSL 握手失败等）刷屏，
// 否则经终端（opencode/IDE）启动 dev 时控制台被刷满。
app.commandLine.appendSwitch('disable-logging')

// Windows 任务栏按 AppUserModelID 归组并显示应用图标；必须在窗口创建前设置
if (process.platform === 'win32') {
  app.setAppUserModelId(APP_USER_MODEL_ID)
}

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

app.on('window-all-closed', () => {
  // 托盘驻留：所有窗口关闭后应用继续在后台运行（收件夹/提醒/更新等）。
  // 真正退出只经托盘菜单「退出」（触发 before-quit 清理）。
})

app.on('before-quit', () => {
  if (shell) shell.shutdown()
  closeDB()
})
