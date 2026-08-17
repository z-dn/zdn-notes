import { ipcMain, shell } from 'electron'
import { inboxDir, startInboxWatcher } from '../../main/import-inbox'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'
import type { AppService } from '../../core/app-service'

// 应用业务层：收件夹路径（UI 与插件 ctx.app 共用）
function appService(svc: AppService, _ctx: MainModuleContext): void {
  svc.register('inbox:getDir', () => inboxDir())
}

function registerIpc(_ctx: MainModuleContext): void {
  // 打开文件夹属 UI 操作，保持 IPC 专属
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
  appService,
  onStart,
}