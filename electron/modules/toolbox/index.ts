import { ipcMain } from 'electron'
import { getAllToolState, setToolState } from '../../main/database/tool-state-dao'
import { httpRequest } from '../../main/http-client'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

function registerIpc(_ctx: MainModuleContext): void {
  ipcMain.handle('tool:getAll', () => getAllToolState())
  ipcMain.handle('tool:set', (_e, key, value) => setToolState(key, value))
  ipcMain.handle('http:request', (_e, config) => httpRequest(config))
}

export const toolboxModule: FeatureModule = {
  id: 'toolbox',
  name: '工具箱',
  kind: 'optional',
  defaultEnabled: true,
  registerIpc,
  renderer: {
    view: { id: 'toolbox', label: '工具箱' },
  },
}