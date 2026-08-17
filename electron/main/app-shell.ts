import { ipcMain, Menu } from 'electron'
import type { Database } from 'sql.js'
import { initDB, closeDB, getDB, saveAsync } from './database'
import { getAllSettings } from './database/settings-dao'
import { getDataDir } from './data-location'
import { sendToRenderer } from './window-store'
import { startPluginWatcher } from './plugin-watcher'
import { ModuleRegistry } from '../core/module-registry'
import { ToolRegistry } from '../core/tool-registry'
import { AppService } from '../core/app-service'
import { resolveFlags } from '../core/feature-flags'
import { loadPluginsIntoRegistry } from '../core/plugin-loader'
import { ensureBuiltinPlugins } from './seed-plugins'
import { BUILTIN_MODULES } from '../modules'
import { getMcpIpc, setCurrentToolRegistry } from '../modules/mcp'
import type { MainModuleContext } from '../core/contracts'
import type { AgentTool } from '../core/contracts'

// ===================================================================
// 应用装配器（App Shell）。
// 替代原先 whenReady 里的硬编码序列：注册模块 → 解析 feature-flags →
// 构建统一业务层（AppService，UI 与插件共用）→ 收集 Agent 工具构建统一
// 注册表 → onStart（mcp 起端点、inbox 起监听、updater 注册事件）→
// registerIpcAll。
// ===================================================================

/** 为 AppService 的每个通道自动生成 ipcMain.handle 包装（UI 经 IPC 访问同一业务层） */
function registerAppServiceIpc(svc: AppService): void {
  for (const channel of svc.channels()) {
    ipcMain.handle(channel, (_e, ...args) => svc.invoke(channel, ...args))
  }
}

export interface AppShell {
  registry: ModuleRegistry
  toolRegistry: ToolRegistry
  flags: Record<string, boolean>
  shutdown: () => void
}

export async function startAppShell(): Promise<AppShell> {
  Menu.setApplicationMenu(null)

  await initDB()

  const flags = resolveFlags(getAllSettings())
  const registry = new ModuleRegistry()
  registry.registerAll(BUILTIN_MODULES)

  const builtinTools: AgentTool[] = registry.collectAgentTools(flags)

  // 内置插件首次启动播种到数据目录 agent-tools/（不可卸载）
  ensureBuiltinPlugins(getDataDir())

  // 统一 Agent 工具注册表：内置模块贡献 + 第三方插件（agent-tools/）
  const toolRegistry = new ToolRegistry()
  toolRegistry.registerAll(builtinTools)
  loadPluginsIntoRegistry(toolRegistry, getDataDir())

  const ctx: MainModuleContext = {
    getDB: getDB as () => Database,
    saveAsync,
    send: sendToRenderer,
    getDataDir,
    toolRegistry,
  }

  // 统一业务层：各模块注册应用能力 → 自动生成 IPC 包装。UI 与插件 ctx.app 走同一张表
  const appService = new AppService()
  registry.registerAppServiceAll(appService, ctx, flags)
  ctx.appService = appService
  registerAppServiceIpc(appService)

  await registry.startAll(ctx, flags)
  registry.registerIpcAll(ctx, flags)

  // 插件热重载：agent-tools 目录变化时重建注册表并推给 GUI MCP 端点
  let watcher: ReturnType<typeof startPluginWatcher> | null = null
  const reloadPlugins = (next: ToolRegistry) => {
    ctx.toolRegistry = next
    setCurrentToolRegistry(next)
    const ipc = getMcpIpc()
    if (ipc) ipc.setRegistry(next)
    sendToRenderer('mcp:catalogChanged')
  }
  watcher = startPluginWatcher({
    dataDir: getDataDir(),
    builtinTools,
    onReload: reloadPlugins,
  })

  return {
    registry,
    toolRegistry,
    flags,
    shutdown: () => {
      watcher?.stop()
      closeDB()
      registry.shutdownAll(ctx, flags)
    },
  }
}