import { ipcMain } from 'electron'
import { dshManager } from './dsh-manager'
import { getAllSettings } from '../../main/database/settings-dao'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

// ===================================================================
// dsh 内置平台模块：把 DeepSeek Harness 官方 Web UI 作为内嵌面板。
// Web UI 由渲染层 DshWebviewLayer 的 iframe 承载（App 层常驻保活，
// 切 tab 零重载）；本模块只负责 DSH 子进程生命周期、状态推送与就绪检查。
// 终端流方案（node-pty/xterm）已废弃——官方是 Web UI，无需 TTY。
// 配置（apiKey / model）直接复用 settings 表（dsh.apiKey / dsh.model）。
// ===================================================================

function registerIpc(ctx: MainModuleContext): void {
  dshManager.init({ dataDir: ctx.getDataDir() })
  dshManager.onChange((status) => ctx.send('dsh:statusChanged', status))

  ipcMain.handle('dsh:isReady', () => dshManager.isReady())
  ipcMain.handle('dsh:getStatus', () => dshManager.status())
  ipcMain.handle('dsh:getVersion', () => dshManager.version())
  ipcMain.handle('dsh:start', (_e, opts: unknown) =>
    dshManager.start(opts as { apiKey?: string; model?: string } | undefined),
  )
  ipcMain.handle('dsh:stop', async () => {
    await dshManager.stop()
    return true
  })

  // ---- 插件管理（自带 pnpm 转发，见 dsh-manager.pluginAction）----
  ipcMain.handle('dsh:listPlugins', () => dshManager.listPlugins())
  ipcMain.handle('dsh:addPlugin', (_e, spec: unknown) =>
    dshManager.pluginAction('add', typeof spec === 'string' ? spec : ''),
  )
  ipcMain.handle('dsh:removePlugin', (_e, name: unknown) =>
    dshManager.pluginAction('remove', typeof name === 'string' ? name : ''),
  )
  ipcMain.handle('dsh:restoreQuarantine', (_e, entryId: unknown) =>
    dshManager.restoreQuarantine(typeof entryId === 'string' ? entryId : ''),
  )
  dshManager.onPluginLog((chunk) => ctx.send('dsh:pluginLog', chunk))
  dshManager.onPluginDone((result) => ctx.send('dsh:pluginDone', result))

  // ---- 运行时升级 + 兼容性检测 ----
  ipcMain.handle('dsh:checkRuntimeUpdate', () => dshManager.checkRuntimeUpdate())
  ipcMain.handle('dsh:checkPluginCompatibility', () => dshManager.checkPluginCompatibility())
  ipcMain.handle('dsh:previewUpgrade', (_e, target: unknown) =>
    dshManager.previewUpgrade(typeof target === 'string' ? target : ''),
  )
  ipcMain.handle('dsh:preflightUpgrade', (_e, target: unknown) =>
    dshManager.preflightUpgrade(typeof target === 'string' ? target : ''),
  )
  ipcMain.handle('dsh:upgradeRuntime', (_e, target: unknown) =>
    dshManager.upgradeRuntime(typeof target === 'string' ? target : ''),
  )
  ipcMain.handle('dsh:revertRuntime', () => dshManager.revertRuntime())
  ipcMain.handle('dsh:restorePreviousRuntime', () => dshManager.restorePreviousRuntime())
  ipcMain.handle('dsh:getRuntimeNotes', (_e, version: unknown) =>
    dshManager.getRuntimeReleaseNotes(typeof version === 'string' ? version : ''),
  )
  ipcMain.handle('dsh:setRuntimePin', (_e, version: unknown) =>
    dshManager.setRuntimePin(typeof version === 'string' ? version : null),
  )
  ipcMain.handle('dsh:setRuntimeIgnored', (_e, version: unknown, ignored: unknown) =>
    dshManager.setRuntimeIgnored(typeof version === 'string' ? version : '', ignored === true),
  )
  ipcMain.handle('dsh:backupHome', () => dshManager.backupDshHome())
  ipcMain.handle('dsh:repairProfile', () => dshManager.repairProfileDeps())
  dshManager.onUpgradeLog((chunk) => ctx.send('dsh:upgradeLog', chunk))
  dshManager.onUpgradeDone((result) => ctx.send('dsh:upgradeDone', result))

  // 启动自动拉起 DSH（设置 autoStartDsh，仅后台启动服务、不切视图）。
  // 必须放在 init 之后（isReady/start 依赖 dataDir），故不能用 onStart——
  // app-shell 先 startAll 后 registerIpcAll，onStart 时 init 尚未执行。
  // 模块开关已由 registry 门控（dsh 禁用时本函数不执行）；start() 幂等。
  if (getAllSettings().autoStartDsh === 'true' && dshManager.isReady().ready) {
    void dshManager.start()
  }
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
