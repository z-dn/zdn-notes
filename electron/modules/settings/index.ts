import { ipcMain } from 'electron'
import { getAllSettings, setSetting } from '../../main/database/settings-dao'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

function registerIpc(_ctx: MainModuleContext): void {
  ipcMain.handle('settings:getAll', () => getAllSettings())
  ipcMain.handle('settings:set', (_e, key, value) => setSetting(key, value))
}

export const settingsModule: FeatureModule = {
  id: 'settings',
  name: '设置',
  kind: 'core',
  defaultEnabled: true,
  registerIpc,
}