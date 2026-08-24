# DeepSeek Harness (DSH) 内嵌集成计划

> 状态：**已实现（implementation）**。Web UI 嵌入方案已落地并通过冒烟测试（2026-08-21）。
>
> **P0 验证结果**：Electron 42.5.2 内置 Node.js 24.18.1，满足 DSH `^22.19 || >=24` 要求 ✅
>
> **关键修正**：
> - DSH 官方以 **Web UI** 为主（`dsh --profile web`，默认 http://127.0.0.1:3080）；
>   TUI 是社区插件，本项目采用官方 Web UI。
> - 不能用 `electron.exe` 的 Node 跑 DSH 服务端（Electron 是 GUI 子系统，且无 CLI 入口）；
>   改为随包分发一个 console-subsystem 的 `node.exe` 来跑 `dsh --profile web` HTTP 服务，
>   渲染层用 `<webview>` 加载 loopback 地址。Web UI 是普通 HTTP 服务，**不需要 TTY/node-pty**。

> ⚠️ **方案变更（2026-08-21 二次修订）**：本文档第 2~5 节的「架构 / 依赖 / 构建 / 运行时流程 / 风险表」
> 描述的是**早期的 TUI 原型**（xterm.js + node-pty），已被官方 Web UI 嵌入方案取代。
> 当前实现见 `electron/modules/dsh/`、`src/components/dsh/dsh-page.tsx`、脚本 `scripts/build-dsh.mjs`。
> 关键差异：无 node-pty / xterm / TUI 插件；启动命令为 `dsh --profile web`；渲染用 `<webview>`。
> 第 1 节目标、技术约束表（已更新）、P0 版本验证结论仍有效。
>
> **当前实现状态（2026-08-24）**：
> - 模块默认启用（feature flag `module.dsh`，optional）；侧边栏 tab「DSH」经 `useFeature('dsh')` 控制。
> - 就绪判定 = 输出解析端口（忽略占位 0）+ HTTP 探测通过，总超时 15s（`DshManager.start`）。
> - 状态变化经 `dsh:statusChanged` 事件推送渲染层，无轮询；停止用 `taskkill /T /F` 清理整棵进程树。
> - TUI 时代的一次性验证脚本（validate-dsh-pty/tty-electron/boot.mjs）已删除，仅保留 `validate-dsh-integ.mjs`。

## 1. 目标

将 DeepSeek Harness (DSH) 作为内置模块集成到 ZDNotes 中，实现**开箱即用**的 AI 编程助手：

- 用户无需安装 Node.js、pnpm 或 DSH CLI
- 所有运行时依赖打包在 Electron 应用内
- DSH 完全运行在 Electron 内置 Node.js 环境中（沙箱化）
- 通过 GUI 内嵌 `<webview>` 使用 DSH 官方 Web UI（开箱即用）

## 2. 背景

### DeepSeek Harness 是什么

DSH 官方以 **Web UI** 为主（`dsh --profile web`，基于 Cordis 框架的模块化 React 应用），
也提供社区 TUI 插件。本项目采用官方 Web UI 嵌入方案，基于 Cordis 插件框架构建：

- 流式 Markdown 渲染、结构化工具卡、命令补全
- 会话管理（resume/new/compact/export）
- MCP 集成、Agent preset、Skills 系统
- 子代理、审批面板、权限管理
- 官方 npm 包：`@deepseek-ai/dsh`（含 `--profile web` 子命令，跑本地 HTTP 服务）

### 技术约束

| 约束 | 说明 |
|------|------|
| DSH 要求 Node.js `^22.19 \|\| >=24` | Electron 42 内置 Node.js 24.18.1，满足要求 ✅ |
| DSH Web 是普通 HTTP 服务 | 不需要 TTY / node-pty；用 `<webview>` 渲染 |
| 仅绑定 loopback（127.0.0.1） | 不暴露到局域网，安全边界清晰 |
| Cordis Loader 动态解析 `@deepseek-ai/dsh-*` | 必须从 `node_modules` 加载，不能打包成单文件 |
| `cordis.patch.yml` 含 `!!js` 运行时表达式 | 不能静态打包，必须保持文件形式 |

## 3. 架构

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  ZDNotes Electron App                                          │
│                                                                 │
│  ┌───────────────────────┐       ┌───────────────────────────┐  │
│  │  渲染进程 (React)       │       │  主进程 (Node.js)          │  │
│  │                       │       │                           │  │
│  │  ┌─────────────────┐  │  IPC  │  ┌─────────────────────┐  │  │
│  │  │ DshPage          │  │◄────►│  │ DshModule            │  │  │
│  │  │  ├─ <webview>    │  │       │  │  (FeatureModule)     │  │  │
│  │  │  │  (官方 Web UI)│  │       │  └──────────┬──────────┘  │  │
│  │  │  └─ DshSidebar   │  │       │             │              │  │
│  │  │     (启动/配置)  │  │       │  ┌──────────▼──────────┐  │  │
│  │  └─────────────────┘  │       │  │ DshManager           │  │  │
│  │                       │       │  │  child_process.spawn │  │  │
│  └───────────────────────┘       │  └──────────┬──────────┘  │  │
│                                  │             │              │  │
│  ┌───────────────────────┐       │  ┌──────────▼──────────┐  │  │
│  │  resources/dsh/        │       │  │ DSH Web 子进程        │  │  │
│  │  (extraResources)      │       │  │ node.exe (控制台子系统)│  │  │
│  │  ├── node.exe          │◄──────│  │ `dsh --profile web` │  │  │
│  │  ├── node_modules/     │       │  │ NODE_PATH=预装目录   │  │  │
│  │  │   └─ @deepseek-ai/  │       │  │ DSH_HOME=用户数据    │  │  │
│  │  │      dsh            │       │  │ DEEPSEEK_API_KEY     │  │  │
│  │  └── (无 profile 预置) │       │  │ 监听 127.0.0.1:<port>│  │  │
│  └───────────────────────┘       │  └─────────────────────┘  │  │
│                                  └───────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

> ⚠️ **关键修正（原型验证发现）**：DSH 的 TUI 需要真正的 TTY。Electron 是 GUI 子系统进程，
> 其内置 Node 运行时即使经 node-pty 也**拿不到 TTY**（`process.stdout.isTTY` 为 `undefined`）。
> 因此 DSH **不能**用 `ELECTRON_RUN_AS_NODE=1` + `electron.exe` 启动（MCP 那种 line 协议可以，TUI 不行）。
> 必须随包分发一个 **console-subsystem 的 `node.exe`**（Node 24.x for win-x64），用 node-pty 启动它来跑 DSH。
> 该 node.exe 是应用自带的，不依赖用户电脑上的 Node——仍满足"零系统依赖、开箱即用"。

### 3.2 进程模型

```
ZDNotes 主进程
  │
  ├── 渲染进程 (Chromium)
  │     └── xterm.js 终端组件 ←→ IPC ←→ DshManager
  │
  └── DSH 子进程 (node.exe + node-pty, 非 electron.exe)
        ├── 可执行: process.resourcesPath/dsh/node.exe   (控制台子系统)
        ├── 入口:   process.resourcesPath/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js
        ├── 参数:   --profile dsh-tui
        ├── 环境:   NODE_PATH / DSH_HOME / DEEPSEEK_API_KEY / TERM=xterm-256color
        ├── 运行:   Cordis 框架 → DSH 服务 → DeepSeek API
        └── I/O:    node-pty ConPTY ↔ stdin/stdout ↔ xterm.js（真 TTY，isTTY=true）
```

DSH 子进程通过 `node-pty` 创建 Windows ConPTY 伪终端，由 console-subsystem 的 node.exe 承载，获得完整的 TTY 能力（ANSI 转义、光标控制、颜色等，`isTTY=true`），输出通过 IPC 桥接到渲染进程的 xterm.js 显示。

### 3.3 模块结构

```
electron/modules/dsh/
  ├── index.ts              FeatureModule 定义
  ├── dsh-manager.ts        node-pty 子进程管理
  ├── config.ts             DSH 配置读写（API key、model）
  └── profile-init.ts       首次启动 profile 初始化

src/modules/dsh.ts          RendererModule 声明（侧边栏 tab）
src/components/dsh/
  ├── dsh-page.tsx          DSH 页面（终端 + 工具栏 + 状态）
  ├── dsh-terminal.tsx      xterm.js 封装组件
  └── dsh-settings.tsx      DSH 配置 UI（API key、model 选择）
```

## 4. 依赖

### 4.1 新增 npm 依赖

| 包名 | 位置 | 版本 | 用途 |
|------|------|------|------|
| `xterm` | renderer (dependencies) | `^5.x` | 终端渲染组件 |
| `@xterm/addon-fit` | renderer (dependencies) | `^0.10.x` | 终端自适应容器大小 |
| `@xterm/addon-web-links` | renderer (dependencies) | `^0.11.x` | 终端内可点击链接 |
| `node-pty` | main (devDependencies / native) | `^1.x` | Windows ConPTY 伪终端 |

### 4.2 DSH 运行时（extraResources，随包分发）

| 资源 | 版本 | 用途 |
|------|------|------|
| `node.exe` | Node 24.x (win-x64, console-subsystem) | 承载 DSH 的 Node 运行时（自带，非系统 Node） |
| `@deepseek-ai/dsh` | `^0.1.x` | DSH CLI 启动器 |
| `@deepseek-harness-tui/dsh-tui` | `^0.8.x` | DSH TUI 插件 |

这些资源在**构建时**预装/下载到 `resources/dsh/` 目录：
- `node.exe`：从 nodejs.org 下载对应版本的 `node.exe`（仅单一 exe，约 30MB），放入 `resources/dsh/`
- DSH 包：通过 pnpm 预装到 `resources/dsh/node_modules/`，并执行一次 `dsh plugin --profile dsh-tui add` 生成 profile

最终随 Electron 打包分发。运行时用户机器上不需要 Node / pnpm。

> 原生模块说明：DSH 的依赖树里含 `node-pty@1.2.0-beta`（DSH 自身用），但我们用的是**应用层 node-pty**（Electron 内、预编译二进制、ABI 131），与 DSH 内部的 node-pty 无关，互不干扰。

### 4.3 electron-builder 配置

```yaml
# electron-builder.yml 新增
extraResources:
  - from: resources/dsh/
    to: dsh/
    filter:
      - "**/*"
```

> 打包时 `resources/dsh/` 应已包含：`node.exe`、`node_modules/`、`profiles/`（或首次启动用 seed 脚本生成 profile）。

## 5. IPC 通道

| 通道 | 方向 | 参数 | 返回 | 说明 |
|------|------|------|------|------|
| `dsh:start` | renderer→main | `{ apiKey?, model? }` | `{ ok, pid }` | 启动 DSH 子进程 |
| `dsh:stop` | renderer→main | — | `{ ok }` | 终止 DSH 子进程 |
| `dsh:input` | renderer→main | `{ data: string }` | — | 向 DSH 发送用户输入 |
| `dsh:resize` | renderer→main | `{ cols, rows }` | — | 终端尺寸变更 |
| `dsh:getStatus` | renderer→main | — | `{ running, pid, uptime }` | 查询进程状态 |
| `dsh:onData` | main→renderer | `{ data: string }` | — | DSH 输出数据推送 |
| `dsh:onExit` | main→renderer | `{ code, signal }` | — | DSH 进程退出通知 |
| `dsh:getConfig` | renderer→main | — | `{ apiKey, model, baseUrl }` | 读取 DSH 配置 |
| `dsh:setConfig` | renderer→main | `{ apiKey?, model?, baseUrl? }` | `{ ok }` | 写入 DSH 配置 |

## 6. 配置存储

DSH 配置存储在 SQLite settings 表中：

| key | 类型 | 默认值 | 说明 |
|-----|------|--------|------|
| `dsh.enabled` | `"true"/"false"` | `"true"` | 模块是否启用 |
| `dsh.apiKey` | string | `""` | DeepSeek API Key |
| `dsh.model` | string | `"deepseek-chat"` | 使用的模型 |
| `dsh.baseUrl` | string | `""` | 自定义 API 端点（可选，用于代理或兼容端点） |
| `dsh.seeded` | `"true"/"false"` | `"false"` | profile 是否已初始化 |

API Key 通过环境变量 `DEEPSEEK_API_KEY` 注入 DSH 子进程，不暴露在命令行参数中。

## 7. 关键流程

### 7.1 构建时准备

```
scripts/build-dsh.mjs
  │
  ├── 1. 创建临时目录
  ├── 2. pnpm init + pnpm add @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui
  ├── 3. 构建 profile 目录结构:
  │     resources/dsh/
  │     ├── node_modules/       ← pnpm install 产物
  │     ├── profiles/dsh-tui/
  │     │   ├── package.json    ← 声明 bundles 和 dependencies
  │     │   └── cordis.patch.yml ← TUI profile 配置
  │     └── cli/
  │         └── index.cjs       ← 启动脚本（esbuild 打包）
  └── 4. 清理临时目录
```

### 7.2 首次启动初始化

```
seed-dsh.ts（在 app-shell.ts 中调用）
  │
  ├── 检查 settings['dsh.seeded'] === 'true' → 跳过
  ├── 检查 process.resourcesPath/dsh/ 存在
  ├── 复制 resources/dsh/profiles/ → <userData>/dsh/profiles/
  ├── 写入 settings['dsh.seeded'] = 'true'
  └── 完成
```

### 7.3 DSH 启动流程

```
用户点击"启动 DSH"
  │
  ├── DshManager.start()
  │     ├── 读取配置（API key、model）
  │     ├── 构建环境变量:
  │     │     ELECTRON_RUN_AS_NODE=1
  │     │     NODE_PATH=<resourcesPath>/dsh/node_modules
  │     │     DSH_HOME=<userData>/dsh
  │     │     DEEPSEEK_API_KEY=<from config>
  │     │     DEEPSEEK_BASE_URL=<from config, 可选>
  │     ├── node-pty.spawn(process.execPath, [cli入口, '--profile', 'dsh-tui'], { env, cols, rows })
  │     ├── 监听 pty.onData → IPC 'dsh:onData' → xterm.js
  │     ├── 监听 pty.onExit → IPC 'dsh:onExit' → 通知渲染进程
  │     └── 返回 { ok: true, pid }
  │
  └── 渲染进程
        ├── xterm.js.open() → 终端就绪
        ├── onResize → IPC 'dsh:resize' → pty.resize()
        └── onData → IPC 'dsh:input' → pty.write()
```

### 7.4 数据流

```
用户键盘输入
  → xterm.js onData
  → IPC 'dsh:input' { data }
  → DshManager → pty.write(data)
  → DSH 子进程 stdin
  → DSH 处理（调用 DeepSeek API / 执行工具）
  → DSH 子进程 stdout（ANSI 转义序列）
  → pty.onData
  → IPC 'dsh:onData' { data }
  → xterm.js.write(data)
  → 终端渲染
```

## 8. 文件清单

### 新增文件

| 文件 | 说明 |
|------|------|
| `electron/modules/dsh/index.ts` | FeatureModule 定义 |
| `electron/modules/dsh/dsh-manager.ts` | node-pty 子进程管理 |
| `electron/modules/dsh/config.ts` | DSH 配置读写 |
| `electron/modules/dsh/profile-init.ts` | 首次启动 profile 初始化 |
| `src/modules/dsh.ts` | RendererModule 声明 |
| `src/components/dsh/dsh-page.tsx` | DSH 页面组件 |
| `src/components/dsh/dsh-terminal.tsx` | xterm.js 封装 |
| `src/components/dsh/dsh-settings.tsx` | DSH 配置 UI |
| `scripts/build-dsh.mjs` | 构建时 DSH 预装脚本 |
| `electron/main/seed-dsh.ts` | 首次启动 profile 种子 |
| `docs/dsh-integration-plan.md` | 本文档 |

### 修改文件

| 文件 | 修改内容 |
|------|----------|
| `electron/modules/index.ts` | 将 `dshModule` 加入 `BUILTIN_MODULES` |
| `src/modules/index.ts` | 将 `dshViews` 加入 `RENDERER_MODULES` |
| `src/types/electron.d.ts` | 添加 DSH IPC 类型声明 |
| `electron-builder.yml` | 添加 `extraResources`（dsh 目录） |
| `electron/main/app-shell.ts` | 调用 `seed-dsh()` |
| `package.json` | 添加 xterm、node-pty 依赖 |
| `scripts/build.mjs`（如有） | 添加 DSH 构建步骤 |

## 9. 实施步骤

| 阶段 | 任务 | 依赖 | 预估 |
|------|------|------|------|
| P0 | 验证 Electron 42 内置 Node.js 版本是否满足 DSH `^22.19 \|\| >=24` | 无 | 0.5h |
| P1 | 安装 xterm.js + node-pty 依赖 | 无 | 0.5h |
| P2 | 实现 `DshManager`（node-pty spawn + 数据桥接） | P1 | 3h |
| P3 | 实现 `dshModule` FeatureModule（IPC 通道） | P2 | 2h |
| P4 | 实现 xterm.js 终端组件 | P1 | 2h |
| P5 | 实现 DSH 页面 + 侧边栏集成 | P3, P4 | 2h |
| P6 | 实现 profile 初始化 + DSH 配置 UI | P3 | 2h |
| P7 | 构建脚本 `build-dsh.mjs` + electron-builder 配置 | P0 | 3h |
| P8 | 端到端测试 | P7 | 2h |

总预估：约 17 小时（不含 Electron Node 版本不兼容时的额外工作）。

## 10. 风险与缓解

| 风险 | 影响 | 概率 | 缓解 |
|------|------|------|------|
| Electron 42 内置 Node.js 版本不满足 DSH 要求 | DSH 无法启动 | ~~中~~ **已排除** | Electron 42.5.2 内置 Node.js 24.18.1 ✅ |
| `electron.exe` 的 Node 拿不到 TTY | DSH TUI 无法渲染 | ~~高~~ **已排除（改用 node.exe）** | 见附录 A：必须随包分发 console-subsystem `node.exe` |
| `node-pty` 在 Electron 内 ConPTY 不稳定 | 终端渲染异常 | 低 | 原型已验证预编译二进制可用（ABI 131，无需 C 编译器）；ConPTY 在 Win10 1903+ 稳定 |
| DSH 预装目录体积过大（可能 200-500MB）+ node.exe ~30MB | 安装包膨胀 | 高 | 考虑按需下载或仅包含必要依赖 |
| Cordis Loader 的模块解析不兼容 `NODE_PATH` | 找不到 DSH 插件 | ~~中~~ **已排除** | 原型验证：设 `NODE_PATH` 后 Cordis 正确解析（见附录 A） |
| DSH 子进程内存/CPU 占用高 | 应用卡顿 | 中 | 提供显式启停控制，默认不自动启动 |
| DSH API Key 安全存储 | Key 泄露 | 低 | 通过环境变量注入，不明文写入日志或磁盘 |
| DSH 更新后 profile 不兼容 | 需重新初始化 | 中 | 版本检查 + 自动重新 seed |

## 11. 验证清单

- [x] Electron 42 内置 Node.js 版本确认：Node.js 24.18.1 ✅
- [x] node-pty 在 Electron 运行时内加载（预编译二进制，ABI 131，无需 C 编译器）✅
- [x] node-pty 为 console-subsystem node 造真 TTY（`isTTY=true`）✅
- [x] DSH 经 `NODE_PATH` + node-pty 成功启动并渲染 TUI ✅（见附录 A）
- [ ] **electron.exe 的 Node 能否承载 TTY** → 结论：不能（见附录 A，故改用 node.exe）
- [ ] xterm.js 能正确渲染 DSH 输出（颜色、光标、清屏等）
- [ ] 键盘输入能正确传递到 DSH
- [ ] 终端 resize 能正确同步
- [ ] DSH 能通过 DeepSeek API 正常对话
- [ ] DSH 能调用 MCP 工具（连接 ZDNotes 的 MCP server）
- [ ] 首次启动 profile 初始化正常
- [ ] API Key 配置保存和读取正常
- [ ] 打包后 extraResources 路径正确
- [ ] 打包后 DSH 能正常启动（无开发环境依赖）

---

## 附录 A：原型验证记录（2026-08-21）

### A.1 环境与命令

- 系统：Windows 11，Node.js v24.4.0（系统），Electron 42.5.2（内置 Node 24.18.1）
- `node-pty@1.1.0`（预编译 `prebuilds/win32-x64`，ABI 131）；`pnpm@11.7.0`
- DSH 临时安装：`pnpm add @deepseek-ai/dsh@0.1.0-rc.8 @deepseek-harness-tui/dsh-tui@0.8.6`（520 包）
- profile 初始化：`node .../@deepseek-ai/dsh/lib/bin.js plugin --profile dsh-tui add @deepseek-harness-tui/dsh-tui`

### A.2 验证脚本（留存于 `scripts/`）

| 脚本 | 验证内容 |
|------|----------|
| `scripts/validate-dsh-pty.mjs` | node-pty 在 Electron 内加载 + 造 TTY（spawn 系统 node，验证 `isTTY=true`） |
| `scripts/validate-dsh-tty-electron.mjs` | 验证 `electron.exe` 经 node-pty **拿不到** TTY（`isattyStdout:false`） |
| `scripts/validate-dsh-boot.mjs` | 设 `NODE_PATH` + `DSH_HOME`，node-pty spawn DSH，`--profile dsh-tui` 启动 TUI |

### A.3 结论

1. **node-pty 可零编译集成**：Electron 42 内置 Node 24.18.1 与系统 Node 24.4.0 同为 ABI 131，
   node-pty 1.1.0 的预编译二进制（`prebuilds/win32-x64/pty.node`、`conpty.node`）直接可加载，
   **无需 MSVC / VS Build Tools**。`electron-builder install-app-deps` 试图从源码重编会因缺编译器失败，
   但可忽略——预编译二进制已满足需求（构建 CI 需安装 VS 工具链或配置跳过 rebuild，见 A.4）。
2. **TTY 仅 console-subsystem 进程可得**：`electron.exe` 即使在 `ELECTRON_RUN_AS_NODE` 下，
   经 node-pty 启动后 `tty.isatty(1)===false`、`process.stdout.isTTY===undefined`（因其为 GUI 子系统）。
   系统 `node.exe`（console-subsystem）经 node-pty 启动则 `isTTY===true`。**故 DSH 必须用自带 node.exe 跑。**
3. **DSH 启动成功**：用系统 node + `NODE_PATH=临时node_modules` + `DSH_HOME=临时profile` +
   `DEEPSEEK_API_KEY=test`，node-pty spawn 后 TUI 正常渲染（看到 dsh-TUI v0.8.6 启动画面、模型名、
   输入提示），进程持续运行等待输入 → **方案成立**。

### A.4 待解决的工程细节

- **node-pty rebuild 失败**：`postinstall: electron-builder install-app-deps` 在缺 VS 工具链的机器上会报错退出。
  需在 CI/构建机安装 VS Build Tools，或在 `package.json` 中将 `electron-builder install-app-deps`
  改为「仅当存在原生构建环境时执行」，或显式 `--no-deps` 跳过（预编译二进制已够用）。当前开发机已成功
  加载预编译二进制，运行时不依赖 rebuild 成功。
- **node.exe 获取**：构建脚本 `build-dsh.mjs` 需从 `https://nodejs.org/dist/v24.x/win-x64/node.exe`
  下载单一 exe 到 `resources/dsh/node.exe`（约 30MB）。
- **profile 预生成**：构建时跑一次 `dsh plugin --profile dsh-tui add` 把 profile 固化进 `resources/dsh/profiles/`，
  运行时首次启动复制到 `<userData>/dsh/`。
- **完整 xterm.js 渲染**：原型用裸 node-pty 终端验证 TTY，尚未接 xterm.js；真正集成时需在渲染进程
  接 xterm.js + FitAddon，验证颜色/光标/清屏/resize。
