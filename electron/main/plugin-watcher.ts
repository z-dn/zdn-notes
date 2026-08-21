import fs from 'fs'
import { ToolRegistry } from '../core/tool-registry'
import { loadPluginsIntoRegistry, pluginRoot } from '../core/plugin-loader'
import type { AgentTool } from '../core/contracts'

// ===================================================================
// 插件热重载：监听 <dataDir>/agent-tools 目录变化，重建统一注册表并
// 推送给 mcp-ipc 端点（setRegistry）。重载时不重启窗口、不丢数据。
// 防抖 500ms，避免目录批量变更触发多次重建。
// ===================================================================

export interface PluginWatcher {
  stop: () => void
}

export function startPluginWatcher(opts: {
  dataDir: string
  builtinTools: AgentTool[]
  onReload: (registry: ToolRegistry) => void
}): PluginWatcher {
  const root = pluginRoot(opts.dataDir)
  let timer: NodeJS.Timeout | null = null
  let watcher: fs.FSWatcher | null = null
  let fallbackTimer: NodeJS.Timeout | null = null

  function rebuild() {
    const registry = new ToolRegistry()
    registry.registerAll(opts.builtinTools)
    loadPluginsIntoRegistry(registry, opts.dataDir)
    opts.onReload(registry)
  }

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      rebuild()
    }, 500)
  }

  try {
    fs.mkdirSync(root, { recursive: true })
    watcher = fs.watch(root, { recursive: true }, () => schedule())
  } catch {
    /* fs.watch 不可用时降级为轮询（每 3 秒检查一次） */
    fallbackTimer = setInterval(() => schedule(), 3000)
  }

  return {
    stop: () => {
      if (timer) clearTimeout(timer)
      if (fallbackTimer) clearInterval(fallbackTimer)
      watcher?.close()
      watcher = null
    },
  }
}