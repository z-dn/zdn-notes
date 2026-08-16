import { ipcMain, app } from 'electron'
import pkg from 'electron-updater'
const { autoUpdater } = pkg
import { getAllSettings } from '../../main/database/settings-dao'
import { sendToRenderer } from '../../main/window-store'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

function registerIpc(_ctx: MainModuleContext): void {
  ipcMain.handle('update:check', () => {
    autoUpdater.checkForUpdates()
  })
  ipcMain.handle('update:download', () => {
    autoUpdater.downloadUpdate()
  })
  ipcMain.handle('update:install', () => {
    autoUpdater.quitAndInstall()
  })
}

function onStart(_ctx: MainModuleContext): void {
  autoUpdater.on('checking-for-update', () => {
    sendToRenderer('update:checking')
  })
  autoUpdater.on('update-available', (info) => {
    sendToRenderer('update:available', info)
  })
  autoUpdater.on('update-not-available', (info) => {
    sendToRenderer('update:not-available', info)
  })
  autoUpdater.on('error', (err) => {
    console.error('[autoUpdater]', err.message)
    sendToRenderer('update:error', err.message)
  })
  autoUpdater.on('download-progress', (progress) => {
    sendToRenderer('update:progress', progress)
  })
  autoUpdater.on('update-downloaded', (info) => {
    sendToRenderer('update:downloaded', info)
  })

  const settings = getAllSettings()
  if (app.isPackaged && settings.autoUpdate !== 'false') {
    setTimeout(() => autoUpdater.checkForUpdates(), 3000)
  }
}

export const updaterModule: FeatureModule = {
  id: 'updater',
  name: '自动更新',
  kind: 'optional',
  defaultEnabled: true,
  registerIpc,
  onStart,
}