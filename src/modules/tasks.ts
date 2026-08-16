import type { RendererView } from './index'

// 待办任务模块的渲染层视图声明（对应主进程 tasks 模块）
export const views: RendererView[] = [
  { id: 'categories', label: '待办项' },
]