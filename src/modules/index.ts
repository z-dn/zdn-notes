import { Settings } from 'lucide-react'
import type { ComponentType } from 'react'

// ===================================================================
// 渲染层模块注册表。
// 主进程 FeatureModule 声明 renderer.view / renderer.settingsSections，
// 渲染层以同构结构声明具体组件。App.tsx 侧边栏 tab 与设置弹窗小节
// 都从这里读取，新增模块只需在 src/modules 增加声明。
// ===================================================================

export interface RendererView {
  id: string
  label: string
  icon?: ComponentType<{ className?: string }>
}

export interface SettingsSection {
  id: string
  title: string
  /** 渲染函数返回该小节 JSX；统一在设置弹窗内渲染 */
  render: () => React.ReactNode
}

export interface RendererModule {
  id: string
  views: RendererView[]
  settingsSections: SettingsSection[]
}

// ---- 内置渲染层模块 ----
// 侧边栏 tab 与设置小节目前仍是 App.tsx / settings-dialog.tsx 内的静态 JSX，
// 这里先登记元信息；后续 P4 再逐步把每个小节拆成独立 render 函数注册进来。

import { views as taskViews } from './tasks'
import { views as toolboxViews } from './toolbox'
import { views as mcpViews } from './mcp'
import { views as dshViews } from './dsh'

export const RENDERER_MODULES: RendererModule[] = [
  { id: 'tasks', views: taskViews, settingsSections: [] },
  { id: 'toolbox', views: toolboxViews, settingsSections: [] },
  { id: 'mcp', views: mcpViews, settingsSections: [] },
  { id: 'dsh', views: dshViews, settingsSections: [] },
  { id: 'settings', views: [], settingsSections: [] },
]

export function collectViews(): RendererView[] {
  return RENDERER_MODULES.flatMap((m) => m.views)
}

export function collectSettingsSections(): SettingsSection[] {
  return RENDERER_MODULES.flatMap((m) => m.settingsSections)
}

export { Settings }