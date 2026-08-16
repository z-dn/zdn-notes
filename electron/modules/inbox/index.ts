import { ipcMain, shell } from 'electron'
import { inboxDir, startInboxWatcher } from '../../main/import-inbox'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

function registerIpc(_ctx: MainModuleContext): void {
  ipcMain.handle('inbox:getDir', () => inboxDir())

  ipcMain.handle('inbox:openDir', async () => {
    const err = await shell.openPath(inboxDir())
    return err || true
  })
}

function onStart(ctx: MainModuleContext): void {
  startInboxWatcher((result) => {
    ctx.send('inbox:processed', result)
  })
}

export const inboxModule: FeatureModule = {
  id: 'inbox',
  name: '收件夹',
  kind: 'optional',
  defaultEnabled: true,
  registerIpc,
  onStart,
}