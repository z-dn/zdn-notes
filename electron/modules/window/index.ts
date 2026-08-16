import { BrowserWindow, ipcMain, shell, nativeTheme } from 'electron'
import { join } from 'path'
import { setMainWindow, sendToRenderer } from '../../main/window-store'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

export function createMainWindow(): BrowserWindow | null {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true,
    },
  })

  setMainWindow(win)
  win.on('closed', () => {
    setMainWindow(null)
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
}