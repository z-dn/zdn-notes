import { app, BrowserWindow, shell, ipcMain, Menu, nativeTheme, protocol, net } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import fs from 'fs'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { initDB, closeDB, getDB, saveAsync } from './database'
import { registerIpcHandlers } from './ipc'
import { getAllSettings } from './database/settings-dao'
import { getImagesDir, getDataDir } from './data-location'
import { startInboxWatcher } from './import-inbox'
import { isSafeImageFilename } from './image-utils'
import { acquireGuiLock, releaseGuiLock } from '../mcp/lock'
import { startMcpIpc } from './mcp-ipc'
import type { McpIpcServer } from './mcp-ipc'
import { runStdio } from '../mcp/mcp-server'
import { runCli } from '../mcp/cli'
import { buildGuiDelegate } from '../mcp/gui-client'
import { loadConfig, writeConfig, configFileForDataDir } from '../mcp/config'

protocol.registerSchemesAsPrivileged([
  { scheme: 'zdn-img', privileges: { bypassCSP: true, stream: true, supportFetchAPI: true, corsEnabled: true } }
])

let mainWindow: BrowserWindow | null = null
let mcpIpc: McpIpcServer | null = null

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
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    Menu.setApplicationMenu(null)
    registerUpdateHandlers()
    await initDB()
    // GUI-IPC：GUI 作为权威单写者，启动本地端点并把 port/token 写进 GUI 锁，
    // 智能体 zdn-mcp 检测到 GUI 在跑时会把 tools/call 委托到这里执行。
    mcpIpc = await startMcpIpc({
      dataDir: getDataDir(),
      getDB,
      saveAsync,
      notify: () => mainWindow?.webContents.send('data:changed'),
    })
    // GUI 优先：启动即获取数据目录文件锁，成为权威写者（智能体 zdn-mcp 会尊重此锁）
    acquireGuiLock(getDataDir(), { port: mcpIpc.port, token: mcpIpc.token })
    // 设置界面读写 MCP 配置（agent-mcp-config.json）；写入后热更新 GUI 委托端点
    ipcMain.handle('mcp:getConfig', () => loadConfig({ configFile: configFileForDataDir(getDataDir()) }))
    ipcMain.handle('mcp:setConfig', (_e, cfg: unknown) => {
      writeConfig(configFileForDataDir(getDataDir()), cfg as Parameters<typeof writeConfig>[1])
      mcpIpc?.reloadConfig()
      return loadConfig({ configFile: configFileForDataDir(getDataDir()) })
    })
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
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  closeDB()
  if (mcpIpc) void mcpIpc.stop()
  releaseGuiLock(getDataDir())
})
