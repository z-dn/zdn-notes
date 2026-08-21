// ===================================================================
// 平台功能开关（feature flags）。
// 模块（FeatureModule）默认 enabled，可被设置项按模块 id 关闭。
// 标志持久化在 settings 表（key: `module.<id>` = 'true'/'false'）。
// 渲染层通过 useFeature(id) 判断某域是否可用（P1）。
// ===================================================================

export interface FeatureFlagDef {
  id: string
  label: string
  description?: string
  kind: 'core' | 'optional'
  defaultEnabled: boolean
}

export const FEATURE_FLAGS: FeatureFlagDef[] = [
  { id: 'tasks', label: '待办任务', kind: 'core', defaultEnabled: true },
  { id: 'categories', label: '分类', kind: 'core', defaultEnabled: true },
  { id: 'settings', label: '设置', kind: 'core', defaultEnabled: true },
  { id: 'images', label: '图片', kind: 'core', defaultEnabled: true },
  { id: 'backup', label: '备份恢复', kind: 'core', defaultEnabled: true },
  { id: 'dataLocation', label: '数据位置', kind: 'core', defaultEnabled: true },
  { id: 'inbox', label: '收件夹', kind: 'optional', defaultEnabled: true },
  { id: 'toolbox', label: '工具箱', kind: 'optional', defaultEnabled: true },
  { id: 'window', label: '窗口控制', kind: 'core', defaultEnabled: true },
  { id: 'updater', label: '自动更新', kind: 'optional', defaultEnabled: true },
  { id: 'mcp', label: 'AI 智能体（MCP）', kind: 'optional', defaultEnabled: true },
  { id: 'notifications', label: '任务提醒通知', kind: 'optional', defaultEnabled: true },
  { id: 'dsh', label: 'DeepSeek Harness', kind: 'optional', defaultEnabled: false },
  { id: 'app', label: '应用基础', kind: 'core', defaultEnabled: true },
]

export function flagSettingsKey(id: string): string {
  return `module.${id}`
}

export function defaultFlags(): Record<string, boolean> {
  return Object.fromEntries(FEATURE_FLAGS.map((f) => [f.id, f.defaultEnabled]))
}

/**
 * 从 settings 记录解析出各模块是否启用。
 * core 模块不可关闭（即使设置了也强制开）。
 */
export function resolveFlags(settings: Record<string, string>): Record<string, boolean> {
  const flags = defaultFlags()
  for (const f of FEATURE_FLAGS) {
    if (f.kind === 'core') {
      flags[f.id] = true
      continue
    }
    const raw = settings[flagSettingsKey(f.id)]
    if (raw !== undefined) flags[f.id] = raw !== 'false'
  }
  return flags
}

export function isEnabled(flags: Record<string, boolean>, id: string): boolean {
  return flags[id] !== false
}