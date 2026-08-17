# 多窗口方案（规划，未实施）

> 状态：已记录，待实施。当前应用为单窗口设计（全仓库仅 `electron/modules/window/index.ts` 一处 `new BrowserWindow`）。

## 进程模型

- 每个 `new BrowserWindow()` = 一个独立渲染进程
- 多窗口 = 多渲染进程，共享同一批主进程 IPC handler 与 preload 桥（模块都注册在主进程，天然多窗口可用）
- 每个窗口是独立 React 实例，各自跑一份 Zustand store（状态不共享，都经 IPC 走主进程）

## 现状的单窗口假设（需改造）

1. `electron/main/window-store.ts:20` — `sendToRenderer` 只发给 `mainWindow` → 需改成窗口集合 + 定向/广播
2. `electron/modules/window/index.ts:73` — `getWindow()` 用 `BrowserWindow.getAllWindows()[0]` 控制最小化/最大化/关闭 → 需按窗口绑定
3. `electron/main/index.ts:63-68` — `second-instance` 聚焦 `[0]` → 需聚焦最近活动窗口
4. updater / inbox 的通知事件都经 `sendToRenderer` 只达主窗口

## 改造要点

- `window-store` 从"单主窗口"改为"窗口集合"，提供 `broadcast()` / `sendToWindow(id, ...)`
- 主窗口被关闭时决定：退出应用（当前 `window-all-closed` 行为）或保留后台（需按产品语义定）
- 新窗口入口：同一渲染入口 `loadURL` 即可，路由/视图参数通过 URL query 或 IPC 传入
- `sendToRenderer` 的既有调用方逐个评估应广播还是定向