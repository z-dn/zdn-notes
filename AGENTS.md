# ZDNotes — Agent 指南

> 面向开发者的整体架构（含 ASCII 字符图）见 [docs/architecture.md](docs/architecture.md)。

## 项目简介

ZDNotes 是一款基于 Electron 的本地笔记与任务管理桌面应用，支持快速输入创建任务。仅支持 Windows 平台（NSIS 安装包）。

---

## 架构

### 三进程架构

```
electron/main/          → 主进程 (Node.js) + app-shell 装配器
electron/preload/       → 预加载脚本 (contextBridge)
src/                    → 渲染进程 (React)
electron/core/          → 平台核心（schema/注册表/插件运行时，主进程与独立 MCP 共享）
electron/modules/       → 内置平台模块（FeatureModule，按域拆分 IPC/Agent 工具/渲染层声明）
electron/mcp/           → 独立 MCP 进程（stdio/http/CLI）+ 文件锁 + GUI-IPC 委托客户端
```

- **主进程**：窗口管理、`app-shell.ts` 装配（模块注册 → feature-flags → AppService 业务层 → 工具注册表 → onStart → registerIpc）、SQLite 数据库（SQL.js）、自动更新
- **预加载**：通过 `contextBridge.exposeInMainWorld('electronAPI', ...)` 暴露安全 API
- **渲染进程**：React + Tailwind CSS + Zustand
- **平台核心（core/）**：`schema.ts`（SQL 单一来源）、`app-service.ts`（统一业务层，UI 与插件共用）、`tool-registry.ts`（统一 MCP 工具注册表）、`module-registry.ts`（模块装配器）、`feature-flags.ts`、`plugin-loader.ts`（第三方插件运行时，全权 Node 加载）
- **内置模块（modules/）**：每域一个 `FeatureModule`（app/window/tasks/categories/settings/images/backup/data-location/inbox/toolbox/updater/mcp），声明 `appService`/`registerIpc`/`onStart`/`agentTools`/`renderer.view`
- **统一业务层（AppService）**：各模块把纯业务通道注册进 `AppService`（`electron/core/app-service.ts`），app-shell 自动为每个通道生成 `ipcMain.handle`；UI 经 IPC 与插件 `ctx.app`（经 GUI-IPC 委托）访问同一张表。对话框/窗口类 UI 专属通道留在模块 `registerIpc`

### 平台模块与功能开关

- 所有内置功能以 `FeatureModule` 形式注册（`electron/core/contracts.ts`），主进程 `app-shell` 统一装配
- 功能开关存于 settings 表（key `module.<id>`），core 模块不可关闭；`useFeature(id)`（`src/hooks/use-feature.ts`）供渲染层查询
- 渲染层视图（侧边栏 tab：待办项/工具箱/AGENT 工具）与设置小节来自 `src/modules/` 声明（`collectViews()`），App.tsx 不再硬编码
- 「AGENT 工具」tab（`src/components/agent/agent-tools-page.tsx`）= 插件卡片总览 + MCP 配置入口：每个插件一张卡片网格排列（内置插件区 / 第三方插件区），卡片内列出该插件的全部工具与授权开关（写 agent-mcp-config.json）；页头有「启用 MCP」总开关；「待办任务」把 6 个任务方法聚合为一张内置插件卡；内置插件不可卸载，第三方插件卡带卸载入口；IPC 见 `electron/modules/mcp/plugins.ts`

### Agent 工具与第三方插件（agent-tools/）

- **统一工具注册表** `ToolRegistry`（`electron/core/tool-registry.ts`）：内置模块贡献的工具（如 `modules/tasks/tools.ts` 的 6 个任务工具）+ 第三方插件工具，一并进入 MCP
- **白名单派生**：`agent-mcp-config.json` 的权限 key 由 `registry.toCatalog()` 派生（内置+插件动态合并，不再硬编码）；`loadConfig`/`writeConfig` 接受 `catalog` 参数，插件 key 不再被过滤
- **插件运行时**：`<数据目录>/agent-tools/<pluginId>/`（`ztool.json` 清单 + 入口 JS），由 `plugin-loader.ts` 以完整 Node 模块直接 `require` 加载（**无沙箱、无依赖限制**）；依赖随插件目录分发（node_modules 打进 .ztool，VS Code 风格）；加载期 console 重定向 stderr
- **内置插件 seed**：`resources/agent-tools/http/` 随包分发（extraResources → `process.resourcesPath/agent-tools`），首次启动由 `electron/main/seed-plugins.ts` 复制到数据目录并写 settings 标记（幂等）；ztool.json 标 `builtin:true` 的插件不可卸载
- **内置工具聚合**：`mcp:listPlugins` 把 registry 中 `kind:'builtin'` 的工具聚合为一条「待办任务」内置插件（不可卸载）展示在管理页
- **插件 ctx**：插件工具的 `run(ctx, args)` 拿到 `{ storage, log, pluginId, dataDir }` 便利设施 + `ctx.app(channel, ...args)`（经 GUI-IPC 委托调 AppService，GUI 不在时抛错）；无权限模型——插件与应用同权限，`ctx.app` 不设白名单
- **热重载**：`electron/main/plugin-watcher.ts` 监听 agent-tools 目录变化，重建注册表并推给 GUI MCP 端点（`mcp:catalogChanged` 通知渲染层）；`require` 缓存按插件目录清理
- **打包 CLI**：`scripts/ztool.mjs`（`npm run ztool`；同时也是独立 npm 包 `zdn-agent-tool`，见 `scripts/package.json`，`private:true` 仅本地）— `init`/`build`/`install`/`list`；第三方可 `npx zdn-agent-tool ...`（无需 clone 仓库），也可纯手工 zip / 目录复制
- **第三方开发规范**：见 `docs/plugin-spec.md`（ztool.json 清单/入口 JS 契约/信任模型与安全/依赖分发/ctx.app/三种开发路径/常见排查/完整示例）
- **安装警告**：GUI 安装插件前弹「安装插件 = 运行任意代码（与应用同权限）」确认框；CLI `ztool install` 打印同样警告
- 设置页「AI 智能体」小节动态渲染内置+插件工具开关，按工具勾选授权（写 agent-mcp-config.json）

### IPC 通信

所有数据操作通过 `ipcMain.handle` / `ipcRenderer.invoke` 完成。API 通道及对应功能（handler 在对应模块文件）：

| 通道 | 功能 | 所属模块 |
|------|------|---------|
| `task:create/update/delete/getAll/getById/updateStatus/exportMarkdown` | 任务 CRUD/导出 | `modules/tasks` |
| `category:create/update/delete/getAll/getTaskCounts` | 分类 CRUD/计数 | `modules/categories` |
| `settings:getAll/set` | 读取/写入设置 | `modules/settings` |
| `image:saveFromData/pickAndSave/delete` | 图片管理 | `modules/images` |
| `db:export/import` | 备份/恢复 | `modules/backup` |
| `db:getDataDir/chooseDataDir/setDataDir/getDataDirFallback` | 自定义数据存储位置 | `modules/data-location` |
| `inbox:getDir/openDir` | 收件夹路径/打开 | `modules/inbox` |
| `tool:getAll/set`、`http:request` | 工具箱状态/HTTP 请求 | `modules/toolbox` |
| `window:minimize/maximizeToggle/close/setThemeSource/openView` | 窗口控制/模块 tab 新窗口打开（`?view=` 传初始视图） | `modules/window` |
| `update:check/download/install` | 自动更新 | `modules/updater` |
| `mcp:getConfig/setConfig/getCatalog` | MCP 配置/目录 | `modules/mcp` |
| `mcp:listPlugins/installPlugin/uninstallPlugin/getPluginsDir` | 插件管理 | `modules/mcp` |
| `app:getVersion/getFeatures` | 版本/功能开关 | `modules/app` |
| `data:changed`（事件） | 数据被外部写者（MCP 智能体经 GUI-IPC 委托）修改，主进程通知渲染层刷新 | — |

> 渲染进程通过 `window.electronAPI` 调用，类型定义在 `src/types/electron.d.ts`。
>
> **统一业务层（AppService）**：数据通道由各模块注册进 `electron/core/app-service.ts`，app-shell 自动为每个通道生成 `ipcMain.handle`；渲染层 IPC 与插件 `ctx.app(channel, ...args)` 访问同一张表。对话框/窗口控制等 UI 专属通道仍留在模块 `registerIpc`（如 `task:exportMarkdown`、`db:export/import`、`image:pickAndSave`、`window:*`、`update:*`）。
>
> **GUI-IPC 委托（MCP）**：主进程 `startMcpIpc()`（`electron/main/mcp-ipc.ts`）启动 loopback 端点，把 port/token 写进 GUI 锁文件（`electron/mcp/lock.ts` 的 `acquireGuiLock`）；`zdn-mcp`（`electron/mcp/`）检测到 GUI 在跑时把 `tools/call` 整包转发给 GUI 执行（GUI 为权威单写者），GUI 不在时回退直接文件模式。插件工具始终在独立 MCP 进程本地执行；其 `ctx.app` 经 `buildAppBridge`（`electron/mcp/gui-client.ts`）把 `app/invoke` 转发到 GUI 端点（`mcp-server.ts` 的 `appService` 分支）执行。

### 数据库层

- **ORM**：无，直接使用 SQL.js（SQLite WASM）
- **Schema 单一来源**：`electron/core/schema.ts`（`SCHEMA_SQL` + `runMigrations` + `ensureDefaultCategory` + `assertIntegrity`），主进程 `main/database/index.ts` 与独立 MCP `mcp/db.ts` 共用，消除双份漂移
- **DAO 文件**：`electron/main/database/` 下按实体拆分（`task-dao.ts`, `category-dao.ts`, `settings-dao.ts`）
- **持久化**：默认通过 `app.getPath('userData')/zdn-notes.db` 存储，可用 `db:setDataDir` 迁移到自定义目录（见 `electron/main/data-location.ts`，位置配置存于 `userData/data-location.json`，迁移为"复制到新位置→重载→写配置→清理旧位置"）
- **启动容错**：自定义目录不可用时 `initDB()` 回退默认目录并通过 `db:getDataDirFallback` 告知渲染层；应用启用单实例锁（`requestSingleInstanceLock`）防止多进程写同一数据目录
- **增量导入**：`<数据目录>/inbox` 收件夹，放入 `zdn-notes.db` 或备份 zip 后自动增量合入（见 `electron/main/import-inbox.ts` + `database/import-merge.ts`；按 `updated_at` 取新、只增不删、settings 缺 key 才加、图片按文件名去重；成功移入 `_imported/`，失败移入 `_rejected/`，结果经 `inbox:processed` 事件通知渲染层）
- **迁移**：在 `core/schema.ts` 的 `runMigrations()` 中用 try-catch 增量执行 ALTER TABLE（无正式迁移工具）

---

## 技术栈

| 层 | 技术 |
|----|------|
| 桌面框架 | Electron 42 |
| 构建工具 | electron-vite 5, Vite 7 |
| UI | React 19, Tailwind CSS 4, shadcn/ui (Radix) |
| 状态管理 | Zustand 5 |
| 富文本编辑器 | Milkdown 7 (preset-commonmark + React + Nord theme) |
| 数据库 | SQL.js (SQLite WASM) |
| 日期工具 | date-fns 3 |
| 自动更新 | electron-updater 6 |
| 测试 | Vitest 4 + jsdom + @testing-library/react |
| 代码检查 | ESLint 10 + Prettier 3 |
| 类型检查 | TypeScript 6 (tsconfig.node.json + tsconfig.web.json) |

---

## 常用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发模式（hot reload） |
| `npm run build` | 构建生产版本 |
| `npm run test` | 运行所有测试（vitest） |
| `npm run lint` | ESLint 检查 |
| `npm run format` | Prettier 格式化 |
| `npm run typecheck` | 类型检查（node + web） |
| `npm run dist` | 打包 Windows 安装包 |
| `npm run dist:ci` | CI 打包（`--publish=never`） |
| `npm run pack` | 打包为 unpacked 目录 |
| `npm run ztool` | 插件打包/安装 CLI（`init`/`build`/`install`/`list`） |

---

## 代码约定

### 格式规范（.prettierrc）
- 无分号、单引号、trailing comma
- printWidth: 100, tabWidth: 2

### 目录约定
- `src/components/ui/` — shadcn/ui 原始组件（不要直接修改）
- `src/components/` — 业务组件
- `src/stores/` — Zustand store（task-store, category-store, settings-store）
- `src/lib/` — 工具函数（lexorank.ts, utils.ts, markdown.ts）
- `src/types/` — TypeScript 类型定义（task.ts, electron.d.ts）
- `tests/` — 测试文件
- `electron/core/` — 平台核心（纯 TS，主进程/MCP/渲染层共享）
- `electron/modules/` — 内置 FeatureModule（每域一目录，含 index.ts / ipc / tools）
- `electron/main/database/` — DAO 层

### 命名约定
- 文件/目录：kebab-case（`task-store.ts`, `detail-panel.tsx`）
- 组件：PascalCase（`TaskItem`, `CategorySidebar`）
- 函数/变量：camelCase
- IPC 通道：`domain:action` 格式（`task:create`, `category:getAll`）

### 状态管理
- 使用 Zustand（不涉及 Provider 包裹）
- Store 调用 `window.electronAPI` 通过 IPC 操作数据
- 数据变更后自动刷新关联数据（如任务创建后重新加载分类计数）

### 样式与动画统一（强制）

所有样式与动画**必须**通过集中配置和统一原语实现，禁止各组件自行写死时长、缓动或色值。

**动画 token（`src/styles/globals.css` `@theme`）**
- 时长：`--duration-fast`(150ms) / `--duration-base`(200ms) / `--duration-medium`(300ms)
- 缓动：`--ease-in` / `--ease-out` / `--ease-in-out` / `--ease-spring`
- 进场/退场：`--animate-fade-slide-up` / `--animate-fade-out`
- Tailwind 的 `duration-150/200/300`、`ease-*`、`transition-*` 默认时长均已覆盖到上述 token。**调整动画节奏只改 `@theme`，不要改组件里的类名**

**动画原语（`src/components/fade.tsx`）**
- `FadeBlock`：条件块进出场（`show` 切换）
- `FadeSwitch`：容器切换进出场（`current`/`render`）
- `Collapse`：高度折叠收缩（`open`/`openClass`）
- 全部 200ms、统一缓动、受 reduced-motion 兜底

**面板分隔 token（`src/styles/globals.css`）**
- 区块底色：`--color-panel`（内容）/ `--color-panel-header`（顶栏）/ `--color-panel-sidebar`（侧栏）/ `--color-panel-detail`（详情面板）
- 分隔线：`--color-divider`（布局/小节分隔线专用，控件边框仍用 `border-input`）
- 组件统一用 `bg-panel-sidebar`、`border-divider` 等语义工具类，不写死 `bg-muted/20`、裸 `border-r`
- 分隔样式可通过 `<html data-panel-style="divider|tint">` 切换（`divider`=细线+轻底色，`tint`=无分隔线+强底色分层）；模式值集中定义在 globals.css，**组件不要写死模式判断**；设置项 `panelStyle` 持久化于 settings 表

**单一所有权 + 抑制模型**
- 每个过渡只有"拥有者"（顶层容器）播动画，内层元素不重复播
- `MotionContext` / `useMotionSuppress()`：容器过渡期间向内层传播抑制信号；内层元素挂载时若被抑制则不播进场动画

**样式约定**
- 颜色只用语义 token（`bg-accent`、`border-input`、`text-muted-foreground` 等），不写死色值
- hover 反馈统一 `hover:bg-accent`（删除类 `hover:text-destructive`）
- 焦点态统一 `focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring`
- 阴影两级：控件 `shadow-sm`、浮层 `shadow-lg`
- 小字号统一 `text-[11px]`，正文 `text-sm`
- 新增交互/区块时：进场用 `animate-fade-slide-up` 或 `FadeBlock`/`FadeSwitch`，退场用 `animate-fade-out`，折叠用 `Collapse`

---

## 数据库 Schema

### tasks 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| title | TEXT | 任务标题 |
| description | TEXT | Markdown 描述 |
| status | TEXT | 'todo' / 'done' |
| priority | TEXT | 'P0' / 'P1' / 'P2' / 'P3' |
| due_date | INTEGER | 截止时间戳 |
| start_date | INTEGER | 开始时间戳 |
| reminder_time | INTEGER | 提醒时间戳 |
| parent_id | TEXT | 父任务（自引用 FK） |
| order_index | REAL | Lexorank 排序值 |
| tags | TEXT | JSON 数组 |
| owner | TEXT | 负责人 |
| category_id | TEXT | 分类 FK |
| meta | TEXT | JSON 对象 |

### categories 表
| 字段 | 类型 | 说明 |
|------|------|------|
| id | TEXT PK | UUID |
| name | TEXT | 分类名称 |
| color | TEXT | 颜色 HEX |
| sort_order | REAL | 排序值 |
| created_at | INTEGER | 创建时间戳 |
| updated_at | INTEGER | 更新时间戳 |

### settings 表
| 字段 | 类型 | 说明 |
|------|------|------|
| key | TEXT PK | 设置键 |
| value | TEXT | 设置值 |

---

## 测试

- **框架**：Vitest 4（`vitest.config.ts`）
- **环境**：jsdom（DOM 模拟）
- **设置文件**：`tests/setup.ts`（@testing-library/jest-dom matchers）
- **运行**：`npm run test`
- **目录**：`tests/`，文件命名 `*.test.ts`

当前包含测试：`lexorank.test.ts`, `task-dao.test.ts`, `mcp-db.test.ts`, `mcp-tools.test.ts`, `mcp-config.test.ts`, `tool-registry.test.ts`, `plugin-loader.test.ts`, `example.test.ts` 等

---

## Release CI Pitfalls

### 1. `--win.sign=false` 在 CI 中不可用
- `electron-builder --win --win.sign=false` 会导致参数解析失败，因为点号格式不被 CLI 支持
- 根本原因：没有代码签名证书时，electron-builder 会自动跳过签名，不需要显式参数
- **做法**：让 CI 自动处理，不要加 `--win.sign=false`

### 2. Git tag 触发 implicit publishing
- 当存在 git tag 时，electron-builder 会自动尝试发布到 GitHub Releases
- 这需要 `GH_TOKEN` 环境变量，而 CI 中没有
- **做法**：使用 `--publish=never` 禁用自动发布，用 `softprops/action-gh-release` 手动上传

### 3. Tag 更新流程
- 每次修复后：`git push main` → `git tag -d v1.1.1` → `git push origin --delete v1.1.1` → `git tag v1.1.1` → `git push origin v1.1.1`
- 新的 tag 必须指向包含修复的 commit

### 检查清单
- [ ] `dist:ci` script 包含 `--publish=never`
- [ ] 不要加 `--win.sign=false`
- [ ] tag 重新推送后等待 Actions 完成
- [ ] Actions 完成后检查 Release 页面是否有 artifact
