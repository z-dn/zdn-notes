# ZDNotes

一个基于 Electron 的本地笔记与任务管理桌面应用。

## 功能

- **快速任务输入** — 在输入框中直接输入标题即可创建任务
- **优先级标记** — `P0` ~ `P3` 优先级
- **标签 & 负责人** — `#标签` `@负责人`
- **分类管理** — 侧边栏分类筛选与管理
- **子任务** — 支持任务层级嵌套
- **任务排序** — 基于 Lexorank 算法的拖拽排序
- **Markdown 导出** — 一键导出全部任务为 Markdown 文件
- **本地存储** — 基于 SQL.js (SQLite) 的本地数据库
- **自动更新** — 支持通过 GitHub Releases 自动更新

> 说明：自然语言解析（chrono-node）曾作为功能引入，因容易出现误处理而将其移除，任务输入直接使用文本标题。

## 技术栈

| 层 | 技术 |
|------|------|
| 框架 | Electron + electron-vite |
| 前端 | React 19 + TypeScript |
| 样式 | Tailwind CSS 4 |
| 状态管理 | Zustand |
| 数据库 | SQL.js (SQLite WASM) |
| 构建 | electron-builder (NSIS) |

## 开发

```bash
# 安装依赖
npm install

# 启动开发环境
npm run dev

# 运行测试
npm test

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

## 构建

```bash
# 打包为可分发安装包
npm run dist
```

输出文件位于 `release/` 目录。
