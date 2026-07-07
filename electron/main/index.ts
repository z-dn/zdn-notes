import { app, BrowserWindow, shell, ipcMain, Menu, nativeTheme } from 'electron'
import { join } from 'path'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { initDB, closeDB } from './database'
import { registerIpcHandlers } from './ipc'
import { getAllSettings } from './database/settings-dao'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    frame: false,
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  ipcMain.handle('window:minimize', () => mainWindow.minimize())
  ipcMain.handle('window:maximizeToggle', () => {
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.handle('window:close', () => mainWindow.close())
  ipcMain.handle('window:setThemeSource', (_e, source: 'system' | 'light' | 'dark') => {
    nativeTheme.themeSource = source
  })

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximizedChange', true))
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximizedChange', false))

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  autoUpdater.on('checking-for-update', () => {
    mainWindow.webContents.send('update:checking')
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow.webContents.send('update:available', info)
  })

  autoUpdater.on('update-not-available', (info) => {
    mainWindow.webContents.send('update:not-available', info)
  })

  autoUpdater.on('error', (err) => {
    mainWindow.webContents.send('update:error', err.message)
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow.webContents.send('update:progress', progress)
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow.webContents.send('update:downloaded', info)
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

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  await initDB()
  registerIpcHandlers()
  createWindow()

  const settings = getAllSettings()
  if (settings.autoUpdate !== 'false') {
    setTimeout(() => autoUpdater.checkForUpdates(), 3000)
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDB()
})
