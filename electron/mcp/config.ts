import fs from 'fs'
import path from 'path'
import { resolveDataDir } from './data-location'

// 智能体能力暴露的权限白名单配置。
// 每个操作对应一个 key（= AgentTool.key），本机用户可直接编辑数据目录下的
// agent-mcp-config.json。MCP 只暴露 enabled 且 permission === true 的工具。
//
// 白名单目录来源：P2 起由 ToolRegistry 派生（内置 + 插件工具统一注册），
// 这里保留 OPERATION_CATALOG 作为"内置默认目录"，供无注册表场景（CLI/测试）使用。

export interface OperationMeta {
  label: string
  default: boolean
  danger: boolean
}

/** 内置默认目录（向后兼容；正式运行由 registry.toCatalog() 派生完整目录） */
export const OPERATION_CATALOG: Record<string, OperationMeta> = {
  'task:create': { label: '创建任务', default: true, danger: false },
  'task:read_list': { label: '查询任务列表', default: true, danger: false },
  'task:read_detail': { label: '查询任务详情', default: true, danger: false },
  'task:update_status': { label: '更新任务状态(todo/done)', default: true, danger: false },
  'task:update': { label: '更新任务内容', default: true, danger: true },
  'task:delete': { label: '删除任务', default: true, danger: true },
}

export type OperationKey = string

export interface MpcConfig {
  enabled: boolean
  graph: string
  maxWaitLockMs: number
  permissions: Record<string, boolean>
}

/** 由目录生成默认 permissions */
export function defaultPermissions(catalog: Record<string, OperationMeta> = OPERATION_CATALOG): Record<string, boolean> {
  return Object.fromEntries(Object.entries(catalog).map(([k, v]) => [k, v.default]))
}

export function defaultConfig(catalog: Record<string, OperationMeta> = OPERATION_CATALOG): MpcConfig {
  return {
    enabled: true,
    graph: 'task',
    maxWaitLockMs: 2000,
    permissions: defaultPermissions(catalog),
  }
}

export const DEFAULT_CONFIG: MpcConfig = defaultConfig()

export function configPath(): string {
  return configFileForDataDir(resolveDataDir())
}

export function configFileForDataDir(dataDir: string): string {
  return path.join(dataDir, 'agent-mcp-config.json')
}

/** 过滤掉未知 key（仅保留目录中存在的 key） */
function filterUnknown(
  permissions: Record<string, boolean>,
  catalog: Record<string, OperationMeta>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {}
  for (const key of Object.keys(permissions)) {
    if (key in catalog) out[key] = permissions[key]
  }
  return out
}

export interface ConfigOverrides {
  configFile?: string
  catalog?: Record<string, OperationMeta>
}

export function loadConfig(overrides?: ConfigOverrides): MpcConfig {
  const file = overrides?.configFile?.trim() || configPath()
  const catalog = overrides?.catalog ?? OPERATION_CATALOG
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Partial<MpcConfig>
    const merged: MpcConfig = {
      ...defaultConfig(catalog),
      ...raw,
      permissions: {
        ...defaultPermissions(catalog),
        ...(raw.permissions ?? {}),
      },
    }
    merged.permissions = filterUnknown(merged.permissions, catalog)
    return merged
  } catch {
    // 配置缺失或无法解析时写一份默认配置并返回默认值
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(defaultConfig(catalog), null, 2), 'utf-8')
    } catch {
      /* 只读目录时忽略，仅返回默认 */
    }
    return defaultConfig(catalog)
  }
}

export function isAllowed(cfg: MpcConfig, op: string): boolean {
  return cfg.enabled && cfg.permissions[op] === true
}

export function allowedOperations(cfg: MpcConfig, catalog: Record<string, OperationMeta> = OPERATION_CATALOG): string[] {
  return Object.keys(catalog).filter((k) => isAllowed(cfg, k))
}

// 把（部分）配置写入指定文件：合并默认值、过滤未知 key、落盘。
export function writeConfig(
  configFile: string,
  cfg: Partial<MpcConfig>,
  catalog?: Record<string, OperationMeta>,
): MpcConfig {
  const catalogResolved = catalog ?? OPERATION_CATALOG
  const merged: MpcConfig = {
    ...defaultConfig(catalogResolved),
    ...cfg,
    permissions: {
      ...defaultPermissions(catalogResolved),
      ...(cfg.permissions ?? {}),
    },
  }
  merged.permissions = filterUnknown(merged.permissions, catalogResolved)
  try {
    fs.mkdirSync(path.dirname(configFile), { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify(merged, null, 2), 'utf-8')
  } catch {
    /* 只读目录时忽略写盘失败，仅返回合并结果 */
  }
  return merged
}