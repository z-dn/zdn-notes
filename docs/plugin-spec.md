# ZDNotes 第三方插件开发规范

本文档面向第三方开发者，说明如何为 ZDNotes 开发一个能被平台识别、加载的插件（Agent 工具）。

插件是 ZDNotes 的**扩展单元**：装好后，其声明的工具会进入统一 MCP 工具注册表，智能体可在 AGENT 工具页对其逐个授权、调用。

---

## 1. 插件是什么

- 插件 = 放在数据目录 `<数据目录>/agent-tools/<pluginId>/` 下的一个目录，包含：
  - `ztool.json` — 插件清单（**必填**，平台靠它识别插件）
  - 入口 JS（默认 `index.js`，可用 `entry` 字段覆盖）
- 平台发现机制：扫描 `<数据目录>/agent-tools/` 下**含 `ztool.json`** 的目录，即视为插件。
- 插件入口导出 `{ tools: [...] }`，每个工具是一个 `{ name, description, inputSchema, run(ctx, args) }`。

> **信任模型：插件 = 任意代码。** 插件入口以完整 Node 模块加载（无沙箱、无依赖限制），
> 拥有与应用主进程相同的权限：可读写你的文件、执行程序、访问网络、调用 Electron API。
> **安装插件前务必确认来源可信**——安装时平台会弹窗警告。

**能做**：任何 Node.js 能做的事——`require` 任意 npm 包（依赖随插件分发）、`fs`/`net`/`child_process`、`require('electron')`、`fetch` 等。
**应用能力**：通过 `ctx.app(channel, ...args)` 调用 ZDNotes 的业务层（任务/分类/设置/图片/收件夹/工具箱等），与界面走同一套接口。
**便利设施**：`ctx.storage`（插件隔离 KV）、`ctx.log`、`ctx.dataDir`、`ctx.pluginId`。

---

## 2. 快速开始

开发插件有三种路径，按门槛从低到高任选其一。

### 路径 A：npm 包（推荐第三方，无需 clone 仓库）

`ztool` 已发布为独立 npm 包 **`zdn-agent-tool`**（不依赖 ZDNotes 平台代码）：

```bash
# 1. 生成脚手架（id 可选，默认取目录名）
npx zdn-agent-tool init ./my-plugin myplugin

# 2. 编辑 ztool.json 与 index.js（见第 4、5 节）

# 3. 如需依赖，先安装并打包（依赖会随 .ztool 分发）
cd my-plugin && npm install && cd ..
npx zdn-agent-tool build ./my-plugin -o ./myplugin.ztool

# 4. 安装到数据目录（默认自动定位；也可显式传 dataDir）
npx zdn-agent-tool install ./myplugin.ztool

# 5. 确认安装
npx zdn-agent-tool list
```

> 数据目录自动定位：读取 `data-location.json`（自定义存储位置）或回退到默认 `%APPDATA%/zdn-notes`。

### 路径 B：纯手工 zip（不需要 Node/npm）

`.ztool` 本质就是 **zip** 文件：
1. 按第 3～5 节手写 `ztool.json` 与入口 JS
2. 把整个插件目录压缩为 zip
3. 改扩展名为 `.ztool`
4. 在 ZDNotes「AGENT 工具 → 插件 → 安装插件」选中该文件（会弹运行任意代码警告）

### 路径 C：目录复制（最简，连打包都不需要）

直接把插件目录复制到 `<数据目录>/agent-tools/<id>/` 下即可生效。GUI 运行中会自动**热重载**，无需重启。

---

## 3. 目录结构

```
<数据目录>/agent-tools/
  myplugin/                ← 目录名必须等于 ztool.json 的 id
    ztool.json             ← 清单（必填）
    index.js               ← 入口（默认；entry 字段可指向别的文件）
    package.json           ← 可选：npm 依赖清单（打包前需 npm install）
    node_modules/          ← 可选：依赖目录（随 .ztool 分发，安装即自包含）
    lib/                   ← 插件内的相对模块（可被 require）
    storage.json           ← 平台自动生成（插件 KV 存储，勿手动编辑）
```

> **依赖分发（VS Code 风格）**：插件的 `node_modules` 由插件作者在打包前 `npm install` 生成，
> 随 `.ztool` 一起打包分发。安装后即自包含，**无需网络、无需本机 npm**。
> 依赖解析从插件目录正常进行，`require('mysql2')` 等直接可用。

---

## 4. ztool.json 清单规范

```jsonc
{
  "id": "myplugin",       // 必填。^[a-zA-Z0-9_-]{1,64}$，且必须等于目录名
  "name": "我的插件",      // 可选，展示名；缺省取 id
  "version": "1.0.0",      // 可选，版本号
  "apiVersion": 1,         // 必填。当前平台版本 = 1，不匹配则拒绝加载
  "entry": "index.js",     // 可选，入口文件；默认 "index.js"
  "author": "me@example.com",  // 可选
  "description": "描述插件做什么", // 可选
  "builtin": false         // 保留给平台内置插件，第三方不要设置
}
```

字段规则：

| 字段 | 必填 | 规则 |
|------|------|------|
| `id` | ✅ | `^[a-zA-Z0-9_-]{1,64}$`；目录名必须等于它；全局唯一 |
| `apiVersion` | ✅ | 必须 `=== 1`（当前平台版本）；不符则整个插件拒绝加载 |
| `entry` | 否 | 默认 `index.js`；必须是插件目录内的相对路径 |
| `name`/`version`/`author`/`description` | 否 | 元信息，用于管理页展示 |

---

## 5. 入口 JS 规范（怎么写才被认作插件）

入口是 CommonJS 模块，必须导出 `{ tools: [...] }`：

```js
module.exports = {
  tools: [
    {
      key: 'myplugin:hello',     // 白名单粒度 key，全局唯一（见下）
      name: 'myplugin_hello',    // MCP 工具名（tools/list 暴露给智能体的名字）
      label: '打个招呼',          // 管理页显示名（可选，缺省用 name）
      description: '回显一条消息，演示插件工具的最简结构',
      inputSchema: {             // JSON Schema，描述参数
        type: 'object',
        properties: {
          msg: { type: 'string', description: '要回显的消息' },
        },
        required: ['msg'],
      },
      run: async (ctx, args) => {
        return { ok: true, echo: args.msg }
      },
    },
  ],
}
```

### 工具字段

| 字段 | 必填 | 说明 |
|------|------|------|
| `name` | ✅ | MCP 工具名；`tools/list` 暴露名；建议用插件 id 作前缀避免冲突 |
| `description` | ✅ | 给智能体的描述，决定模型何时调用该工具 |
| `inputSchema` | ✅ | JSON Schema（`type: 'object'` + `properties`）；用于参数校验与模型理解 |
| `key` | 否 | 白名单粒度 key；缺省自动规范为 `<pluginId>.<name>`；**全局唯一**，重复会导致加载失败 |
| `label` | 否 | 管理页显示名；缺省 `${pluginName}: ${name}` |
| `readonly` | 否 | 只读标记（只读工具不落盘、走缓存） |
| `danger` | 否 | 高危标记，管理页显示警示 |
| `run(ctx, args)` | ✅ | 执行函数；**返回值必须可 JSON 序列化**（会进 MCP `tools/call` 响应） |

> **工具 key 唯一性**：`key` 同时用作 `agent-mcp-config.json` 权限白名单的键。同名的 key 无法共存——包括与其他插件冲突。

---

## 6. 运行上下文 ctx 与应用能力

`run(ctx, args)` 的第一个参数 `ctx` 类型为 `PluginToolContext`：

| 字段 | 说明 |
|------|------|
| `ctx.dataDir` | 数据目录路径（只读） |
| `ctx.pluginId` | 当前插件 id |
| `ctx.storage` | 插件专属 KV 存储，持久化到 `storage.json`；按插件 id 隔离 |
| `ctx.log(level, msg)` | 日志；`level` ∈ `debug\|info\|warn\|error`；写 stderr（不污染 MCP 协议流） |
| `ctx.app(channel, ...args)` | 调用 ZDNotes 应用业务层（见下） |

### storage（插件 KV 存储）

```js
ctx.storage.set('counter', 1)            // 写
ctx.storage.get('counter')               // 读 → 1
ctx.storage.keys()                       // ['counter']
ctx.storage.delete('counter')            // 删
ctx.storage.clear()                      // 清空
```

数据按插件隔离，落盘在插件目录下的 `storage.json`。

### ctx.app（应用业务层）

`ctx.app(channel, ...args)` 调用 ZDNotes 的统一业务层（`AppService`），**与 UI 走同一套接口**。
GUI 运行时经 GUI-IPC 委托在主进程执行（GUI 是权威单写者）；**GUI 不在时调用会抛错**。

```js
const tasks = await ctx.app('task:getAll', [])          // 全部任务
await ctx.app('task:create', [{ title: '新任务' }])      // 建任务
const settings = await ctx.app('settings:getAll', [])    // 全部设置
await ctx.app('settings:set', ['theme', 'dark'])         // 写设置
const categories = await ctx.app('category:getAll', [])  // 全部分类
const counts = await ctx.app('category:getTaskCounts', [])
const inbox = await ctx.app('inbox:getDir', [])          // 收件夹路径
const version = await ctx.app('app:getVersion', [])      // 版本号
```

可用通道与 IPC 一致（`domain:action` 形式），数据通道均已接入业务层；对话框/窗口控制等
UI 专属通道不在其中（如 `window:*`、`db:export`、`image:pickAndSave`）。

> **无权限模型**：插件全权信任，`ctx.app` 不设白名单，全部数据通道可调。
> 限制的是"**智能体能否调用某个工具**"（AGENT 工具页按工具勾选，写入 `agent-mcp-config.json`），
> 与插件自身能力无关。

---

## 7. 信任模型与安全边界

**插件入口以完整 Node 模块直接加载（无 vm 沙箱、无 require 白名单、无能力门控）。**

| 说明 | 细节 |
|------|------|
| 权限 | 与应用主进程相同：读任意文件、执行进程、访问网络、`require('electron')` 操作应用 |
| 依赖 | 任意 npm 包，`node_modules` 随插件目录分发（打包前 `npm install`） |
| 隔离 | 插件运行在**独立 MCP 进程**（不进入主进程），卡死/崩溃不影响应用本体 |
| 加载 | 热重载支持：目录变化自动重载；`require` 缓存按插件目录清理 |
| 日志 | 加载期与 stdio 进程的 `console.log/warn` 均重定向到 stderr，保护 MCP 协议流；`ctx.log` 始终写 stderr |
| 安装 | GUI 与 CLI 均提示"安装插件 = 运行任意代码（与应用同权限）" |

> **风险自担**：这是 Obsidian / VS Code 插件的信任模型。仅安装你信任来源的插件。

---

## 8. 打包与发布

```bash
# 校验清单 + 打包（zip 格式，内含 ztool.json + 入口 + node_modules + 资源）
npx zdn-agent-tool build ./my-plugin -o ./myplugin.ztool

# 安装（GUI 运行中热重载）
npx zdn-agent-tool install ./myplugin.ztool
```

- `.ztool` 本质是 zip；安装时平台**逐条目校验**，含 `..`/越界路径的包会被拒绝（防 zip-slip）。
- 有 `package.json` 时 `build` 会**自动安装**生产依赖（`npm install --omit=dev`），无需手动操作。依赖务必打进包内（VS Code 风格）。
- 平台兼容版本看 `apiVersion`：`ztool.json` 的 `apiVersion` 必须等于当前平台的 `PLUGIN_API_VERSION`（当前 `1`）。跨大版本升级平台时，旧 `apiVersion` 的插件会被拒绝加载并提示。
- 发布前务必用 `ztool build` 自检；也可装到本机用 `ztool list` 确认被识别。

---

## 9. 常见「平台不认」原因排查

| 现象 | 原因 |
|------|------|
| 管理页看不到插件 | 目录下没有 `ztool.json`；或目录名 ≠ 清单 `id`；或目录不在 `<数据目录>/agent-tools/` |
| 加载失败：缺少 id | `ztool.json` 未声明 `id` |
| 加载失败：id 非法 | `id` 含非法字符（仅允许字母/数字/下划线/连字符，最长 64） |
| 加载失败：apiVersion 不符 | `apiVersion` 不是当前平台版本 |
| 加载失败：入口不存在 | `entry` 指向的文件缺失 |
| 加载失败：工具 key 冲突 | 两个工具 `key` 相同（含与其他插件冲突） |
| 加载失败：Cannot find module | 插件依赖未安装——在插件目录运行 `npm install` 后重启应用；`ztool build` 会自动安装生产依赖 |
| 工具不显示在 `tools/list` | 白名单未授权（AGENT 工具页勾选「授权智能体使用」）；或 MCP 总开关关闭 |
| 智能体调用报错 | 插件 `run` 抛异常；返回值不可 JSON 序列化 |
| `ctx.app` 调用报错 | GUI 未在运行（应用未启动）——`ctx.app` 仅在 GUI 运行时可用，可改用 Node 原生能力 |

---

## 10. 完整示例：一个能连数据库的插件

插件是完整 Node 模块，连接任何外部数据库只需 `require` 对应驱动（如 `mysql2`），
**平台一行代码都不用写**。下面演示同时使用 Node 依赖、HTTP 请求与 `ctx.app`。

```
<数据目录>/agent-tools/weather/
  ztool.json
  package.json        ← {"dependencies": { "mysql2": "^3" }}
  node_modules/       ← npm install 生成，随 .ztool 分发
  index.js
```

**ztool.json**

```json
{
  "id": "weather",
  "name": "天气助手",
  "version": "1.0.0",
  "apiVersion": 1,
  "entry": "index.js",
  "author": "plugin-author",
  "description": "查询天气、写入外部 MySQL，并统计应用任务数"
}
```

**index.js**

```js
const mysql = require('mysql2/promise')
const https = require('https')

// 简单 HTTP GET（也可直接 require 任意 HTTP 库）
function httpGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let body = ''
      res.setEncoding('utf-8')
      res.on('data', (c) => (body += c))
      res.on('end', () => resolve(body))
    }).on('error', reject)
  })
}

module.exports = {
  tools: [
    {
      key: 'weather:forecast',
      name: 'weather_forecast',
      label: '查询天气',
      description: '按城市查询天气（演示 Node 原生 HTTP）',
      inputSchema: {
        type: 'object',
        properties: { city: { type: 'string', description: '城市名' } },
        required: ['city'],
      },
      run: async (ctx, args) => {
        const body = await httpGet(`https://wttr.in/${encodeURIComponent(args.city)}?format=j1`)
        ctx.storage.set('lastCity', args.city)
        return { ok: true, preview: body.slice(0, 500) }
      },
    },
    {
      key: 'weather:writeDb',
      name: 'weather_write_db',
      label: '写入外部数据库',
      description: '把最近查询写入外部 MySQL（演示 require 任意 npm 依赖）',
      inputSchema: {
        type: 'object',
        properties: {
          host: { type: 'string' },
          user: { type: 'string' },
          password: { type: 'string' },
          database: { type: 'string' },
        },
        required: ['host', 'user', 'database'],
      },
      run: async (ctx, args) => {
        const conn = await mysql.createConnection({
          host: args.host,
          user: args.user,
          password: args.password ?? '',
          database: args.database,
        })
        const city = ctx.storage.get('lastCity') ?? 'unknown'
        await conn.execute('INSERT INTO weather_log (city, ts) VALUES (?, ?)', [
          city,
          Date.now(),
        ])
        await conn.end()
        return { ok: true, wrote: city }
      },
    },
    {
      key: 'weather:taskCount',
      name: 'weather_task_count',
      label: '当前任务数',
      description: '通过 ctx.app 读取应用任务总数（与 UI 同一业务层）',
      inputSchema: { type: 'object', properties: {} },
      run: async (ctx) => {
        if (!ctx.app) return { ok: false, error: 'ctx.app 仅在 GUI 运行时可用' }
        const tasks = await ctx.app('task:getAll', [])
        return { ok: true, count: Array.isArray(tasks) ? tasks.length : 0 }
      },
    },
  ],
}
```

安装后：`npm install` → `npx zdn-agent-tool build ./weather -o ./weather.ztool` →
`npx zdn-agent-tool install ./weather.ztool`，在 ZDNotes「AGENT 工具」页即可看到「天气助手」插件卡，逐工具勾选授权。

---

## 附：开发检查清单

- [ ] 目录名 = `id`，且匹配 `^[a-zA-Z0-9_-]{1,64}$`
- [ ] `ztool.json` 含 `id`、`apiVersion`（= 1）
- [ ] 每个工具含 `name`、`description`、`inputSchema`、`run`
- [ ] 工具 `key` 全局唯一
- [ ] 有 npm 依赖时：`ztool build` 自动安装生产依赖（`--omit=dev`），`node_modules` 随 `.ztool` 分发
- [ ] `run` 返回可 JSON 序列化的值
- [ ] 用 `ctx.log` 记日志（避免 `console.log` 污染 MCP 协议流）
- [ ] `ztool build` 通过，装到本机能被 `ztool list` 识别
- [ ] 仅分发你信任的代码——用户安装即赋予与 ZDNotes 相同的权限