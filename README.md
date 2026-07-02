# ZDNotes

一个基于 Electron 的本地笔记与任务管理应用，支持自然语言快速输入。

## 功能

- **快速任务输入** — 使用自然语言解析，一行输入即可设置标题、优先级、标签、项目和截止时间
- **优先级标记** — `P0` ~ `P3` 或 `!!!` `!!` `!` 快捷标记
- **标签 & 项目** — `#标签` `@项目名` 自动归类
- **日期解析** — 支持中文/英文日期（chrono-node），如"下周一""明天下午3点"
- **分类管理** — 侧边栏分类筛选与管理
- **子任务** — 支持任务层级嵌套
- **任务排序** — 基于 Lexorank 算法的拖拽排序
- **Markdown 导出** — 一键导出全部任务为 Markdown 文件
- **本地存储** — 基于 SQL.js (SQLite) 的本地数据库
- **自动更新** — 支持通过 GitHub Releases 自动更新

## 技术栈

| 层 | 技术 |
|------|------|
| 框架 | Electron + electron-vite |
| 前端 | React 19 + TypeScript |
| 样式 | Tailwind CSS 4 |
| 状态管理 | Zustand |
| 数据库 | SQL.js (SQLite WASM) |
| 日期解析 | chrono-node |
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

## 自然语言输入示例

```
买牛奶 #购物 @家庭 !! 明天下午3点
发布 v2.0 #开发 @工作 P0 下周一
整理照片 #个人 这周六
```
