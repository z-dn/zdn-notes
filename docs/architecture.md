# ZDNotes 整体架构

> 面向开发者的架构总览（本文件）与 agent 指令（`../AGENTS.md`）互补：
> AGENTS.md 偏「改动代码时的约束与入口」，本文件偏「系统长什么样、数据怎么流、进程怎么分工」。
> 若两者冲突，以代码为准。

---

## 1. 概览：一张图看懂

```
                    ┌──────────────────────────────────────────┐
                    │            ZDNotes（Electron）            │
                    │                                          │
  ┌─────────────┐   │   ┌──────────────────────┐               │
  │ 渲染进程      │   │   │       主进程           │               │
  │ React + Tail │   │   │   app-shell 装配       │               │
  │ + Zustand    │   │   │   AppService 业务层    │               │
  │              │   │   │   ModuleRegistry       │               │
  │  window.     │   │   │   SQL.js 权威内存库     │               │
  │  electronAPI │◄──┼──►│        │               │               │
  └─────────────┘   │   └────────┼───────────────┘               │
                    │            │ save/load                      │
                    │            ▼                                │
                    │   ┌──────────────────┐                      │
                    │   │  <数据目录>/       │                      │
                    │   │  zdn-notes.db     │                      │
                    │   │  inbox/ ...       │                      │
                    │   └──────────────────┘                      │
                    └──────────────────────────────────────────┘

  ┌────────────────────────────────────────────────────────────────┐
  │  electron/core  平台核心（纯 TS，主进程与渲染层共享）：             │
  │                  schema / contracts / app-service /             │
  │                  module-registry / feature-flags                │
  └────────────────────────────────────────────────────────────────┘
```

**一句话**：Electron 双进程架构 —— 主进程（权威数据 + 业务层）、渲染进程（UI）。平台核心 `core/` 被两方共享，消灭「主进程一份、渲染层一份」的漂移。

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
│  SQL.js 权威库│(内存)   │     │  ┌──────┐ ┌─────────┐   │
│  窗口/托盘/通知/更新      │     │  │task  │ │category │   │
└────────┬──────────────┘     └──────────┬──────────────┘
         │  ipcMain.handle（自动+模块注册）    │  ipcRenderer.invoke
         │◄───────────────────────────────────►│  contextBridge 安全桥
```

| 进程 | 职责 | 关键技术 |
|------|------|----------|
| 主进程 | 窗口管理、AppService 业务层、SQL.js 权威内存库、IPC、托盘驻留、系统通知、自动更新 | `electron/main/index.ts` → `startAppShell()` |
| 渲染进程 | React UI，纯「读/写经 IPC」，不直接碰文件/数据库 | `src/`，`window.electronAPI` |

**生命周期要点**

- 单实例锁：`requestSingleInstanceLock` 防止多进程写同一数据目录（`electron/main/index.ts`）。
- 托盘驻留：`window-all-closed` 不退出；关窗仅隐藏到托盘，后台服务（收件夹/提醒/更新）继续跑。真正退出只经托盘「退出」→ `before-quit` → `shell.shutdown()` + `closeDB()`。

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
   ├─ 5. 构建 MainModuleContext {getDB, saveAsync, send, getDataDir}
   │
   ├─ 6.  AppService 统一业务层
   │      registry.registerAppServiceAll(svc, ctx, flags)  模块注册业务通道
   │      ctx.appService = svc
   │      registerAppServiceIpc(svc)              遍历通道自动生成 ipcMain.handle
   │
   ├─ 7. registry.startAll(ctx, flags)          onStart（inbox 起监听、
   │                                              notifications 起提醒、updater 注册事件）
   └─ 8. registry.registerIpcAll(ctx, flags)    对话框/窗口类 IPC（UI 专属）
```

**模块生命周期钩子**（`electron/core/contracts.ts` 的 `FeatureModule`）：

```
 FeatureModule {
   id / name / kind(core|optional) / defaultEnabled
   appService?(svc, ctx)      // 注册应用能力到统一业务层（第 6 步）
   onStart?(ctx)              // 后台服务启动（第 7 步）
   registerIpc?(ctx)          // UI 专属 IPC（第 8 步）
   onShutdown?(ctx)           // 退出清理
   renderer?: { view, settingsSections }  // 渲染层声明
 }
```

**模块清单**（`electron/modules/index.ts`）：`app / window / tasks / categories / settings / images / backup / data-location / inbox / toolbox / updater / notifications / dsh / logs`，由 settings 表 `module.<id>` 开关控制（core 不可关）。

---

## 4. 统一业务层 AppService（与 UI 解耦）

**核心思想**：一个业务注册表，UI 消费 —— 所有数据通道收敛到同一张表、同一份内存库。

```
                     ┌──────────────────────────────┐
                     │     AppService（仅主进程）      │
                     │  channel → 纯业务函数           │
                     │  task:create → createTask()   │
                     │  task:getAll → getAllTasks()  │
                     │  category:*   settings:*      │
                     │  image:*   tool:*   db:*      │
                     │  inbox:*   app:*              │
                     └────────┬─────────────────────┘
                              │ 自动 ipcMain.handle
                              │ （app-shell 遍历 channels 生成）
                              ▼
                ┌─────────────────────────────┐
                │ 渲染进程                      │
                │ window.electronAPI          │
                │ .taskCreate(dto)            │
                │  （preload 通道名不变）         │
                └─────────────────────────────┘
```

**两条通道的分流规则**

| 通道类型 | 放哪 | 例子 |
|----------|------|------|
| 纯数据业务 | `appService()` 注册 | `task:*`、`category:*`、`settings:*`、`tool:*`、`http:request`、`image:saveFromData`、`db:getDataDir/setDataDir`、`inbox:getDir`、`app:*` |
| 对话框/窗口类 UI 专属 | `registerIpc()` 注册 | `task:exportMarkdown`、`db:export/import`、`db:chooseDataDir`、`image:pickAndSave`、`inbox:openDir`、`window:*`、`update:*` |

> UI 专属通道不进业务层的原因：它们操作系统对话框/窗口。
> `AppService` 本身（`electron/core/app-service.ts`）是纯 TS、无 Electron 依赖，可单测。

---

## 5. 数据库层

### 5.1 单一来源与访问路径

```
                     core/schema.ts（SCHEMA_SQL + runMigrations +
                        ensureDefaultCategory + assertIntegrity）
                                   │
         ┌─────────────────────────┴────────────────────────────┐
         ▼                                                      ▼
   主进程 database/index.ts                               备份/收件夹
   initDB / reloadDB                                   loadValidatedDB /
   getDB() 权威内存库                                  import-merge.ts
   save()  tmp+rename 原子写
   saveAsync() 防抖落盘
```

- **Schema 单一来源**：`core/schema.ts`，主进程 `main/database/index.ts` 使用。
- **DAO 文件**：`main/database/` 下 `task-dao.ts` / `category-dao.ts` / `settings-dao.ts`。
- **持久化**：`app.getPath('userData')/zdn-notes.db`（可用 `db:setDataDir` 迁移自定义目录；迁移 = 复制→重载→写配置→清理旧位置）。目录不可用回退默认并告知渲染层。
- **原子写**：`save()` 先写 `.tmp` 再 `renameSync`；`saveAsync()` 防抖（500ms 空闲 / 2s 上限）批量落盘。
- **迁移**：`runMigrations()` 内 try-catch 增量执行 ALTER TABLE，无正式迁移工具。

### 5.2 收件夹增量导入

```
 <数据目录>/inbox/ 放入 zdn-notes.db 或备份 zip
   → 按 updated_at 取新、只增不删
   → settings 缺 key 才加、图片按文件名去重
   → 成功移入 _imported/，失败移入 _rejected/
   → inbox:processed 事件通知渲染层 toast 统计
```

### 5.3 表结构（SQL 单一来源，见 `core/schema.ts`）

| 表 | 关键字段 |
|----|---------|
| `tasks` | id(PK), title, description, status(todo/done), priority(P0-P3), due_date, start_date, reminder_time, parent_id, order_index(Lexorank), tags(JSON), owner, category_id(FK), meta(JSON) |
| `categories` | id(PK), name, color, sort_order, created_at, updated_at |
| `settings` | key(PK), value |

---

## 6. 渲染层

```
 src/main.tsx → App.tsx
   │
   ├─ useTheme()                      主题（window.setThemeSource）
   ├─ collectViews()（src/modules/）   侧边栏 tab：tasks/toolbox/dsh
   │    + useFeature('tasks'|'toolbox'|'dsh') 按功能开关过滤 tab
   ├─ Zustand stores（task/category/settings/tool）
   │    全部经 window.electronAPI（preload contextBridge）→ IPC → AppService
   ├─ 事件订阅：inbox:processed / reminder:open /
   │    window:maximizedChange / update:* / dsh:statusChanged
   ├─ 三大区：侧边栏(CategorySidebar/ToolboxSidebar)
   │          中部(FadeSwitch: TaskList/ToolboxWorkspace/DshPage)
   │          详情面板(DetailPanel, w-80)
   └─ 设置弹窗 SettingsDialog（小节来自模块声明）
```

**样式与动画统一（强制约定）**

- 动画 token 集中于 `src/styles/globals.css` 的 `@theme`：时长 `--duration-fast/base/medium`、缓动 `--ease-*`、`--animate-fade-slide-up` / `--animate-fade-out`。调整动画节奏只改 `@theme`，不碰组件类名。
- 动画原语 `src/components/fade.tsx`：`FadeBlock`（条件块进出场）、`FadeSwitch`（容器切换）、`Collapse`（高度折叠）；全部 200ms 统一缓动，reduced-motion 兜底。
- 面板分隔 token：`--color-panel*`（内容/顶栏/侧栏/详情）、`--color-divider`（布局分隔线专用，控件边框仍用 `border-input`）；分隔样式经 `<html data-panel-style="divider|tint">` 切换，模式值集中定义，组件不写死判断。
- 单一所有权 + 抑制模型：每个过渡只有顶层容器播动画；`MotionContext` / `useMotionSuppress()` 在容器过渡期间向内层传播抑制信号。

---

## 7. IPC 通道总表

### 7.1 AppService 通道（app-shell 自动生成 ipcMain.handle）

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

### 7.2 UI 专属 IPC（模块 registerIpc，对话框/窗口类）

| 通道 | 功能 | 模块 |
|------|------|------|
| `task:exportMarkdown` | 导出 Markdown（保存对话框） | tasks |
| `db:export/import` | 备份/恢复（对话框） | backup |
| `db:chooseDataDir` | 选择数据目录（对话框） | data-location |
| `image:pickAndSave` | 选择并保存图片（对话框） | images |
| `inbox:openDir` | 打开收件夹 | inbox |
| `window:minimize/maximizeToggle/close/setThemeSource` | 窗口控制 | window |
| `update:check/download/install` | 自动更新 | updater |

### 7.3 事件推送（主进程 → 渲染层，`ctx.send`）

`inbox:processed`、`reminder:open`、`window:maximizedChange`、`update:checking/available/not-available/error/progress/downloaded`、`dsh:statusChanged`、`dsh:pluginLog`、`dsh:pluginDone`、`log:appended`。

---

## 8. 目录结构

```
electron/
  main/                 主进程
    index.ts            入口（单实例/生命周期）
    app-shell.ts        装配器（startAppShell）
    database/           SQL.js DAO（task/category/settings-dao）+ saveAsync
    data-location.ts    数据目录解析/迁移
    import-inbox.ts     收件夹增量导入
    window-store.ts     主窗口句柄 + sendToRenderer
    reminder-service.ts 任务提醒调度
    http-client.ts      工具箱 http:request 执行器
  core/                 平台核心（纯 TS，主进程与渲染层共享）
    schema.ts           SQL 单一来源 + runMigrations
    contracts.ts        平台契约（FeatureModule/ctx）
    app-service.ts      统一业务层
    module-registry.ts  模块装配器
    feature-flags.ts    功能开关
  modules/              内置 FeatureModule（每域一目录）
    app/ window/ tasks/ categories/ settings/ images/ backup/
    data-location/ inbox/ toolbox/ notifications/ updater/ dsh/ logs/
  preload/index.ts      contextBridge 安全桥（window.electronAPI）

src/
  App.tsx / main.tsx        渲染入口与三区布局
  components/               业务组件（task/dsh/toolbox/settings/...）
  components/ui/            shadcn/ui 原始组件（勿改）
  stores/                   Zustand（task/category/settings/tool）
  hooks/                    use-feature / use-theme / ...
  lib/                      工具函数（lexorank/markdown/utils/...）
  modules/                  渲染层模块声明（views）
  types/                    task.ts / electron.d.ts

scripts/                   构建与校验脚本（build-dsh/check-dsh-package/...）
resources/                 应用图标 + DSH 运行时（build:dsh 生成）
docs/                      本文件 + 规划稿
```

---

## 9. 关键决策与约束

1. **单一权威库**：SQL.js 内存态 + 原子落盘（tmp+rename），主进程是唯一写者。
2. **统一业务层（AppService）**：UI 数据通道共用一张业务表，对话框/窗口类通道留在模块 IPC。
3. **Schema/契约单一来源**：`core/schema.ts`、`core/contracts.ts` 被主进程与渲染层共享，禁止复制漂移。
4. **渲染层不碰文件**：所有数据读写经 `window.electronAPI` → IPC → AppService。
