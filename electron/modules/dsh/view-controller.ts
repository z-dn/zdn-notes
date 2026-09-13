import { BrowserWindow, WebContentsView } from 'electron'

// ===================================================================
// DshViewController —— 以主进程 WebContentsView 承载 DSH Web UI。
//
// 渲染层的 <webview> 会随 React 卸载（切 tab）被销毁重载，切回 DSH 页
// 要整页重新加载（几秒白屏）。WebContentsView 归主进程所有，与 React
// 树无关：切 tab 只是 setBounds / 隐藏，切回零加载（保活）。
//
// 层叠规则（Electron 约束）：WebContentsView 恒绘制在窗口 DOM 之上，
// 渲染层无法在自己的页面里盖住它。因此：
//   - 内容区底部预留一条胶囊控制条（DOM），布局由渲染层给出；
//   - 渲染层需要弹出覆盖层（插件对话框）时先隐藏视图。
// bounds / 可见性都由渲染层经 `dsh:setViewVisible` 上报（DIP，与
// getBoundingClientRect 同坐标系）。
//
// 按 BrowserWindow 实例隔离（主窗口 + window:openView 多窗口各挂一个），
// stop / 退出时 destroyAll()。
// ===================================================================

export interface ViewRect {
  x: number
  y: number
  width: number
  height: number
}

export class DshViewController {
  private win: BrowserWindow
  private view: WebContentsView | null = null
  private loadedUrl: string | null = null
  private rect: ViewRect | null = null
  private visible = false

  private constructor(win: BrowserWindow) {
    this.win = win
    win.once('closed', () => {
      void this.destroy()
      DshViewController.instances.delete(win.id)
    })
  }

  private static instances = new Map<number, DshViewController>()

  /** 取（或为指定窗口创建）控制器；窗口已关闭返回 null */
  static forWindow(win: BrowserWindow | null): DshViewController | null {
    if (!win) return null
    let inst = this.instances.get(win.id)
    if (!inst) {
      inst = new DshViewController(win)
      this.instances.set(win.id, inst)
    }
    return inst
  }

  static get(win: BrowserWindow | null): DshViewController | null {
    if (!win) return null
    return this.instances.get(win.id) ?? null
  }

  /** 全部存活实例（遍历装载用） */
  static all(): DshViewController[] {
    return [...this.instances.values()]
  }

  /** 装载 DSH 入口 URL：视图不存在则创建（隐藏），URL 变化则重载 */
  ensureView(url: string): void {
    if (this.win.isDestroyed()) return
    if (!this.view) {
      this.view = new WebContentsView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      })
      this.win.contentView.addChildView(this.view)
      this.view.setVisible(false)
      this.applyBounds()
    }
    if (this.loadedUrl !== url) {
      this.loadedUrl = url
      void this.view.webContents.loadURL(url)
    }
  }

  /** 渲染层上报可见性 + 内容区矩形（胶囊条以下的部分） */
  setVisible(visible: boolean, rect: ViewRect): void {
    this.visible = visible
    this.rect = rect
    if (this.view && this.rect) {
      this.applyBounds()
      this.view.setVisible(visible)
    }
  }

  private applyBounds(): void {
    if (!this.view || !this.rect) return
    const { x, y, width, height } = this.rect
    this.view.setBounds({ x, y, width: Math.max(0, width), height: Math.max(0, height) })
  }

  /** DSH stop / 退出：销毁视图保野资源；对象从实例表移除由 destroyAll 统一调用 */
  async destroy(): Promise<void> {
    const view = this.view
    this.view = null
    this.loadedUrl = null
    this.visible = false
    this.rect = null
    if (!view || this.win.isDestroyed()) return
    try {
      // 覆盖 exit 时的页（不再展示旧内容）
      view.setVisible(false)
      this.win.contentView.removeChildView(view)
      await view.webContents.close()
    } catch {
      /* 已销毁 */
    }
  }

  /** 所有实例销毁（应用退出 / DSH 停止） */
  static async destroyAll(): Promise<void> {
    const all = [...this.instances.values()]
    this.instances.clear()
    await Promise.allSettled(all.map((c) => c.destroy()))
  }
}
