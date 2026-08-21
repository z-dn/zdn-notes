import type { RendererView } from '../index'

// ===================================================================
// DSH 渲染层模块声明。侧边栏 tab / 主区域组件由 App.tsx 装配
// （与 toolbox / agent 一致），这里仅登记 view 元信息。
// ===================================================================

export const views: RendererView[] = [{ id: 'dsh', label: 'DSH' }]
