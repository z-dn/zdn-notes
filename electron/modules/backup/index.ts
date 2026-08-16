import { ipcMain, dialog } from 'electron'
import { backupDatabase, restoreDatabase } from '../../main/backup'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

function registerIpc(_ctx: MainModuleContext): void {
  ipcMain.handle('db:export', async () => {
    const result = await dialog.showSaveDialog({
      title: '备份数据',
      defaultPath: `zdn-notes-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZDNotes 备份', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return false
    try {
      backupDatabase(result.filePath)
      return true
    } catch (e) {
      console.error('[db:export]', e)
      return false
    }
  })

  ipcMain.handle('db:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '恢复数据',
      properties: ['openFile'],
      filters: [{ name: 'ZDNotes 备份', extensions: ['zip'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, error: '已取消' }
    try {
      await restoreDatabase(result.filePaths[0])
      return { ok: true }
    } catch (e) {
      console.error('[db:import]', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

export const backupModule: FeatureModule = {
  id: 'backup',
  name: '备份恢复',
  kind: 'core',
  defaultEnabled: true,
  registerIpc,
}