import type { BrowserWindow } from 'electron'

// ===================================================================
// 主窗口共享句柄。
// 原先 mainWindow 是 main/index.ts 的模块级变量，各模块/服务靠闭包取用；
// 模块化后由 window-store 统一持有，模块通过 sendToRenderer 通知渲染层。
// ===================================================================

let mainWindow: BrowserWindow | null = null

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow
}

/** 向渲染层主窗口发送事件；无窗口时静默忽略 */
export function sendToRenderer(channel: string, ...args: unknown[]): void {
  mainWindow?.webContents.send(channel, ...args)
}