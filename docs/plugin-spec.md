# ZDNotes 第三方插件开发规范

本文档面向第三方开发者，说明如何为 ZDNotes 开发一个能被平台识别、加载的插件（Agent 工具）。

插件是 ZDNotes 的**扩展单元**：装好后，其声明的工具会进入统一 MCP 工具注册表，智能体可在 AGENT 工具页对其逐个授权、调用。

---

## 1. 插件是什么

- 插件 = 放在数据目录 `<数据目录>/agent-tools/<pluginId>/` 下的一个目录，包含：
  - `ztool.json` — 插件清单（**必填**，平台靠它识别插件）
  - 入口 JS（默认 `index.js`，可用 `entry` 字段覆盖）
- 平台发现机制：扫描 `<数据目录>/agent-tools/` 下**含 `ztool.json`** 的目录，即视为插件。
- 插件工具的 `run(ctx, args)` 在受限 VM 沙箱中执行，只能通过 `ctx` 拿到平台注入的**授权能力**。

**能做**：通过能力做 HTTP 请求、调用桌面白名单通道、使用插件专属 KV 存储、写日志；返回任意可 JSON 序列化的结果给智能体。

**不能做**：直接访问数据库、调用 Electron API、`require` 非白名单模块、访问插件目录以外的文件。

---

## 2. 快速开始

开发插件有三种路径，按门槛从低到高任选其一。

### 路径 A：npm 包（推荐第三方，无需 clone 仓库）

`ztool` 已发布为独立 npm 包 **`zdn-agent-tool`**（不依赖 ZDNotes 平台代码）：

```bash
# 1. 生成脚手架（id 可选，默认取目录名）
npx zdn-agent-tool init ./my-plugin myplugin

# 2. 编辑 ztool.json 与 index.js（见第 4、5 节）

# 3. 校验并打包为 .ztool
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
4. 在 ZDNotes「AGENT 工具 → 插件 → 安装插件」选中该文件即可

### 路径 C：目录复制（最简，连打包都不需要）

直接把插件目录复制到 `<数据目录>/agent-tools/<id>/` 下即可生效。GUI 运行中会自动**热重载**，无需重启。

---

> **零依赖**：插件是纯 CommonJS 脚本，**不需要引入任何 npm 包**。运行时所需的 `httpRequest`、`desktop`、`storage`、`log` 全部由平台通过 `ctx` 注入。

---

## 3. 目录结构

```
<数据目录>/agent-tools/
  myplugin/                ← 目录名必须等于 ztool.json 的 id
    ztool.json             ← 清单（必填）
    index.js               ← 入口（默认；entry 字段可指向别的文件）
    storage.json           ← 平台自动生成（插件 KV 存储，勿手动编辑）
    lib/                   ← 插件内的相对模块（可被 require，见第 7 节）
```

---

## 4. ztool.json 清单规范

```jsonc
{
  "id": "myplugin",                    // 必填。^[a-zA-Z0-9_-]{1,64}$，且必须等于目录名
  "name": "我的插件",                   // 可选，展示名；缺省取 id
  "version": "1.0.0",                  // 可选，版本号
  "apiVersion": 1,                     // 必填。当前平台版本 = 1，不匹配则拒绝加载
  "entry": "index.js",                 // 可选，入口文件；默认 "index.js"
  "permissions": ["http:request"],     // 能力白名单（见第 6 节）
  "author": "me@example.com",          // 可选
  "description": "描述插件做什么",       // 可选
  "builtin": false                     // 保留给平台内置插件，第三方不要设置
}
```

字段规则：

| 字段 | 必填 | 规则 |
|------|------|------|
| `id` | ✅ | `^[a-zA-Z0-9_-]{1,64}$`；目录名必须等于它；全局唯一 |
| `apiVersion` | ✅ | 必须 `=== 1`（当前平台版本）；不符则整个插件拒绝加载 |
| `permissions` | 否 | 字符串数组，声明需要的**能力**；未声明则对应能力不会注入 ctx |
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
        // 业务逻辑（沙箱内），通过 ctx 使用能力
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

## 6. run 上下文 ctx 与能力

`run(ctx, args)` 的第一个参数 `ctx` 类型为 `PluginToolContext`：

| 字段 | 说明 |
|------|------|
| `ctx.dataDir` | 数据目录路径（只读） |
| `ctx.pluginId` | 当前插件 id |
| `ctx.storage` | 插件专属 KV 存储，持久化到 `storage.json`；按插件 id 隔离 |
| `ctx.log(level, msg)` | 日志；`level` ∈ `debug\|info\|warn\|error` |
| `ctx.httpRequest(config)` | **能力**：HTTP 请求（需 `permissions` 含 `'http:request'`） |
| `ctx.desktop(channel, ...args)` | **能力**：调用桌面白名单通道（需 `permissions` 含 `'desktop'`） |

### storage（插件 KV 存储）

```js
ctx.storage.set('counter', 1)            // 写
ctx.storage.get('counter')               // 读 → 1
ctx.storage.keys()                       // ['counter']
ctx.storage.delete('counter')            // 删
ctx.storage.clear()                      // 清空
```

数据按插件隔离，落盘在插件目录下的 `storage.json`。

### httpRequest（能力：HTTP 请求）

`ztool.json` 声明 `"permissions": ["http:request"]` 后，`ctx.httpRequest` 可用：

```js
const res = await ctx.httpRequest({
  method: 'GET',                                  // GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS
  url: 'https://api.example.com/ping',
  headers: [{ key: 'Accept', value: 'application/json' }],
  body: '',                                       // 非 GET/HEAD 时的请求体
})
// res: { ok, status, statusText, headers, body, timeMs, size } 或 { ok:false, error }
```

安全说明：默认**禁止访问内网/本机地址**；用户需在设置开启「允许接口调试访问内网/本机地址」才会放行。

### desktop（能力：桌面 API）

`ztool.json` 声明 `"permissions": ["desktop"]` 后，`ctx.desktop` 可用。可调用的通道是**平台白名单**（`electron/main/desktop-bridge.ts`），当前包含：

- 只读：`settings:getAll`、`task:getAll`、`task:getById`、`category:getAll`、`tool:getAll`
- 写：`settings:set`

```js
const tasks = await ctx.desktop('task:getAll', [])
```

非白名单通道会抛错。`desktop` 能力只在 GUI 运行时注入；独立 MCP 进程（GUI 未启动）下不可用。

---

## 7. 沙箱与安全约束

插件入口在 Node `vm` 受限沙箱中执行，边界如下：

| 约束 | 说明 |
|------|------|
| `require` 白名单 | 仅 `fs path url util assert crypto os http https stream buffer` + **插件目录内**的相对/绝对模块；其余抛「不允许 require 非白名单模块」 |
| 无 db | 插件拿不到数据库访问，唯一数据出口是 `ctx` 能力 |
| 无 Electron | 沙箱内没有 `electron`、`process`（系统全局）、`Buffer` 等主进程能力 |
| 入口超时 | 入口**同步**执行限时 3 秒，超时即加载失败（异步 `run` 不受此限） |
| 目录越界 | `require` 与安装解压均拒绝 `..` 越界路径 |

---

## 8. 打包与发布

```bash
# 校验清单 + 打包（zip 格式，内含 ztool.json + 入口 + 资源）
npx zdn-agent-tool build ./my-plugin -o ./myplugin.ztool

# 安装（GUI 运行中热重载）
npx zdn-agent-tool install ./myplugin.ztool
```

- `.ztool` 本质是 zip；安装时平台**逐条目校验**，含 `..`/越界路径的包会被拒绝（防 zip-slip）。
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
| 加载失败：不允许 require | 入口 `require` 了白名单外的模块 |
| 加载失败：入口执行超时 | 入口同步代码耗时超过 3s |
| 加载失败：工具 key 冲突 | 两个工具 `key` 相同（含与其他插件冲突） |
| 工具不显示在 `tools/list` | 白名单未授权（AGENT 工具页勾选「授权智能体使用」）；或 MCP 总开关关闭 |
| 智能体调用报无此能力 | `permissions` 未声明对应能力（如未写 `http:request` 就用 `ctx.httpRequest`） |

---

## 10. 完整示例：一个双能力插件

同时声明 `http:request` 与 `desktop` 能力的完整插件，可直接运行：

```
<数据目录>/agent-tools/weather/
  ztool.json
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
  "description": "查询天气并保存到插件存储",
  "permissions": ["http:request", "desktop"]
}
```

**index.js**

```js
module.exports = {
  tools: [
    {
      key: 'weather:forecast',
      name: 'weather_forecast',
      label: '查询天气',
      description: '按城市查询天气（演示 http:request 能力）',
      inputSchema: {
        type: 'object',
        properties: {
          city: { type: 'string', description: '城市名' },
        },
        required: ['city'],
      },
      run: async (ctx, args) => {
        if (!ctx.httpRequest) return { ok: false, error: '缺少 http:request 能力' }
        const res = await ctx.httpRequest({
          method: 'GET',
          url: `https://wttr.in/${encodeURIComponent(args.city)}?format=j1`,
        })
        ctx.storage.set('lastCity', args.city)
        return { ok: res.ok, status: res.status, body: res.body }
      },
    },
    {
      key: 'weather:lastCity',
      name: 'weather_last_city',
      label: '上次查询的城市',
      description: '读取插件存储里上次查询的城市（演示 storage）',
      inputSchema: { type: 'object', properties: {} },
      run: async (ctx) => ({ ok: true, city: ctx.storage.get('lastCity') ?? null }),
    },
    {
      key: 'weather:taskCount',
      name: 'weather_task_count',
      label: '当前任务数',
      description: '通过桌面能力读取任务总数（演示 desktop）',
      inputSchema: { type: 'object', properties: {} },
      run: async (ctx) => {
        if (!ctx.desktop) return { ok: false, error: 'desktop 能力仅在 GUI 运行时可用' }
        const tasks = await ctx.desktop('task:getAll', [])
        return { ok: true, count: Array.isArray(tasks) ? tasks.length : 0 }
      },
    },
  ],
}
```

安装后：`npx zdn-agent-tool build ./weather -o ./weather.ztool` → `npx zdn-agent-tool install ./weather.ztool`，在 ZDNotes「AGENT 工具」页即可看到「天气助手」插件卡，逐工具勾选授权。

---

## 附：开发检查清单

- [ ] 目录名 = `id`，且匹配 `^[a-zA-Z0-9_-]{1,64}$`
- [ ] `ztool.json` 含 `id`、`apiVersion`（= 1）
- [ ] 每个工具含 `name`、`description`、`inputSchema`、`run`
- [ ] 工具 `key` 全局唯一
- [ ] 用到 `ctx.httpRequest`/`ctx.desktop` 时，`permissions` 已声明对应能力
- [ ] `run` 返回可 JSON 序列化的值
- [ ] 未 `require` 白名单以外的模块
- [ ] `ztool build` 通过，装到本机能被 `ztool list` 识别
