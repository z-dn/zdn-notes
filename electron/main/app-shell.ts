import { ipcMain, Menu } from 'electron'
import type { Database } from 'sql.js'
import { initDB, closeDB, getDB, saveAsync } from './database'
import { getAllSettings } from './database/settings-dao'
import { getDataDir } from './data-location'
import { sendToRenderer } from './window-store'
import { ModuleRegistry } from '../core/module-registry'
import { AppService } from '../core/app-service'
import { resolveFlags } from '../core/feature-flags'
import { BUILTIN_MODULES } from '../modules'
import type { MainModuleContext } from '../core/contracts'

// ===================================================================
// 应用装配器（App Shell）。
// 替代原先 whenReady 里的硬编码序列：注册模块 → 解析 feature-flags →
// 构建统一业务层（AppService）→ onStart（inbox 起监听、updater 注册事件）
// → registerIpcAll。
// ===================================================================

/** 为 AppService 的每个通道自动生成 ipcMain.handle 包装（UI 经 IPC 访问同一业务层） */
function registerAppServiceIpc(svc: AppService): void {
  for (const channel of svc.channels()) {
    ipcMain.handle(channel, (_e, ...args) => svc.invoke(channel, ...args))
  }
}

export interface AppShell {
  registry: ModuleRegistry
  flags: Record<string, boolean>
  shutdown: () => void
}

export async function startAppShell(): Promise<AppShell> {
  Menu.setApplicationMenu(null)

  await initDB()

  const flags = resolveFlags(getAllSettings())
  const registry = new ModuleRegistry()
  registry.registerAll(BUILTIN_MODULES)

  const ctx: MainModuleContext = {
    getDB: getDB as () => Database,
    saveAsync,
    send: sendToRenderer,
    getDataDir,
  }

  // 统一业务层：各模块注册应用能力 → 自动生成 IPC 包装
  const appService = new AppService()
  registry.registerAppServiceAll(appService, ctx, flags)
  ctx.appService = appService
  registerAppServiceIpc(appService)

  await registry.startAll(ctx, flags)
  registry.registerIpcAll(ctx, flags)

  return {
    registry,
    flags,
    shutdown: () => {
      closeDB()
      registry.shutdownAll(ctx, flags)
    },
  }
}
