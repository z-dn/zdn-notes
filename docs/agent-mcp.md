# ZDNotes Agent MCP 接口

让支持 **MCP（Model Context Protocol）** 的智能体（DSH / OpenCode / Codex / Qoder 等）
直接读写 ZDNotes 的待办任务数据。当前为**本地优先**的 stdio 模式，远程（HTTP/SSE）模式
已预留传输抽象，二期接入。

## 特性

- **独立进程**：`zdn-mcp` 是独立 Node 进程，**不依赖 ZDNotes 窗口是否在跑**。
- **GUI-IPC 委托（GUI 运行时）**：检测到 ZDNotes 界面在跑时，`zdn-mcp` 把 `tools/call` 整包转发给 GUI 主进程的本地 loopback 端点（`electron/main/mcp-ipc.ts`），由 GUI 在自己权威内存库上执行并落盘——**运行时只有 GUI 一个写者，无锁竞争、无覆盖丢失**；界面也会通过 `data:changed` 事件自动刷新。
- **文件锁回退（GUI 不在时）**：GUI 未运行则回退直接文件模式，由 `.zdn-notes.lock` 单写者锁协调（GUI 优先、mcp 短持锁、残留锁按 pid 自动接管）。
- **可配置能力暴露**：智能体只能做"模拟 GUI 对待办项的操作"——创建/修改/查看/删除任务；由数据目录下 `agent-mcp-config.json` 白名单控制，分类等其它能力不提供。
- **本地优先**，数据直接落在 ZDNotes 自身数据目录（`zdn-notes.db`），无中间服务。

## 架构

```
[智能体 DSH/OpenCode/Codex/Qoder]
        |  stdio MCP（JSON-RPC over stdin/stdout）
        v
[zdn-mcp 独立进程 —— 本仓库 electron/mcp]
        |  检测到 GUI 在跑？ ──是──> 转发 tools/call ──> [GUI 主进程 mcp-ipc 端点：权威内存库 + 落盘 + data:changed 刷新界面]
        |  否
        |  文件锁(.zdn-notes.lock)协调 + 直接读写 SQL.js 库
        v
[<数据目录>/zdn-notes.db]
```

- 传输层与数据层解耦：`mcp-server.ts` 处理 MCP 消息（tools/list、tools/call），对传输载体中立；本地用 stdio，远程（HTTP/SSE）只需新增一个 `HttpTransport` 复用同一套 `handleMessage` 与数据层。
- **GUI-IPC 委托**：`gui-client.ts` 的 `buildGuiDelegate` 每请求重读 GUI 锁文件；有 endpoint（owner=gui + port/token）则把 `tools/call` 整包 POST 到 GUI 端点执行（白名单/校验/返回格式两端用同一 McpServer 逻辑），失败时若 GUI 已退出则回退文件模式。
- 进程内高频调用：同进程复用已加载的 SQL.js 内存库（`db.ts` 的缓存）；**写操作不信任缓存、每次基于磁盘最新态执行**，避免多 MCP 进程内存陈旧互相覆盖。工具调用经 `McpServer.enqueue` 串行化。

## 快速上手（开发环境）

先安装 tsx（用于直接运行 TypeScript 入口）：

```bash
npm i -D tsx
```

### CLI 冒烟测试（不依赖智能体）

```bash
# 列出任务
npm run mcp -- task list

# 创建一条任务
npm run mcp -- task add "周五前写完周报" --priority P1 --tags 工作

# 改状态
npm run mcp -- task done <id>

# 查看可用工具 / 当前权限配置
npm run mcp -- config show
```
## 接入 DSH / OpenCode / Codex / Qoder

这些智能体都原生支持 MCP，将本仓库 `zdn-mcp` 作为 **stdio MCP server** 配置。

### DSH（DeepSeek Harness）

在 DSH 的 MCP server 配置里添加一条 stdio server：

```jsonc
{  "mcpServers": {  "zdn-notes": {  "command": "npx",  "args": ["tsx", "<仓库路径>/electron/mcp/index.ts", "--stdio"],  "cwd": "<仓库路径>" } } }
```

### OpenCode

在 `opencode.json` 或项目配置的 `mcp` 段：

```json
{  "mcp": {  "zdn-notes": {  "type": "stdio",  "command": "npx",  "args": ["tsx", "<仓库路径>/electron/mcp/index.ts", "--stdio"],  "enabled": true } } }
```

### Codex

按 stdio server 注册：

```
codex mcp add zdn-notes -- npx tsx <仓库路径>/electron/mcp/index.ts --stdio
```

### Qoder

在 Qoder 设置 → MCP/工具 中新增 stdio server，command 同上。

**通用要点**：
- command 必须能启动 `electron/mcp/index.ts`（用 `npx tsx` 或安装后的可执行名）。
- 加 `--stdio` 才进入 MCP server 模式；不加则走 CLI。
- **CLI 兜底同样委托 GUI**：应用在跑时，`task add/list/get/done/todo/delete` 会自动映射成 `tools/call` 转发给 GUI 执行（避免文件锁超时），GUI 不在时回退文件模式；`config show` 始终本地读取。
- 智能体只会看到白名单里**允许**的工具（见下）。

## 打包版调用（无 Node/npm，用应用自身的 exe）

装好应用后，把 MCP server 命令指向安装目录的 `ZDNotes.exe`（默认每用户安装：`%LOCALAPPDATA%\Programs\zdn-notes\ZDNotes.exe`），开箱即用：

```jsonc
// 智能体 MCP server 配置
{
  "command": "C:\\Users\\<你>\\AppData\\Local\\Programs\\zdn-notes\\ZDNotes.exe",
  "args": ["--zdn-mcp-stdio"]
}
```

- `--zdn-mcp-stdio`：以 MCP server (stdio) 运行，供协议智能体拉起；靠 stdin 生命周期常驻，GUI 在跑时自动委托给它。
- `--zdn-mcp-cli <子命令>`：CLI 兜底，例如 `ZDNotes.exe --zdn-mcp-cli task add "标题"`。应用开着时同样委托 GUI，关着时走文件模式。
- 数据目录自动跟随应用（默认或 `data-location.json` 自定义），无需额外传参。
- **实现说明**：Electron 主进程的 `process.stdin` 在 Windows 上启动即 EOF（readline 立即 close，无法承载 stdio 传输），因此 `--zdn-mcp-stdio` 会以 `ELECTRON_RUN_AS_NODE=1` 自举一个**纯 Node 子进程**（`out/mcp/index.cjs`，由 `scripts/build-mcp.mjs` 打包，源为 `electron/mcp/index.ts`）直接继承当前 stdin/stdout 跑 MCP server；主进程保持存活并镜像子进程退出码。插件加载/插件日志一律写 stderr，不污染 stdout（JSON-RPC 通道）。
- **已知残留**：Windows 上 Electron 启动时会向 stdout 写入一个 `\r\n`（一个空行，位于任何 JSON-RPC 之前）。官方 MCP SDK 会跳过空行，属良性；要求绝对纯净 stdout 时可改用纯 Node 入口（`npx tsx <仓库>/electron/mcp/index.ts --stdio`）或远程 HTTP 模式。

## 能力配置（`agent-mcp-config.json`）

配置文件在**数据目录**下（默认 `%APPDATA%/zdn-notes/`，或 `data-location.json` 指定的自定义目录）。首次运行 mcp 会自动生成默认配置。**也可以用 GUI 管理：应用"设置 → AI 智能体（MCP）"，可开关总开关、勾选允许的工具，改即生效。**

```jsonc
{
  "enabled": true,          // 总开关
  "graph": "task",          // 数据图（当前 task，预留）
  "maxWaitLockMs": 2000,    // GUI 占用时的等待上限(ms)
  "permissions": {
    "task:create": true,        // 创建任务
    "task:read_list": true,     // 查任务列表
    "task:read_detail": true,   // 查任务详情
    "task:update_status": true, // 改状态 todo/done
    "task:update": true,        // 改任务内容
    "task:delete": true         // 删除任务
  }
}
```

- **MCP 仅提供任务四项能力**：创建 / 修改（状态+内容）/ 查看（列表+详情）/ 删除。等价于 GUI 里普通用户对待办项能做的操作；分类、数据目录路径、设置等内部能力一律不暴露（连配置开关都没有）。
- 被禁止的操作**不会出现在** MCP 的 `tools/list` 里，智能体看不到也没有权限调用。
- 配置文件缺失时自动生成以上默认值；**已存在的 `agent-mcp-config.json` 不会被自动改写**，如需应用新默认值请删除或手动编辑该文件（或在设置界面改）。
- 配置变更：GUI 在跑时**即时生效**（热更新委托端点）；已连接的独立 MCP 进程需重启。
## 锁与一致性 ——「GUI 优先」

锁文件：`<数据目录>/.zdn-notes.lock`，内容为 `{ owner: 'gui'|'mcp', pid, time, endpoint? }`。
`endpoint`（GUI-IPC 委托用）在 GUI 运行时写入 `{ port, token }`，`zdn-mcp` 据此把调用转发给 GUI。

| 场景 | 行为 |
|------|------|
| ZDNotes 界面启动 | 获取 GUI 锁并写入本地 IPC endpoint，成为权威写者（用户正在操作的界面优先） |
| mcp 写，界面没开 | 拿锁，独立完整操作（直接文件模式） |
| mcp 写，界面在跑 | 转发给 GUI 执行（GUI-IPC 委托），无锁等待；GUI 不可达时明确报错，不覆盖 GUI |
| 崩溃残留锁 | mcp 锁按 pid 判存活自动接管；GUI 锁用哨兵 pid，不误删 |

> **为什么不用「共享内存承载数据」**：SQL.js 的库是“一次性导出成文件”的内存态，两个进程各自 share 一份会互相覆盖（写丢失）。因此采用**单一写者**保证一致性：GUI 在跑时由 GUI 充当唯一写者（mcp 转发），GUI 不在时由文件锁 + 短事务轮流写。
> **为什么 GUI 在跑时还保留文件锁**：mcp 需要读锁发现 GUI 端点；GUI 不在时锁仍负责协调多个 mcp 进程。

## 远程（HTTP/SSE）模式

已提供可用的 **Streamable HTTP** 常驻服务骨架（`electron/mcp/http-server.ts`），
复用 `mcp-server.ts` 的 `handleMessage` 与 `db.ts` 数据层，业务零重复。

启动常驻服务：

```bash
npm run mcp:http                      # 默认绑 127.0.0.1 随机端口
ZDNOTES_MCP_PORT=8931 npm run mcp:http
ZDNOTES_MCP_TOKEN=mysecret npm run mcp:http   # 启用 Bearer 鉴权
```

然后智能体按 Streamable HTTP 连接 `POST http://127.0.0.1:<port>/mcp`，
如需鉴权在 header 带 `Authorization: Bearer <token>`。

安全与一致性：
1. 服务仅绑定 loopback（默认 127.0.0.1）；跨机器远程需显式配 host + 强化网络鉴权。
2. token 鉴权 + CORS 白名单（`--cors-origins`，或环境变量）。
3. 多客户端场景下由该常驻服务持有 SQL.js 库（进程内复用），与 GUI 仍用文件锁协调、单写者、GUI 优先。

> 未来可进一步演进：把 HTTP 端点的 token/端口写入 `agent-mcp-config.json`，
> 并在 ZDNotes 设置界提供一键启停；多客户端并发共享同一常驻服务。

## 目录结构

```
electron/mcp/
  index.ts         入口分派（--stdio / --http / CLI）
  mcp-server.ts    MCP 消息处理（传输层中立，stdio/http 复用；支持 delegate/dbSource 注入）
  gui-client.ts    GUI-IPC 委托客户端（检测 GUI 端点 + 转发 tools/call，GUI 不在时回退）
  http-server.ts   Streamable HTTP 常驻服务（远程模式）
  db.ts            独立 SQL.js 封装 + 任务/分类 CRUD + 短事务 + 写前重载
  lock.ts          GUI 优先文件锁(单写者) + 残留清理 + GUI endpoint 写入/读取
  config.ts        权限白名单配置(agent-mcp-config.json)
  data-location.ts 独立定位数据目录(不依赖 Electron)
  cli.ts           CLI 兜底命令（子命令映射 tools/call，GUI 运行时同样委托）

electron/main/mcp-ipc.ts   GUI 侧 loopback 端点：接收委托、在权威库执行、落盘 + data:changed

scripts/build-mcp.mjs      打包纯 Node MCP 入口 → out/mcp/index.cjs（ELECTRON_RUN_AS_NODE 子进程用）
```

主进程 `electron/main/index.ts` 启动 `startMcpIpc()` 并把 endpoint 写进 GUI 锁；退出时停端点、释放锁。