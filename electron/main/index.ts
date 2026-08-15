import { app, BrowserWindow, shell, ipcMain, Menu, nativeTheme, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import fs from 'fs'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { initDB, closeDB } from './database'
import { registerIpcHandlers } from './ipc'
import { getAllSettings } from './database/settings-dao'
import { getImagesDir } from './data-location'
import { startInboxWatcher } from './import-inbox'
import { isSafeImageFilename } from './image-utils'

protocol.registerSchemesAsPrivileged([
  { scheme: 'zdn-img', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])

let mainWindow: BrowserWindow | null = null

function registerWindowIpc(): void {
  ipcMain.handle('window:minimize', () => mainWindow?.minimize())
  ipcMain.handle('window:maximizeToggle', () => {
    if (!mainWindow) return
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow.maximize()
    }
  })
  ipcMain.handle('window:close', () => mainWindow?.close())
  ipcMain.handle('window:setThemeSource', (_e, source: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = source
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: true
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    const url = new URL(details.url)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      shell.openExternal(details.url)
    }
    return { action: 'deny' }
  })

  mainWindow.on('maximize', () => mainWindow?.webContents.send('window:maximizedChange', true))
  mainWindow.on('unmaximize', () => mainWindow?.webContents.send('window:maximizedChange', false))

  mainWindow.webContents.on('before-input-event', (_e, input) => {
    if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
      mainWindow?.webContents.toggleDevTools()
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function registerUpdateHandlers(): void {
  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('update:available', info)
  })

  autoUpdater.on('update-not-available', (info) => {
    mainWindow?.webContents.send('update:not-available', info)
  })

  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater]', err.message)
    mainWindow?.webContents.send('update:error', err.message)
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('update:progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('update:downloaded', info)
  })
}

ipcMain.handle('update:check', () => {
  autoUpdater.checkForUpdates()
})

ipcMain.handle('update:download', () => {
  autoUpdater.downloadUpdate()
})

ipcMain.handle('update:install', () => {
  autoUpdater.quitAndInstall()
})

const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    registerUpdateHandlers()
    await initDB()
    registerIpcHandlers()
    registerWindowIpc()

    const imagesDir = getImagesDir()
    fs.mkdirSync(imagesDir, { recursive: true })
    protocol.handle('zdn-img', (request) => {
      const url = new URL(request.url)
      const filename = decodeURIComponent(url.pathname.replace(/^\//, ''))
      if (!isSafeImageFilename(filename)) {
        return new Response('Forbidden', { status: 403 })
      }
      const fullPath = join(getImagesDir(), filename)
      return net.fetch(pathToFileURL(fullPath).href)
    })

    createWindow()

    startInboxWatcher((result) => {
      mainWindow?.webContents.send('inbox:processed', result)
    })

    const settings = getAllSettings()
    if (app.isPackaged && settings.autoUpdate !== 'false') {
      setTimeout(() => autoUpdater.checkForUpdates(), 3000)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDB()
})
