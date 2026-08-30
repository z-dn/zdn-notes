# DeepSeek Harness (DSH) 内嵌集成计划

> 状态：**已实现（implementation）**。Web UI 嵌入方案已落地（2026-08-21），
> 托管层于 2026-08-30 迁移到 Electron `utilityProcess`（见下文「架构」）。

## 1. 目标

将 DeepSeek Harness (DSH) 作为内置模块集成到 ZDNotes 中，实现**开箱即用**的 AI 编程助手：

- 用户无需安装 Node.js、pnpm 或 DSH CLI
- 所有运行时依赖打包在 Electron 应用内
- DSH 完全运行在 Electron 内置 Node.js 环境中
- 通过 GUI 内嵌 `<webview>` 使用 DSH 官方 Web UI

## 2. 技术约束

| 约束 | 说明 |
|------|------|
| DSH 要求 Node.js `^22.19 \|\| >=24` | Electron 42 内置 Node.js 24.18.1，满足要求 ✅ |
| DSH Web 是普通 HTTP 服务 | 不需要 TTY / node-pty；用 `<webview>` 渲染 |
| 仅绑定 loopback（127.0.0.1） | 不暴露到局域网，安全边界清晰 |
| Cordis Loader 动态解析 `@deepseek-ai/dsh-*` | 必须从 `node_modules` 加载，不能打包成单文件 |
| `cordis.patch.yml` 含 `!!js` 运行时表达式 | 不能静态打包，必须保持文件形式 |
| DSH 的 loader 要访问 Node 内部模块 | Electron 的 Node 不暴露 `node-addon-require-builtin` 依赖的 V8 符号，需 `--expose-internals`（见「关键坑」） |

## 3. 架构

### 3.1 进程模型

DSH 完全托管在 Electron `utilityProcess` 里，不再随包分发独立 `node.exe`：

```
┌───────────────────────────────────────────────────────────────┐
│  ZDNotes 主进程                                               │
│                                                               │
│  DshManager                                                  │
│   ├─ utilityProcess.fork(dsh-bin.js, ['--profile','web',     │
│   │   '--no-open','--port',<预留端口>], {                     │
│   │     cwd: DSH_HOME, env: buildEnv(), stdio:'pipe',         │
│   │     serviceName:'zdn-dsh',                                │
│   │     execArgv:['--expose-internals'] })                    │
│   │      → DSH Web UI 服务进程（HTTP loopback）                │
│   │                                                           │
│   └─ utilityProcess.fork(dsh-bin.js, ['plugin','--profile',   │
│       'web','add|remove',spec], { stdio:'pipe',               │
│       serviceName:'zdn-dsh-plugin', execArgv:[...] })         │
│          → 插件操作（pnpm 转发器），按需瞬态 fork              │
│                                                               │
│  渲染层: <webview src="http://127.0.0.1:<port>">               │
└───────────────────────────────────────────────────────────────┘
```

- **运行时**：`utilityProcess.fork` 直接加载 `resources/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js`，
  跑在 Electron 内置 Node 24（满足 DSH `^22.19 || >=24`）；web profile 是普通 HTTP 服务，不需要 TTY。
- **端口**：主进程用 `net.createServer().listen(0,'127.0.0.1')` 预占空闲端口后 close，以 `--port <p>`
  传入 DSH——**不再解析 stdout**（`utilityProcess` 无 `--port 0` 回显链路）。
- **就绪**：fork 后立即对已知端口做 HTTP 探测（250ms 轮询，总超时 60s，首次需 pnpm 建 profile）。
- **日志**：`stdio:'pipe'` 保留 `child.stderr`，启动失败时把尾部写入错误信息。

### 3.2 关键坑：`--expose-internals`

DSH 的 `cordis-plugin-loader` 需要访问 `internal/modules/esm/loader` 获取 ESM 加载器。它优先走
`process.execArgv.includes('--expose-internals')` 分支，否则回退到 `node-addon-require-builtin`
原生插件——而 **Electron 的 Node 不暴露该插件依赖的 V8 符号**（`GetAlignedPointerFromEmbedderData`），
导致 HMR 服务报 `--expose-internals is required for HMR service`、启动即退。

**解法**：fork 时传 `execArgv: ['--expose-internals']`（服务进程与插件操作两处都要）。
Electron 的 utility 进程支持该标志，loader 走 execArgv 分支成功。已实测。

### 3.3 生命周期

- **启动**：`start()` 预留端口 → fork → 等 `child.on('spawn')` → HTTP 探测 → 就绪推送
  `dsh:statusChanged`。
- **退出**：`child.on('exit')` 清状态并推送；启动期内意外退出触发自愈（见 3.5）。
- **停止**：`stop()` 调 `child.kill()`——**会连带终止整棵进程树（含 node-pty 派生的 pwsh 孙进程，
  已实测）**，无需 taskkill；应用退出时 Electron 也会自动回收 utility 进程。
- **env**：`buildEnv()` 统一构造——继承应用环境但删除 `NODE_OPTIONS`/`ELECTRON_RUN_AS_NODE`/
  `ELECTRON_*`（避免污染纯 Node 运行时），设 `DSH_HOME`/`NODE_PATH`/PATH 前置 `bin/pnpm.exe`/
  `DSH_SIDEBAR_SHELL`；server 额外加 `TERM`/`DEEPSEEK_API_KEY`/`DSH_MODEL`。

### 3.4 插件管理

`dsh plugin` 本质是 pnpm 转发器（内部 `spawnSync("pnpm")`）。应用把自带 `bin/pnpm.exe` 前置进
PATH（`buildEnv`），在瞬态 utility 进程里跑 `bin.js plugin --profile web add|remove <spec>`，
`stdout/stderr` 经 `dsh:pluginLog`/`dsh:pluginDone` 流式推送。

自动修复链（按序尝试，任一成功即止）：

1. `ERR_PNPM_UNEXPECTED_STORE` → 清 profile node_modules 重试
2. `ERR_PNPM_IGNORED_BUILDS` → 解析全部被拦包名，`--allow-build` 放行重试
3. 瞬时网络错误 → 原样重试一次
4. 仍带被拦构建脚本 → 再次固化 `pnpm-workspace.yaml` 策略后重试

无论成败，结束后 `reconcileBundles()` 双向对账（根治「依赖已记录但 bundle 层缺失」）。
构建策略（`dangerouslyAllowAllBuilds: true` + `minimumReleaseAge: 0`）由 `healProfileBuildPolicy()`
幂等写入 profile 的 `pnpm-workspace.yaml`。

### 3.5 自愈（manifest 判定）

启动期内子进程意外退出时，按 `profiles/web/package.json` 的 `dsh.profile.bundles` **是否缺失
`@deepseek-ai/dsh-web-app`**（v1.8.2 损坏）或 manifest 不可读，才删除 `profiles/web` 重建并重试一次。

> **绝不按物理 `profiles/web/node_modules` 路径判定**：此部署下核心包经 junction 回退层
> （`profiles/node_modules/@deepseek-ai/*` → base）解析，`profiles/web/node_modules` 恒不存在，
> 按物理路径判断会恒真误删用户插件。

## 4. 决策与理由

| 决策 | 理由 |
|------|------|
| 直接 fork `bin.js`（黑盒 CLI），不建 launcher/MessagePort 桥 | DSH 是第三方 CLI，不响应 `parentPort`；包装会让 DSH 变孙进程，退出自动回收失效、树清理更复杂 |
| HTTP 探测判就绪，不用日志行解析 | 探测确认真在服务；`--port 0`+正则解析已随独立 node.exe 一起废弃 |
| 不用独立 node.exe | Electron 内置 Node 24 满足 DSH 版本要求；DSH 原生依赖（node-pty/ssh2 等）走 NAPI，ABI 稳定 |
| 不用 taskkill | `utilityProcess.kill()` 实测连带终止整棵进程树 |
| 保留 `stdio:'pipe'` | 需要 `child.stderr` 做启动失败诊断 |

## 5. 构建与打包

| 环节 | 说明 |
|------|------|
| `scripts/build-dsh.mjs` | 用 pnpm `--node-linker=hoisted` 预装 `@deepseek-ai/dsh` 到 `resources/dsh`；不再下载独立 node.exe |
| `scripts/copy-dsh-runtime.cjs` | afterPack 钩子白名单拷贝 `resources/dsh`（`bin`/`node_modules`/`package.json`/`pnpm-lock.yaml`）进产物 |
| `scripts/check-dsh-package.mjs` | 校验产物含 `bin/pnpm.exe` + DSH 入口 + DSH 版本下限 |
| `scripts/validate-dsh-utility.mjs` | 真实 Electron 里 utilityProcess 拉起 DSH：基线启动 200、损坏 profile 重建回归、pnpm 策略固化断言 |
| release.yml | `build:dsh` 后跑 `npm run validate:dsh`；安装包体积下限 135MB（实测后校准） |

## 6. Dev 陷阱：junction 穿透删除

DSH 每次 boot 都经 `healProfilesModuleFallback`（`@deepseek-ai/dsh-app-boot`）在
`DSH_HOME/profiles/node_modules/@deepseek-ai/*` 建 **junction → base**（模块回退层）。
**Electron 的 `fs.rmSync(recursive)` 会穿透 junction 删除目标内容**（系统 node 24.4+ 已修复、
Electron 24.17 未修复，已实测）。

- **禁止递归删除任何 DSH home**（数据目录 `dsh`/临时 home）——会清空开发机 base 的 `@deepseek-ai/*`，
  表现为 bin.js 消失、`ERR_MODULE_NOT_FOUND`、DSH tab 报「运行时不可用」。
- 清理必须先 `unlinkSync` 逐条 unlink junction 再删（`validate-dsh-utility.mjs` 的 `safeRm` 即此模式）。
- 打包产物 base 是 `cpSync` 的真实文件、应用自身从不递归删 home，**生产不受影响**。

## 7. Shell 访问说明

DSH Web UI 内置 shell 工具栈——Windows 启用 `pwsh` 工具（`dsh-tool-pwsh` + `dsh-pwsh-sandbox`），
bash 工具在 win32 禁用；沙盒默认 `workspace-write` + 审批 `ask`（可用环境变量
`DSH_PERMISSION_MODE` 改部署默认，或直接在 Web UI 设置/`/permission` 命令里切换预设）。