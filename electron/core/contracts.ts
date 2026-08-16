import type { Database } from 'sql.js'
import type { ToolRegistry } from './tool-registry'

// ===================================================================
// 平台契约（Platform Contracts）—— 纯 TS，无 Electron 依赖。
// 主进程、独立 MCP 进程、渲染层共用的模块/工具/能力类型定义。
// ===================================================================

// ---- Agent 工具（统一 MCP 单端点内的最小可插拔单元）----

/** 工具执行上下文（内置工具）：db 来自 GUI 权威库或 withDb 加载库 */
export interface BuiltinToolContext {
  kind: 'builtin'
  db: Database
  dataDir: string
  imagesDir?: string
  save?: () => void
}

/** 插件工具执行上下文（第三方插件）：无 db，只有被授权的能力 */
export interface PluginToolContext {
  kind: 'plugin'
  dataDir: string
  pluginId: string
  storage: PluginStorage
  log: (level: 'debug' | 'info' | 'warn' | 'error', msg: string) => void
  /** 能力：HTTP 请求（manifest.permissions 含 'http:request' 时提供） */
  httpRequest?: (config: HttpRequestConfig) => Promise<HttpRequestResult>
  /** 能力：桌面 API 调用（manifest.permissions 含 'desktop' 时提供，P4 扩展） */
  desktop?: (channel: string, ...args: unknown[]) => Promise<unknown>
}

export interface HttpRequestConfig {
  method?: string
  url?: string
  headers?: { key: string; value: string }[]
  body?: string
}

export interface HttpRequestResult {
  ok: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  timeMs?: number
  size?: number
  error?: string
}

export type ToolContext = BuiltinToolContext | PluginToolContext

/** Agent 工具定义：内置与插件同构，经 kind 分流执行 */
export interface AgentTool {
  key: string // 白名单 key（权限粒度 = 单个工具）
  name: string // MCP 工具名（tools/list 暴露名）
  label: string // 设置页显示名
  description: string
  inputSchema: Record<string, unknown> // JSON Schema
  readonly?: boolean // 只读（走缓存、不落盘）
  danger?: boolean // 高危标记（设置页警示）
  defaultEnabled?: boolean
  kind: 'builtin' | 'plugin'
  /** 插件工具：所属插件 id */
  pluginId?: string
  /** 插件工具：插件声明的权限（manifest.permissions） */
  pluginPermissions?: string[]
  run(ctx: ToolContext, args: Record<string, unknown>): unknown
}

// ---- 插件（第三方可编写）----

export const PLUGIN_API_VERSION = 1

/** 插件自有 KV 存储（作用域按插件 id 隔离） */
export interface PluginStorage {
  get(key: string): unknown | undefined
  set(key: string, value: unknown): void
  delete(key: string): void
  clear(): void
  keys(): string[]
}

/** 第三方插件声明的工具（能力 ctx，无 db） */
export interface PluginTool {
  key: string
  name: string
  label?: string
  description: string
  inputSchema: Record<string, unknown>
  readonly?: boolean
  danger?: boolean
  run(ctx: PluginToolContext, args: Record<string, unknown>): unknown
}

export interface PluginManifest {
  id: string
  name: string
  version: string
  apiVersion: number
  permissions: string[]
  tools: PluginTool[]
  entry?: string
  author?: string
  description?: string
  /** 内置插件标记（随应用分发，不可卸载） */
  builtin?: boolean
  /** 预留：市场元数据（本次不实现） */
  marketplace?: Record<string, unknown>
}

/** 已加载的插件实例 */
export interface LoadedPlugin {
  manifest: PluginManifest
  entryPath: string
}

// ---- 能力（Capability-based 权限模型）----

/** 平台能力注册表条目：id 是授权粒度 */
export interface Capability {
  id: string
  label: string
  description: string
  /** 为插件 ctx 构建该能力服务对象 */
  create(host: { dataDir: string; pluginId: string }): unknown
}

// ---- 平台模块（内置，你本人开发）----

export interface MainModuleContext {
  getDB: () => Database
  saveAsync: () => void
  send: (channel: string, ...args: unknown[]) => void
  getDataDir: () => string
  /** app-shell 装配后注入的统一 Agent 工具注册表（mcp 模块消费） */
  toolRegistry?: ToolRegistry
}

export interface RendererViewDefinition {
  id: string
  label: string
}

export interface RendererSettingsSection {
  id: string
  title: string
}

/** 内置平台模块声明 */
export interface FeatureModule {
  id: string
  name: string
  kind: 'core' | 'optional' // core 不可禁用
  defaultEnabled?: boolean
  registerIpc?(ctx: MainModuleContext): void
  onStart?(ctx: MainModuleContext): void
  onShutdown?(ctx: MainModuleContext): void
  /** Agent 工具贡献（注册进统一 MCP） */
  agentTools?: AgentTool[]
  /** 渲染层贡献声明（供 App 装配器使用） */
  renderer?: {
    view?: RendererViewDefinition
    settingsSections?: RendererSettingsSection[]
  }
}