import { ipcMain, app } from 'electron'
import { getAllSettings } from '../../main/database/settings-dao'
import { resolveFlags } from '../../core/feature-flags'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

function registerIpc(_ctx: MainModuleContext): void {
  ipcMain.handle('app:getVersion', () => app.getVersion())
  ipcMain.handle('app:getFeatures', () => resolveFlags(getAllSettings()))
}

export const appModule: FeatureModule = {
  id: 'app',
  name: '应用基础',
  kind: 'core',
  defaultEnabled: true,
  registerIpc,
}