# Agent 工具使用指南

ZDNotes 内置一个 **MCP（Model Context Protocol）Server**，让支持 MCP 的智能体
（OpenCode / DSH / Codex / Qoder 等）直接读写 ZDNotes 的待办任务数据——创建任务、
查询列表、查看详情、修改状态与内容、删除任务，全程走本地优先的 stdio 模式。

本文档以 **OpenCode** 为例说明如何配置与使用。其它智能体配置方式相同，只是各自的
MCP 配置入口不同。

## 一、前置准备

1. **安装 ZDNotes** 并至少启动过一次（生成数据目录）。
2. **启用 MCP**：打开应用 →「设置 → AI 智能体」，打开「启用 MCP」总开关，并按需
   勾选允许智能体使用的工具（默认全开）。
   - 也可以在数据目录下手动编辑 `agent-mcp-config.json`，两者等效。

## 二、在 OpenCode 中配置

OpenCode 通过项目根目录的 `opencode.json`（或全局配置）的 `mcp` 段声明 MCP Server。

### 方式一：打包版（推荐，无需 Node 环境）

装好 ZDNotes 后，把 server 指向安装目录的 `ZDNotes.exe`：

```json
{
  "mcp": {
    "zdn-notes": {
      "type": "stdio",
      "command": "C:\\Users\\<你的用户名>\\AppData\\Local\\Programs\\zdn-notes\\ZDNotes.exe",
      "args": ["--zdn-mcp-stdio"],
      "enabled": true
    }
  }
}
```

> 默认每用户安装路径为 `%LOCALAPPDATA%\Programs\zdn-notes\ZDNotes.exe`。

### 方式二：开发/源码版（改动即时生效）

克隆仓库后用 tsx 直跑 MCP 入口：

```json
{
  "mcp": {
    "zdn-notes": {
      "type": "stdio",
      "command": "npx",
      "args": ["tsx", "<仓库路径>/electron/mcp/index.ts", "--stdio"],
      "cwd": "<仓库路径>",
      "enabled": true
    }
  }
}
```

配置保存后重启 OpenCode（或触发其重新加载 MCP）即可生效。

## 三、使用示例

配置完成后，直接在对话里让智能体操作任务即可：

```
帮我把「周五前写完周报」创建为一条任务，优先级 P1，标签：工作
列出我当前所有待办任务
把任务「买牛奶」标记为已完成
```

智能体将通过 MCP 调用 ZDNotes 的工具完成操作；数据落在 ZDNotes 自身数据库里，
打开应用即可看到。应用运行期间，所有写入都会实时同步到界面。

## 四、权限控制

智能体只能调用**授权开关已勾选**的工具（不勾选的工具不会出现在 MCP 的
`tools/list` 里，智能体看不到也无权调用）。可用工具：

| 工具 | 说明 |
|------|------|
| 创建任务 | 新增一条待办任务 |
| 查任务列表 | 按条件查询任务列表 |
| 查任务详情 | 查看单条任务详情 |
| 修改状态 | 标记 todo / done |
| 修改任务 | 编辑任务内容 |
| 删除任务 | 删除任务 |

## 五、常见问题

- **应用在跑时智能体写入安全吗？** 安全。MCP 检测到 ZDNotes 界面在跑时，会把调用
  转发给 GUI 主进程执行（单一写者），界面实时刷新；应用没开时才走文件锁直接读写。
- **改了权限配置后需要重启吗？** 应用在跑时**即时生效**；已连接的独立 MCP 进程需
  重启。
- **调用记录在哪看？** 应用「AGENT 工具 → 调用日志」可查看智能体每次调用的记录。
- **命令行验证**：不想用智能体时，可运行 `ZDNotes.exe --zdn-mcp-cli task list`
  直接命令行操作。