# 多窗口方案

> 状态：已实施（2026-08）。入口：顶栏模块 tab 右键 →「在新窗口打开」。
> 每个 `new BrowserWindow()` = 一个独立渲染进程，共享同一批主进程 IPC handler 与 preload 桥。

## 进程模型

- 每个 `new BrowserWindow()` = 一个独立渲染进程
- 多窗口 = 多渲染进程，共享同一批主进程 IPC handler 与 preload 桥（模块都注册在主进程，天然多窗口可用）
- 每个窗口是独立 React 实例，各自跑一份 Zustand store（状态不共享，都经 IPC 走主进程）

## 实现要点

- **窗口工厂**：`electron/modules/window/index.ts` 的 `createAppWindow(viewId?)`，dev 走 `loadURL(url + '?view=<id>')`、prod 走 `loadFile(path, { query: { view } })`；`createMainWindow()` 是无参特例并额外登记到 window-store
- **初始视图传参**：渲染层 `src/App.tsx` 从 URL query `?view=` 解析初始 `sidebarTab`，非法/被功能开关禁用的 id 由既有兜底 effect 回落到第一个可用视图
- **窗口绑定**：`window:minimize/maximizeToggle/close` 经 `BrowserWindow.fromWebContents(e.sender)` 绑定发起方窗口，各窗口标题栏按钮只控制自己
- **广播**：`window-store.sendToRenderer()` 广播全部窗口（updater/inbox/`data:changed`/`mcp:catalogChanged`）；`window:maximizedChange` 改为各窗口发自身 webContents
- **关闭语义**：仅主窗口 close→hide 托盘驻留（`getMainWindow() === win` 判断），子窗口 close 即销毁；`second-instance` 与托盘聚焦固定走 `getMainWindow()`
- **IPC**：新增 `window:openView(view)`（UI 专属通道，留在模块 `registerIpc`），preload API 为 `openViewWindow`

## 后续可选

- 子窗口记忆独立位置/尺寸
- 定向事件替代全量广播（当前调用方语义均适合广播）
