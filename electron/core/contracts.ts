import type { Database } from 'sql.js'
import type { AppService } from './app-service'

// ===================================================================
// 平台契约（Platform Contracts）—— 纯 TS，无 Electron 依赖。
// 主进程与渲染层共用的模块/能力类型定义。
// ===================================================================

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

// ---- 平台模块（内置，你本人开发）----

export interface MainModuleContext {
  getDB: () => Database
  saveAsync: () => void
  send: (channel: string, ...args: unknown[]) => void
  getDataDir: () => string
  /** 统一业务层（AppService），模块可在此注册应用能力 */
  appService?: AppService
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
  /** 注册应用能力到统一业务层（AppService）；与 UI 解耦 */
  appService?(svc: AppService, ctx: MainModuleContext): void
  onStart?(ctx: MainModuleContext): void
  onShutdown?(ctx: MainModuleContext): void
  /** 渲染层贡献声明（供 App 装配器使用） */
  renderer?: {
    view?: RendererViewDefinition
    settingsSections?: RendererSettingsSection[]
  }
}
