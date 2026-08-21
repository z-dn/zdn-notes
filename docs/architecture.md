# ZDNotes 整体架构

> 面向开发者的架构总览（本文件）与 agent 指令（`../AGENTS.md`）互补：
> AGENTS.md 偏「改动代码时的约束与入口」，本文件偏「系统长什么样、数据怎么流、进程怎么分工」。
> 若两者冲突，以代码为准。

---

## 1. 概览：一张图看懂

```
                    ┌──────────────────────────────────────────────────────────────┐
                    │                        ZDNotes（Electron）                    │
                    │                                                              │
  ┌─────────────┐   │   ┌──────────────────────┐        ┌───────────────────────┐  │
  │ 渲染进程      │   │   │       主进程           │        │  独立 MCP 进程（可选）    │
  │ React + Tail │   │   │   app-shell 装配       │        │  zdn-mcp（stdio/http/  │
  │ + Zustand    │   │   │   AppService 业务层    │        │  CLI）                │
  │              │   │   │   ModuleRegistry       │        │  mcp-server 单端点     │
  │  window.     │   │   │   ToolRegistry 工具表   │        │  内置工具 / 插件工具    │
  │  electronAPI │◄──┼──►│   SQL.js 权威内存库     │        │  withDb 直连库（兜底）   │
  └─────────────┘   │   │        │               │        └──────┬────────────┬────┘
                    │   └────────┼───────────────┘               │            │
                    │            │ save/load                      │ 文件锁       │ GUI 在跑时
                    │            ▼                               ▼ 协调        ▼ 整包委托
                    │   ┌──────────────────┐           ┌──────────────┐   ┌─────────────┐
                    │   │  <数据目录>/       │           │ GUI-IPC loopback│  │  loopback   │
                    │   │  zdn-notes.db     │           │ （主进程端点）   │  │  app/invoke  │
                    │   │  agent-mcp-config │◄──────────┼  127.0.0.1   │◄─┼  (插件ctx.app)│
                    │   │  agent-tools/     │           └──────────────┘   └─────────────┘
                    │   │  inbox/ ...       │
                    │   └──────────────────┘
                    └──────────────────────────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────────────────┐
  │  electron/core  平台核心（纯 TS，三进程共享）：schema / contracts / app-service │
  │                  tool-registry / module-registry / plugin-loader / feature-  │
  │                  flags                                                        │
  └────────────────────────────────────────────────────────────────────────────┘
```

**一句话**：Electron 三进程架构 —— 主进程（权威数据 + 业务层）、渲染进程（UI）、独立 MCP 进程（智能体/插件执行）。平台核心 `core/` 被三方共享，消灭「主进程一份、MCP 一份」的漂移。

---

## 2. 进程模型

```
┌──────────────────────┐     ┌─────────────────────────┐
│ 主进程（Node.js）       │     │ 渲染进程（Chromium）        │
│  ┌──────────────────┐ │     │  React 19 + Tailwind     │
│  │ app-shell 装配器   │ │     │  ┌────────────────────┐  │
│  │ 模块注册→flags→    │ │     │  │ App.tsx            │  │
│  │ AppService→IPC    │ │     │  │  collectViews()    │  │
│  │ →onStart→register │ │     │  │  侧边栏 tab / 设置   │  │
│  └─────────┬────────┘ │     │  └─────────┬──────────┘  │
│  AppService│业务层      │     │  Zustand stores        │
│  ToolRegistry│工具表    │     │  ┌──────┐ ┌─────────┐   │
│  SQL.js 权威库│(内存)   │     │  │task  │ │category │   │
│  窗口/托盘/通知/更新      │     │  └──────┘ └─────────┘   │
└────────┬──────────────┘     └──────────┬──────────────┘
         │  ipcMain.handle（自动+模块注册）    │  ipcRenderer.invoke
         │◄───────────────────────────────────►│  contextBridge 安全桥
         │
         │  startMcpIpc() → 127.0.0.1:<port> loopback（Bearer token）
         │  acquireGuiLock() → 写 .zdn-notes.lock {owner:'gui',port,token}
         ▼
┌─────────────────────────┐      （智能体拉起，可选，独立进程）
│ 独立 MCP 进程 zdn-mcp    │
│  electron/mcp/index.ts  │
│  --stdio / --http / CLI │
│  McpServer（同一份逻辑）  │
│  GUI 在跑？─是─► 整包委托 GUI loopback（GUI=唯一写者）
│        └──否──► withDb 直连文件 + 文件锁（短事务）
└─────────────────────────┘
```

| 进程 | 职责 | 关键技术 |
|------|------|----------|
| 主进程 | 窗口管理、AppService 业务层、SQL.js 权威内存库、IPC、托盘驻留、系统通知、自动更新、GUI-IPC loopback 端点 | `electron/main/index.ts` → `startAppShell()` |
| 渲染进程 | React UI，纯「读/写经 IPC」，不直接碰文件/数据库 | `src/`，`window.electronAPI` |
| 独立 MCP 进程 | 智能体接入 + 插件工具执行；GUI 在跑时委托、否则直连文件 | `electron/mcp/`，打包为 `out/mcp/index.cjs` |

**生命周期要点**

- 单实例锁：`requestSingleInstanceLock` 防止多进程写同一数据目录（`electron/main/index.ts:62`）。
- 托盘驻留：`window-all-closed` 不退出；关窗仅隐藏到托盘，后台服务（MCP/收件夹/提醒/更新）继续跑。真正退出只经托盘「退出」→ `before-quit` → `shell.shutdown()` + `closeDB()` + `releaseGuiLock()`。
- MCP/CLI 入口在单实例锁**之前**分派：`--zdn-mcp-stdio`（自举纯 Node 子进程跑 stdio server）、`--zdn-mcp-cli <cmd>`。GUI 在跑时它们委托给 GUI，不抢锁。

---

## 3. 主进程装配（app-shell 流水线）

`electron/main/app-shell.ts` 的 `startAppShell()` 是唯一的装配入口，顺序如下：

```
 startAppShell()
   │
   ├─ 1. Menu.setApplicationMenu(null)         去掉默认菜单
   ├─ 2. initDB()                               打开/创建 SQL.js 库（迁移+完整性检查）
   ├─ 3. resolveFlags(settings)                 feature-flags → 模块开关
   ├─ 4. registry.registerAll(BUILTIN_MODULES) 注册全部内置 FeatureModule
   ├─ 5. registry.collectAgentTools(flags)      收集启用模块贡献的 Agent 工具
   ├─ 6. ensureBuiltinPlugins(dataDir)          内置插件播种到 agent-tools/（幂等）
   ├─ 7. ToolRegistry 注册 = 内置工具 + loadPluginsIntoRegistry(插件)
   ├─ 8. 构建 MainModuleContext {getDB, saveAsync, send, getDataDir, toolRegistry}
   │
   ├─ 9.  AppService 统一业务层
   │      registry.registerAppServiceAll(svc, ctx, flags)  模块注册业务通道
   │      ctx.appService = svc
   │      registerAppServiceIpc(svc)              遍历通道自动生成 ipcMain.handle
   │
   ├─ 10. registry.startAll(ctx, flags)          onStart（mcp 起 loopback、inbox 起监听、
   │                                              notifications 起提醒、updater 注册事件）
   ├─ 11. registry.registerIpcAll(ctx, flags)    对话框/窗口类 IPC（UI 专属）
   │
   └─ 12. startPluginWatcher()                   监听 agent-tools/ 目录 → 热重载注册表
                                                 → mcp:catalogChanged 通知渲染层
```

**模块生命周期钩子**（`electron/core/contracts.ts` 的 `FeatureModule`）：

```
 FeatureModule {
   id / name / kind(core|optional) / defaultEnabled
   appService?(svc, ctx)      // 注册应用能力到统一业务层（第 9 步）
   onStart?(ctx)              // 后台服务启动（第 10 步）
   registerIpc?(ctx)          // UI 专属 IPC（第 11 步）
   onShutdown?(ctx)           // 退出清理
   agentTools?: AgentTool[]   // 贡献 Agent 工具
   renderer?: { view, settingsSections }  // 渲染层声明
 }
```

**模块清单**（`electron/modules/index.ts`）：`app / window / tasks / categories / settings / images / backup / data-location / inbox / toolbox / notifications / updater / mcp`，由 settings 表 `module.<id>` 开关控制（core 不可关）。

---

## 4. 统一业务层 AppService（与 UI 解耦）

**核心思想**：一个业务注册表，两个消费方 —— UI 与插件 `ctx.app` 访问的是**同一张表**、同一份内存库。

```
                     ┌──────────────────────────────┐
                     │     AppService（仅主进程）      │
                     │  channel → 纯业务函数           │
                     │  task:create → createTask()   │
                     │  task:getAll → getAllTasks()  │
                     │  category:*   settings:*      │
                     │  image:*   tool:*   db:*      │
                     │  inbox:*   app:*   mcp:*      │
                     └────────┬─────────────┬────────┘
                              │             │
             自动 ipcMain.handle│             │ 插件经 loopback 委托
              （app-shell 遍历  │             │  （app/invoke 分支）
                channels 生成） │             │
                ┌──────────────▼─────┐   ┌────▼───────────────────┐
                │ 渲染进程             │   │ 独立 MCP 进程             │
                │ window.electronAPI  │   │ 插件工具 ctx.app(ch,..)  │
                │ .taskCreate(dto)    │   │   → gui-client 转发      │
                │  （preload 通道名不变）│   │   → loopback app/invoke │
                └─────────────────────┘   └────────────────────────┘
```

**两条通道的分流规则**

| 通道类型 | 放哪 | 例子 |
|----------|------|------|
| 纯数据业务 | `appService()` 注册 | `task:*`、`category:*`、`settings:*`、`tool:*`、`http:request`、`image:saveFromData`、`db:getDataDir/setDataDir`、`inbox:getDir`、`app:*`、`mcp:getConfig/listPlugins/...` |
| 对话框/窗口类 UI 专属 | `registerIpc()` 注册 | `task:exportMarkdown`、`db:export/import`、`db:chooseDataDir`、`image:pickAndSave`、`inbox:openDir`、`window:*`、`update:*`、`mcp:installPlugin`、`mcp:downloadPluginSpec` |

> UI 专属通道不进业务层的原因：它们操作系统对话框/窗口，插件（无 GUI 交互语义）无需也不应调用。
> `AppService` 本身（`electron/core/app-service.ts`）是纯 TS、无 Electron 依赖，可单测。

---

## 5. Agent 工具与 MCP

### 5.1 统一工具注册表（ToolRegistry）

```
 ┌─────────────────────────────────────────────────────────────┐
 │                   ToolRegistry（core/tool-registry.ts）       │
 │                                                             │
 │  内置模块贡献（kind:'builtin'）         第三方插件（kind:'plugin'）│
 │  ├─ tasks/tools.ts 6 个任务工具    ├─ <dataDir>/agent-tools/   │
 │  │   task:create/read_list/        │     <id>/ztool.json +     │
 │  │   read_detail/update_status/    │     index.js（require 全权）│
 │  │   update/delete                 │                            │
 │  └─ 由 ModuleRegistry 收集         └─ 由 plugin-loader 加载      │
 │                                                             │
 │  toCatalog()   → 派生 agent-mcp-config.json 白名单（内置+插件动态合并）│
 │  buildMcpTools(cfg) → 按 enabled+permissions 过滤输出 MCP 工具列表   │
 └─────────────────────────────────────────────────────────────┘
```

- 白名单粒度 = **单个工具**。禁用的工具不进 `tools/list` → 不进模型上下文（token 精简）。
- 权限 key 由 `registry.toCatalog()` 派生，不再硬编码；内置工具与插件工具统一合并。
- 热重载：`plugin-watcher`（防抖 500ms）监听 `agent-tools/`，重建注册表 → `mcp:setRegistry` + `mcp:catalogChanged` 推给渲染层。

### 5.2 执行路径：内置工具 vs 插件工具

```
 智能体 ──MCP tools/call──► 独立 zdn-mcp 进程
                              │
        ┌─────────────────────┴─────────────────────┐
        │ kind:'builtin' 内置工具                     │ kind:'plugin' 插件工具
        │                                            │
        │  GUI 在跑？────是───► 整包委托 GUI loopback │  始终在独立进程本地执行
        │    │                 （excludePlugins:true）│  （永不进入主进程）
        │    └──否──► withDb 直连文件 + 文件锁        │
        │                                            │  ctx.app(channel,...)
        │                                            │   └─ GUI 在跑？─是─► loopback app/invoke
        │                                            │              └──否──► 抛错（回退 Node 原生）
```

**GUI-IPC 委托（zdn-mcp 侧）**：`gui-client.ts` 每请求重读 GUI 锁文件；有 `{port,token}` 端点就把 `tools/call` 整包 POST 到 `127.0.0.1:<port>/mcp`（Bearer token），由 GUI 在**自己权威内存库**上执行并落盘，然后 `data:changed` 刷新界面 —— 运行时只有 GUI 一个写者，无锁竞争、无覆盖丢失。GUI 不可达则回退文件模式。

**GUI 端点（主进程侧）**：`electron/main/mcp-ipc.ts` 的 `startMcpIpc` —— 复用同一 `McpServer`（白名单/校验/返回格式两端一致），`dbSource` 指向 `getDB()`，`afterWrite` 做 `saveAsync()` + 通知。`excludePlugins:true` 保证插件工具永不进主进程。

### 5.3 文件锁回退（GUI 不在时）

`<数据目录>/.zdn-notes.lock`，内容 `{ owner:'gui'|'mcp', pid, time, endpoint? }`。

| 场景 | 行为 |
|------|------|
| GUI 启动 | `acquireGuiLock` 写入本地 IPC endpoint，成为权威写者 |
| mcp 写、GUI 没开 | 拿锁，直接文件模式（`withDb` 短事务、写前重载磁盘最新态） |
| mcp 写、GUI 在跑 | 转发 GUI 执行，无锁等待；GUI 不可达明确报错，不覆盖 GUI |
| 崩溃残留锁 | mcp 锁按 pid 判存活自动接管；GUI 锁用哨兵 pid，不误删 |

> 为什么不用共享内存承载数据：SQL.js 是「一次性导出成文件」的内存态，两进程各持一份会互相覆盖。故采用**单一写者**：GUI 在跑 GUI 写，GUI 不在锁+短事务轮流写。

---

## 6. 插件运行时（第三方扩展）

### 6.1 信任模型

**插件 = 任意代码，与应用同权限**。无沙箱、无 require 白名单、无能力门禁（已删除 permission 体系），与 Obsidian/VS Code 插件一致。

- 依赖随插件目录分发（node_modules 打进 `.ztool`，VS Code 风格）；`ztool build` 检测无 node_modules 时自动安装生产依赖（`npm install --omit=dev`）。
- 安装警告：GUI 安装前弹「安装插件 = 运行任意代码（与应用同权限）」确认框；CLI `ztool install` 打印同样警告。
- 内置插件（`resources/agent-tools/http`）随包分发，首次启动 `seed-plugins` 复制到数据目录，`builtin:true` 不可卸载。

### 6.2 加载与执行路径

```
 <数据目录>/agent-tools/<pluginId>/
    ├─ ztool.json     清单（id/name/version/apiVersion/tools/builtin?...）
    └─ index.js       入口（CJS 或 ESM；node_modules 同目录分发）

 plugin-loader.ts  createRequire(entryPath) 直接 require（无沙箱）
   │  console.log/warn 重定向 stderr（不污染 MCP stdout）
   │  热重载按插件目录清理 require 缓存
   ▼
 插件工具 run(ctx, args)   ctx = {
                              kind:'plugin', dataDir, pluginId,
                              storage（KV，按插件 id 隔离）, log,
                              app?(channel, ...args)  // GUI-IPC 委托 AppService
                            }
```

### 6.3 ctx.app（应用业务层委托）

- 经 `gui-client.ts` 的 `buildAppBridge` 把 `app/invoke` 转发到 GUI loopback 端点（`mcp-server.ts` 的 `appService` 分支）执行。
- **仅在 GUI 运行时可用**；GUI 不在时调用抛错，插件此时只能用自己的 Node 能力 + `storage` 持久化。
- 无白名单：插件与应用同权限，`ctx.app` 不设额外门禁。

### 6.4 打包与安装 CLI（scripts/ztool.mjs）

```
 npm run ztool init     脚手架（生成 ztool.json + 入口模板）
 npm run ztool build    校验清单 → 整目录 zip 成 .ztool（含 node_modules）
 npm run ztool install  解压到 <数据目录>/agent-tools/ + 打印任意代码警告
 npm run ztool list     列出已安装插件
```

第三方可 `npx zdn-agent-tool ...` 使用（独立 npm 包 `scripts/package.json`，private 仅本地），或纯手工 zip / 目录复制。

---

## 7. 数据库层

### 7.1 单一来源与访问三路径

```
                    core/schema.ts（SCHEMA_SQL + runMigrations +
                       ensureDefaultCategory + assertIntegrity）
                                   │
        ┌──────────────────────────┼───────────────────────────────┐
        ▼                          ▼                               ▼
  主进程 database/index.ts     独立 MCP db.ts               备份/收件夹
  initDB / reloadDB           withDb(load) + task*/category*   loadValidatedDB /
  getDB() 权威内存库          CRUD 函数（缓存+写前重载）        import-merge.ts
  save()  tmp+rename 原子写    （GUI 在跑时整包委托，不走这里）
  saveAsync() 防抖落盘
```

- **Schema 单一来源**：主进程 `main/database/index.ts` 与独立 MCP `mcp/db.ts` 共用 `core/schema.ts`，消除双份漂移。
- **DAO 文件**：`main/database/` 下 `task-dao.ts` / `category-dao.ts` / `settings-dao.ts`。
- **持久化**：`app.getPath('userData')/zdn-notes.db`（可用 `db:setDataDir` 迁移自定义目录；迁移 = 复制→重载→写配置→清理旧位置）。目录不可用回退默认并告知渲染层。
- **原子写**：`save()` 先写 `.tmp` 再 `renameSync`；`saveAsync()` 防抖（500ms 空闲 / 2s 上限）批量落盘。
- **迁移**：`runMigrations()` 内 try-catch 增量执行 ALTER TABLE，无正式迁移工具。

### 7.2 收件夹增量导入

```
 <数据目录>/inbox/ 放入 zdn-notes.db 或备份 zip
   → 按 updated_at 取新、只增不删
   → settings 缺 key 才加、图片按文件名去重
   → 成功移入 _imported/，失败移入 _rejected/
   → inbox:processed 事件通知渲染层 toast 统计
```

### 7.3 表结构（SQL 单一来源，见 `core/schema.ts`）

| 表 | 关键字段 |
|----|---------|
| `tasks` | id(PK), title, description, status(todo/done), priority(P0-P3), due_date, start_date, reminder_time, parent_id, order_index(Lexorank), tags(JSON), owner, category_id(FK), meta(JSON) |
| `categories` | id(PK), name, color, sort_order, created_at, updated_at |
| `settings` | key(PK), value |

---

## 8. 渲染层

```
 src/main.tsx → App.tsx
   │
   ├─ useTheme()                      主题（window.setThemeSource）
   ├─ collectViews()（src/modules/）   侧边栏 tab：tasks/toolbox/agent
   │    + useFeature('mcp'|'toolbox'|'tasks') 按功能开关过滤 tab
   ├─ Zustand stores（task/category/settings/tool）
   │    全部经 window.electronAPI（preload contextBridge）→ IPC → AppService
   ├─ 事件订阅：data:changed / inbox:processed / reminder:open /
   │    window:maximizedChange / update:* / mcp:callLogged / mcp:catalogChanged
   ├─ 三大区：侧边栏(CategorySidebar/ToolboxSidebar/AgentSidebar)
   │          中部(FadeSwitch: TaskList/ToolboxWorkspace/AgentToolsPage)
   │          详情面板(DetailPanel, w-80)
   └─ 设置弹窗 SettingsDialog（小节来自模块声明）
```

**样式与动画统一（强制约定）**

- 动画 token 集中于 `src/styles/globals.css` 的 `@theme`：时长 `--duration-fast/base/medium`、缓动 `--ease-*`、`--animate-fade-slide-up` / `--animate-fade-out`。调整动画节奏只改 `@theme`，不碰组件类名。
- 动画原语 `src/components/fade.tsx`：`FadeBlock`（条件块进出场）、`FadeSwitch`（容器切换）、`Collapse`（高度折叠）；全部 200ms 统一缓动，reduced-motion 兜底。
- 面板分隔 token：`--color-panel*`（内容/顶栏/侧栏/详情）、`--color-divider`（布局分隔线专用，控件边框仍用 `border-input`）；分隔样式经 `<html data-panel-style="divider|tint">` 切换，模式值集中定义，组件不写死判断。
- 单一所有权 + 抑制模型：每个过渡只有顶层容器播动画；`MotionContext` / `useMotionSuppress()` 在容器过渡期间向内层传播抑制信号。

---

## 9. IPC 通道总表

### 9.1 AppService 通道（app-shell 自动生成 ipcMain.handle，UI 与插件 ctx.app 共用）

| 通道 | 功能 | 模块 |
|------|------|------|
| `task:create/update/delete/getAll/getById/updateStatus` | 任务 CRUD | tasks |
| `category:create/update/delete/getAll/getTaskCounts` | 分类 CRUD/计数 | categories |
| `settings:getAll/set` | 设置读写 | settings |
| `image:saveFromData/delete` | 图片保存/删除 | images |
| `db:getDataDir/getDataDirFallback/setDataDir` | 数据目录 | data-location |
| `inbox:getDir` | 收件夹路径 | inbox |
| `tool:getAll/set`、`http:request` | 工具箱/HTTP 请求 | toolbox |
| `app:getVersion/getFeatures` | 版本/功能开关 | app |
| `mcp:getConfig/setConfig/getCatalog/listPlugins/uninstallPlugin/getPluginsDir/getCallLogs/clearCallLogs/getPluginSpec` | MCP 配置/插件/调用日志 | mcp |

### 9.2 UI 专属 IPC（模块 registerIpc，对话框/窗口类）

| 通道 | 功能 | 模块 |
|------|------|------|
| `task:exportMarkdown` | 导出 Markdown（保存对话框） | tasks |
| `db:export/import` | 备份/恢复（对话框） | backup |
| `db:chooseDataDir` | 选择数据目录（对话框） | data-location |
| `image:pickAndSave` | 选择并保存图片（对话框） | images |
| `inbox:openDir` | 打开收件夹 | inbox |
| `window:minimize/maximizeToggle/close/setThemeSource` | 窗口控制 | window |
| `update:check/download/install` | 自动更新 | updater |
| `mcp:installPlugin/downloadPluginSpec` | 安装插件（文件框+警告）/下载规范 | mcp |

### 9.3 事件推送（主进程 → 渲染层，`ctx.send`）

`data:changed`（MCP 委托写入后刷新）、`inbox:processed`、`reminder:open`、`window:maximizedChange`、`update:checking/available/not-available/error/progress/downloaded`、`mcp:callLogged`、`mcp:catalogChanged`。

---

## 10. 目录结构

```
electron/
  main/                 主进程
    index.ts            入口（单实例/MCP CLI 分派/生命周期）
    app-shell.ts        装配器（startAppShell）
    database/           SQL.js DAO（task/category/settings-dao）+ saveAsync
    data-location.ts    数据目录解析/迁移
    seed-plugins.ts     内置插件播种
    plugin-watcher.ts   插件热重载
    import-inbox.ts     收件夹增量导入
    mcp-ipc.ts          GUI-IPC loopback 端点（服务 tools/call + app/invoke）
    window-store.ts     主窗口句柄 + sendToRenderer
    reminder-service.ts 任务提醒调度
    http-client.ts      工具箱 http:request 执行器
  core/                 平台核心（纯 TS，三进程共享）
    schema.ts           SQL 单一来源 + runMigrations
    contracts.ts        平台契约（FeatureModule/AgentTool/PluginManifest/ctx）
    app-service.ts      统一业务层
    tool-registry.ts    统一工具注册表
    module-registry.ts  模块装配器
    feature-flags.ts    功能开关
    plugin-loader.ts    插件加载（createRequire 全权）
  modules/              内置 FeatureModule（每域一目录）
    app/ window/ tasks/ categories/ settings/ images/ backup/
    data-location/ inbox/ toolbox/ notifications/ updater/ mcp/
  mcp/                  独立 MCP 进程（主进程外复用）
    index.ts            入口分派（--stdio/--http/CLI）
    mcp-server.ts       MCP 消息处理（传输中立，delegate/dbSource/appService）
    gui-client.ts       GUI-IPC 委托客户端 + buildAppBridge
    http-server.ts      Streamable HTTP 服务
    db.ts               独立 SQL.js 封装 + CRUD + withDb
    lock.ts             GUI 优先文件锁
    config.ts           agent-mcp-config.json 白名单
    call-log.ts         调用日志（JSONL）
    data-location.ts    独立数据目录定位（不依赖 Electron）
    cli.ts              CLI 兜底命令
  preload/index.ts      contextBridge 安全桥（window.electronAPI）

src/
  App.tsx / main.tsx        渲染入口与三区布局
  components/               业务组件（task/agent/toolbox/settings/...）
  components/ui/            shadcn/ui 原始组件（勿改）
  stores/                   Zustand（task/category/settings/tool）
  hooks/                    use-feature / use-theme / ...
  lib/                      工具函数（lexorank/markdown/utils/...）
  modules/                  渲染层模块声明（views）
  types/                    task.ts / electron.d.ts

scripts/ztool.mjs           插件打包/安装 CLI
scripts/build-mcp.mjs       打包纯 Node MCP 入口 → out/mcp/index.cjs
resources/agent-tools/http  内置 HTTP 插件（随包分发）
examples/agent-tools/http   插件开发示例
docs/                       本文件 + plugin-spec.md + agent-mcp.md + 规划稿
```

---

## 11. 关键决策与约束

1. **单一写者一致性**：SQL.js 内存态无法多进程共享 → GUI 运行时 GUI 是唯一写者（mcp 整包委托），GUI 不在时文件锁 + 短事务。
2. **GUI 优先**：GUI 启动即拿 GUI 锁并暴露 loopback 端点；mcp/CLI 尊重锁，GUI 在跑一律委托，绝不直接写文件。
3. **`ctx.app` 依赖 GUI 主进程**：仅 GUI 运行时可用；但**内置任务工具不受影响**（走 `ctx.db` 直连/委托，全模式可用）。
4. **无沙箱信任模型**：插件 = 任意代码、与应用同权限；安全靠来源信任 + 安装警告。无权限/能力白名单。
5. **统一业务层（AppService）**：UI 与插件共用一张业务表，对话框/窗口类通道留在模块 IPC，避免插件误触 UI 语义。
6. **插件工具永不进主进程**：GUI 端点 `excludePlugins:true`，插件始终在独立 MCP 进程本地执行。
7. **Schema/契约单一来源**：`core/schema.ts`、`core/contracts.ts` 被主进程、MCP、渲染层共享，禁止复制漂移。
8. **传输层与数据层解耦**：`mcp-server.ts` 对传输载体中立，stdio/HTTP/CLI 复用同一 `handleMessage` 与数据层。
