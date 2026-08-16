import fs from 'fs'
import path from 'path'
import { resolveDataDir } from './data-location'

// 智能体能力暴露的权限白名单配置。
// 每个操作对应一个 key，本机用户可直接编辑数据目录下的 agent-mcp-config.json。
// MCP 只暴露"模拟 GUI 对待办项的操作"：创建/修改/查看/删除任务，其余（分类等）不提供。
// 只有 enabled 且 permission === true 的操作才会在 MCP tools/list 中暴露给智能体。

export const OPERATION_CATALOG = {
  'task:create': { label: '创建任务', default: true, danger: false },
  'task:read_list': { label: '查询任务列表', default: true, danger: false },
  'task:read_detail': { label: '查询任务详情', default: true, danger: false },
  'task:update_status': { label: '更新任务状态(todo/done)', default: true, danger: false },
  'task:update': { label: '更新任务内容', default: true, danger: true },
  'task:delete': { label: '删除任务', default: true, danger: true },
} as const

export type OperationKey = keyof typeof OPERATION_CATALOG

export interface MpcConfig {
  enabled: boolean
  graph: string
  maxWaitLockMs: number
  permissions: Record<OperationKey, boolean>
}

export const DEFAULT_CONFIG: MpcConfig = {
  enabled: true,
  graph: 'task',
  maxWaitLockMs: 2000,
  permissions: Object.fromEntries(
    Object.entries(OPERATION_CATALOG).map(([k, v]) => [k, v.default]),
  ) as Record<OperationKey, boolean>,
}

export function configPath(): string {
  return configFileForDataDir(resolveDataDir())
}

export function configFileForDataDir(dataDir: string): string {
  return path.join(dataDir, 'agent-mcp-config.json')
}

export function loadConfig(overrides?: { configFile?: string }): MpcConfig {
  const file = overrides?.configFile?.trim() || configPath()
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<MpcConfig>
    const merged: MpcConfig = {
      ...DEFAULT_CONFIG,
      ...raw,
      permissions: {
        ...DEFAULT_CONFIG.permissions,
        ...(raw.permissions ?? {}),
      },
    }
    // 过滤掉未知的操作 key
    for (const key of Object.keys(merged.permissions) as OperationKey[]) {
      if (!(key in OPERATION_CATALOG)) {
        delete merged.permissions[key]
      }
    }
    return merged
  } catch {
    // 配置缺失或无法解析时写一份默认配置并返回默认值
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
    } catch {
      /* 只读目录时忽略，仅返回默认 */
    }
    return { ...DEFAULT_CONFIG, permissions: { ...DEFAULT_CONFIG.permissions } }
  }
}

export function isAllowed(cfg: MpcConfig, op: OperationKey): boolean {
  return cfg.enabled && cfg.permissions[op] === true
}

export function allowedOperations(cfg: MpcConfig): OperationKey[] {
  return (Object.keys(OPERATION_CATALOG) as OperationKey[]).filter((k) => isAllowed(cfg, k))
}

// 把（部分）配置写入指定文件：合并默认值、过滤未知 key、落盘。
export function writeConfig(configFile: string, cfg: Partial<MpcConfig>): MpcConfig {
  const merged: MpcConfig = {
    ...DEFAULT_CONFIG,
    ...cfg,
    permissions: {
      ...DEFAULT_CONFIG.permissions,
      ...(cfg.permissions ?? {}),
    },
  }
  for (const key of Object.keys(merged.permissions) as OperationKey[]) {
    if (!(key in OPERATION_CATALOG)) {
      delete merged.permissions[key]
    }
  }
  try {
    fs.mkdirSync(path.dirname(configFile), { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify(merged, null, 2), 'utf-8')
  } catch {
    /* 只读目录时忽略写盘失败，仅返回合并结果 */
  }
  return merged
}
