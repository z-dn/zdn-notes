import { app, BrowserWindow, ipcMain, shell, nativeTheme, Tray, Menu, nativeImage } from 'electron'
import { join } from 'path'
import { setMainWindow, sendToRenderer } from '../../main/window-store'
import { getDataDir } from '../../main/data-location'
import { loadConfig, configFileForDataDir } from '../../mcp/config'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

// 托盘驻留：关闭窗口仅隐藏到系统托盘，后台服务（MCP/收件夹/更新）继续运行。
// 真正的退出只经托盘菜单「退出」触发（quitting 标志放行 close 事件）。
let tray: Tray | null = null
let quitting = false

function trayIconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icon.png')
  }
  return join(__dirname, '../../resources/icon.png')
}

function showMainWindow(): void {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createTray(): void {
  if (tray) return
  const icon = nativeImage.createFromPath(trayIconPath())
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon)
  tray.setToolTip(tooltipText())
  // 右键动态重建菜单：每次弹出时重读 MCP 配置，状态始终最新
  tray.on('right-click', () => {
    tray?.setToolTip(tooltipText())
    tray?.popUpContextMenu(buildTrayMenu())
  })
  tray.on('click', showMainWindow)
}

function mcpStatus(): { enabled: boolean; count: number } {
  try {
    const cfg = loadConfig({ configFile: configFileForDataDir(getDataDir()) })
    return {
      enabled: cfg.enabled,
      count: Object.values(cfg.permissions).filter(Boolean).length,
    }
  } catch {
    return { enabled: false, count: 0 }
  }
}

function tooltipText(): string {
  const s = mcpStatus()
  return s.enabled ? `ZDNotes · MCP 已启用(${s.count} 个工具)` : 'ZDNotes · MCP 已停用'
}

function buildTrayMenu(): Menu {
  const s = mcpStatus()
  const statusLabel = s.enabled
    ? `AI 智能体(MCP): 已启用 · ${s.count} 个工具`
    : 'AI 智能体(MCP): 已停用'
  return Menu.buildFromTemplate([
    { label: statusLabel, enabled: false },
    { type: 'separator' },
    { label: '打开 ZDNotes', click: showMainWindow },
    { type: 'separator' },
    { label: '退出', click: () => quitApp() },
  ])
}

function quitApp(): void {
  quitting = true
  app.quit()
}

export function createMainWindow(): BrowserWindow | null {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
    icon: trayIconPath(),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
    },
  })

  setMainWindow(win)
  win.on('closed', () => {
    setMainWindow(null)
  })

  // 关窗不退出：仅隐藏到托盘；真正退出走托盘菜单（quitting=true）放行 close
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault()
      win.hide()
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    const url = new URL(details.url)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  win.on('maximize', () => sendToRenderer('window:maximizedChange', true))
  win.on('unmaximize', () => sendToRenderer('window:maximizedChange', false))

  win.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
      win.webContents.toggleDevTools()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(_ctx: MainModuleContext): void {
  ipcMain.handle('window:minimize', () => getWindow()?.minimize())
  ipcMain.handle('window:maximizeToggle', () => {
    const win = getWindow()
    if (!win) return
    if (win.isMaximized()) {
      win.unmaximize()
    } else {
      win.maximize()
    }
  })
  ipcMain.handle('window:close', () => getWindow()?.close())
  ipcMain.handle('window:setThemeSource', (_e, source: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = source
  })
}

function getWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

export const windowModule: FeatureModule = {
  id: 'window',
  name: '窗口控制',
  kind: 'core',
  defaultEnabled: true,
  registerIpc,
  onStart: () => {
    createTray()
  },
  onShutdown: () => {
    quitting = true
    tray?.destroy()
    tray = null
  },
}