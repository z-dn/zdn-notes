import { useCallback, useEffect, useState } from 'react'
import { Plug, Trash2, FolderOpen, Boxes } from 'lucide-react'
import { showConfirm } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'

// ===================================================================
// AGENT 工具 — 插件卡片总览。
// 与「待办项」「工具箱」同级的侧边栏 tab：
//   - 每个插件一张卡片，网格排列（内置插件 / 第三方插件）
//   - 卡片内列出该插件的全部工具，每个工具带授权开关
//     （写 agent-mcp-config.json 白名单）
//   - 内置插件（含「待办任务」6 个任务方法）不可卸载
//   - 第三方插件卡片带卸载入口
// 安装/卸载/热重载后经 mcp:catalogChanged 自动刷新。
// ===================================================================

const PERMISSION_LABELS: Record<string, string> = {
  'http:request': 'HTTP 请求',
  desktop: '桌面 API',
}

export function AgentToolsPage() {
  const [plugins, setPlugins] = useState<McpPluginInfo[]>([])
  const [config, setConfig] = useState<McpConfig | null>(null)
  const [installing, setInstalling] = useState(false)

  const refresh = useCallback(async () => {
    const [p, c] = await Promise.all([
      window.electronAPI.mcpListPlugins(),
      window.electronAPI.mcpGetConfig(),
    ])
    setPlugins(p)
    setConfig(c)
  }, [])

  useEffect(() => {
    refresh()
    const unsub = window.electronAPI.onMcpCatalogChanged(() => refresh())
    return () => unsub()
  }, [refresh])

  async function handleInstall() {
    setInstalling(true)
    try {
      const res = await window.electronAPI.mcpInstallPlugin()
      if (res.canceled) return
      if (res.ok) {
        toast(`已安装插件: ${res.name}`)
        await refresh()
      } else {
        toast(`安装失败: ${res.error ?? '未知错误'}`)
      }
    } finally {
      setInstalling(false)
    }
  }

  async function handleUninstall(plugin: McpPluginInfo) {
    const ok = await showConfirm(
      '卸载插件',
      `确定卸载「${plugin.name}」吗？插件目录将被删除，其工具将不再提供给智能体。`,
    )
    if (!ok) return
    const res = await window.electronAPI.mcpUninstallPlugin(plugin.id)
    if (res.ok) {
      toast(`已卸载: ${plugin.name}`)
      await refresh()
    } else {
      toast(`卸载失败: ${res.error ?? '未知错误'}`)
    }
  }

  async function toggleTool(key: string, enabled: boolean) {
    if (!config) return
    const next = { ...config, permissions: { ...config.permissions, [key]: enabled } }
    setConfig(next)
    const saved = await window.electronAPI.mcpSetConfig({ permissions: next.permissions })
    setConfig(saved)
  }

  async function toggleEnabled(enabled: boolean) {
    if (!config) return
    const next = { ...config, enabled }
    setConfig(next)
    const saved = await window.electronAPI.mcpSetConfig({ enabled })
    setConfig(saved)
  }

  const builtinPlugins = plugins.filter((p) => p.builtin)
  const thirdPartyPlugins = plugins.filter((p) => !p.builtin)

  function renderCard(plugin: McpPluginInfo) {
    return (
      <div
        key={plugin.id}
        className="flex flex-col rounded-lg border border-divider bg-panel p-3 shadow-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <h3 className="truncate text-sm font-medium">{plugin.name}</h3>
              {plugin.builtin ? (
                <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                  内置
                </span>
              ) : (
                <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">
                  插件
                </span>
              )}
            </div>
            {plugin.description && (
              <p className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                {plugin.description}
              </p>
            )}
            {plugin.author && (
              <p className="mt-0.5 text-[11px] text-muted-foreground/60">作者: {plugin.author}</p>
            )}
          </div>
          {!plugin.builtin && (
            <button
              onClick={() => handleUninstall(plugin)}
              className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
              title="卸载插件"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>

        {plugin.permissions.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {plugin.permissions.map((perm) => (
              <span
                key={perm}
                className="rounded border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground"
              >
                {PERMISSION_LABELS[perm] ?? perm}
              </span>
            ))}
          </div>
        )}

        <div className="mt-3 flex-1 space-y-1 border-t border-divider pt-2">
          {plugin.tools.map((tool) => (
            <label key={tool.key} className="flex items-center gap-2 py-0.5">
              <input
                type="checkbox"
                checked={config?.permissions[tool.key] ?? false}
                disabled={!config?.enabled}
                onChange={(e) => toggleTool(tool.key, e.target.checked)}
                className="h-3.5 w-3.5 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-40"
              />
              <span className="truncate text-xs text-muted-foreground">{tool.label}</span>
            </label>
          ))}
          {plugin.tools.length === 0 && (
            <p className="text-[11px] text-muted-foreground/60">该插件未声明工具</p>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-divider px-3 py-2">
        <h2 className="flex items-center gap-1.5 text-sm font-medium">
          <Boxes className="size-3.5" />
          AGENT 插件
        </h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={config?.enabled ?? false}
              onChange={(e) => toggleEnabled(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <span className="text-[11px] text-muted-foreground">启用 MCP</span>
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={async () => {
                const dir = await window.electronAPI.mcpGetPluginsDir()
                toast(`插件目录: ${dir}`)
              }}
              className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
              title="插件目录"
            >
              <FolderOpen className="size-3" />
              目录
            </button>
            <button
              onClick={handleInstall}
              disabled={installing}
              className="inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
            >
              <Plug className="size-3" />
              {installing ? '安装中…' : '安装插件'}
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {plugins.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
            <Boxes className="size-6" />
            <p className="text-xs">暂无可用的 AGENT 插件</p>
            <p className="text-[11px]">
              点击右上角「安装插件」选择 .ztool 包，或把插件目录放入数据目录的 agent-tools/
            </p>
          </div>
        ) : (
          <div className="space-y-5">
            {builtinPlugins.length > 0 && (
              <section>
                <h3 className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  内置插件
                </h3>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  {builtinPlugins.map(renderCard)}
                </div>
              </section>
            )}
            {thirdPartyPlugins.length > 0 && (
              <section>
                <h3 className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  第三方插件
                </h3>
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-3">
                  {thirdPartyPlugins.map(renderCard)}
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
