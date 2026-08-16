import { ipcMain, dialog, app } from 'electron'
import { join, isAbsolute, relative } from 'path'
import {
  getDataDir,
  getImagesDir,
  copyDataTo,
  clearDataDir,
  writeDataDirConfig,
} from '../../main/data-location'
import { getDB, reloadDB, getActiveDataDir, getDataDirFallback, isDBReady } from '../../main/database'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

function registerIpc(_ctx: MainModuleContext): void {
  ipcMain.handle('db:getDataDir', () => getActiveDataDir())

  ipcMain.handle('db:getDataDirFallback', () => getDataDirFallback())

  ipcMain.handle('db:chooseDataDir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择数据存储位置',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('db:setDataDir', async (_e, target: string) => {
    const currentDir = getDataDir()
    const targetDir = target && target.trim() ? target.trim() : app.getPath('userData')
    if (targetDir === currentDir) return { ok: true, path: currentDir }
    if (!isAbsolute(targetDir)) return { ok: false, error: '存储位置必须是绝对路径' }
    const rel = relative(currentDir, targetDir)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      return { ok: false, error: '新位置不能是当前数据目录或其子目录' }
    }
    try {
      const oldImagesDir = getImagesDir()
      const dbBuffer = getDB().export()
      copyDataTo(targetDir, dbBuffer, oldImagesDir)
      await reloadDB(join(targetDir, 'zdn-notes.db'))
      writeDataDirConfig(targetDir)
      clearDataDir(currentDir)
      return { ok: true, path: targetDir }
    } catch (e) {
      console.error('[db:setDataDir]', e)
      if (!isDBReady()) {
        try {
          await reloadDB()
        } catch (e2) {
          console.error('[db:setDataDir] rollback failed', e2)
        }
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

export const dataLocationModule: FeatureModule = {
  id: 'dataLocation',
  name: '数据位置',
  kind: 'core',
  defaultEnabled: true,
  registerIpc,
}