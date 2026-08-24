import { ipcMain } from 'electron'
import { dshManager } from './dsh-manager'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

// ===================================================================
// dsh 内置平台模块：把 DeepSeek Harness 官方 Web UI 作为内嵌面板。
// Web UI 经 <webview> 渲染（渲染层），本模块只负责生命周期与就绪检查；
// 终端流方案（node-pty/xterm）已废弃——官方是 Web UI，无需 TTY。
// 配置（apiKey / model）直接复用 settings 表（dsh.apiKey / dsh.model）。
// ===================================================================

function registerIpc(ctx: MainModuleContext): void {
  dshManager.init({ dataDir: ctx.getDataDir() })
  dshManager.onChange((status) => ctx.send('dsh:statusChanged', status))

  ipcMain.handle('dsh:isReady', () => dshManager.isReady())
  ipcMain.handle('dsh:getStatus', () => dshManager.status())
  ipcMain.handle('dsh:start', (_e, opts: unknown) =>
    dshManager.start(opts as { apiKey?: string; model?: string } | undefined),
  )
  ipcMain.handle('dsh:stop', async () => {
    await dshManager.stop()
    return true
  })
}

function onShutdown(_ctx: MainModuleContext): void {
  dshManager.stop()
}

export const dshModule: FeatureModule = {
  id: 'dsh',
  name: 'DeepSeek Harness',
  kind: 'optional',
  defaultEnabled: false,
  registerIpc,
  onShutdown,
  renderer: {
    view: { id: 'dsh', label: 'DSH' },
  },
}
