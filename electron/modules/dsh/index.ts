import { BrowserWindow, ipcMain } from 'electron'
import { dshManager } from './dsh-manager'
import { DshViewController, type ViewRect } from './view-controller'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

// ===================================================================
// dsh 内置平台模块：把 DeepSeek Harness 官方 Web UI 作为内嵌面板。
// Web UI 由主进程 WebContentsView 承载（view-controller，切 tab 保活零重载），
// 渲染层只上报可见性/区域并负责胶囊控制条；本模块负责生命周期与就绪检查。
// 终端流方案（node-pty/xterm）已废弃——官方是 Web UI，无需 TTY。
// 配置（apiKey / model）直接复用 settings 表（dsh.apiKey / dsh.model）。
// ===================================================================

let lastLoadUrl = ''
function wireView(): void {
  dshManager.onChange((status) => {
    if (status.running && status.url) {
      // url（含 token）就绪：装载视图；可见性仍由渲染层控制（默认隐藏，
      // 等 DshPage 上报 dsh:setViewVisible(true, rect) 才显示）。
      // ⚠️ token 行可能早于渲染层首次上报：记录 lastLoadUrl，控制器懒创建
      // （setViewVisible 时）再补 load，否则显示的是从未加载的空白视图。
      lastLoadUrl = status.url
      for (const c of DshViewController.all()) c.ensureView(status.url)
    } else if (!status.running) {
      lastLoadUrl = ''
      void DshViewController.destroyAll()
    }
  })
}

function registerIpc(ctx: MainModuleContext): void {
  dshManager.init({ dataDir: ctx.getDataDir() })
  wireView()
  dshManager.onChange((status) => ctx.send('dsh:statusChanged', status))

  ipcMain.handle('dsh:isReady', () => dshManager.isReady())
  ipcMain.handle('dsh:getStatus', () => dshManager.status())
  ipcMain.handle('dsh:getVersion', () => dshManager.version())
  ipcMain.handle('dsh:start', (_e, opts: unknown) =>
    dshManager.start(opts as { apiKey?: string; model?: string } | undefined),
  )
  ipcMain.handle('dsh:stop', async () => {
    await dshManager.stop() // stop 的 onChange 分支已 destroy 全部 view
    return true
  })

  // 渲染层上报视图可见性 + 内容区矩形（DIP）
  ipcMain.handle('dsh:setViewVisible', (e, visible: unknown, rect: unknown) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const controller = DshViewController.forWindow(win)
    if (!controller) return
    const r = rect as Partial<ViewRect> | null
    const ok =
      !!r &&
      typeof r.x === 'number' &&
      typeof r.y === 'number' &&
      typeof r.width === 'number' &&
      typeof r.height === 'number'
    controller.setVisible(!!visible && ok, ok ? (r as ViewRect) : { x: 0, y: 0, width: 0, height: 0 })
    // 控制器懒创建补装载：token 可能早于本调用到达（ensureView 广播时实例还不存在）
    if (visible && ok && lastLoadUrl) controller.ensureView(lastLoadUrl)
  })

  // ---- 插件管理（自带 pnpm 转发，见 dsh-manager.pluginAction）----
  ipcMain.handle('dsh:listPlugins', () => dshManager.listPlugins())
  ipcMain.handle('dsh:addPlugin', (_e, spec: unknown) =>
    dshManager.pluginAction('add', typeof spec === 'string' ? spec : ''),
  )
  ipcMain.handle('dsh:removePlugin', (_e, name: unknown) =>
    dshManager.pluginAction('remove', typeof name === 'string' ? name : ''),
  )
  dshManager.onPluginLog((chunk) => ctx.send('dsh:pluginLog', chunk))
  dshManager.onPluginDone((result) => ctx.send('dsh:pluginDone', result))
}

function onShutdown(_ctx: MainModuleContext): void {
  dshManager.stop()
  void DshViewController.destroyAll()
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
