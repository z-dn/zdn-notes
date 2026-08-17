import { useCallback, useEffect, useState } from 'react'
import {
  Plug,
  Trash2,
  FolderOpen,
  Boxes,
  FileText,
  Download,
  History,
  RefreshCw,
} from 'lucide-react'
import { format } from 'date-fns'
import { showConfirm } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'
import { renderMarkdown } from '@/lib/markdown'
import type { AgentMenuKey } from './agent-sidebar'

// ===================================================================
// AGENT 工具 — 插件管理内容区（二级菜单在全局左侧栏 AgentSidebar）：
//   插件          —— 插件卡片网格（内置/第三方）+ 安装/卸载 + 授权
//   插件开发文档   —— 展示 docs/plugin-spec.md 并可下载为 Markdown
//   调用日志       —— 智能体对 MCP 的 tools/call 调用记录（实时/历史）
// ===================================================================

interface AgentToolsPageProps {
  menu: AgentMenuKey
}

export function AgentToolsPage({ menu }: AgentToolsPageProps) {
  const [plugins, setPlugins] = useState<McpPluginInfo[]>([])
  const [config, setConfig] = useState<McpConfig | null>(null)
  const [installing, setInstalling] = useState(false)
  const [specHtml, setSpecHtml] = useState('')
  const [specLoading, setSpecLoading] = useState(false)
  const [logs, setLogs] = useState<McpCallLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [clearingLogs, setClearingLogs] = useState(false)

  const refresh = useCallback(async () => {
    const [p, c] = await Promise.all([
      window.electronAPI.mcpListPlugins(),
      window.electronAPI.mcpGetConfig(),
    ])
    setPlugins(p)
    setConfig(c)
  }, [])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      setLogs(await window.electronAPI.mcpGetCallLogs())
    } finally {
      setLogsLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    const unsub = window.electronAPI.onMcpCatalogChanged(() => refresh())
    return () => unsub()
  }, [refresh])

  // 进入「开发文档」菜单时加载并渲染 markdown
  useEffect(() => {
    if (menu !== 'docs') return
    let mounted = true
    setSpecLoading(true)
    window.electronAPI
      .mcpGetPluginSpec()
      .then(async (res) => {
        if (!mounted) return
        if (res.ok && res.content) {
          const html = await renderMarkdown(res.content)
          if (mounted) setSpecHtml(html)
        } else {
          toast(`加载开发文档失败: ${res.error ?? '未知错误'}`)
        }
      })
      .finally(() => {
        if (mounted) setSpecLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [menu])

  // 进入「调用日志」菜单时加载历史并订阅实时新条目
  useEffect(() => {
    if (menu !== 'logs') return
    loadLogs()
    const unsub = window.electronAPI.onMcpCallLogged((entry) => {
      setLogs((prev) => [entry, ...prev.filter((l) => l.id !== entry.id)].slice(0, 500))
    })
    return () => unsub()
  }, [menu, loadLogs])

  async function handleClearLogs() {
    const ok = await showConfirm('清空调用日志', '确定清空所有调用日志吗？此操作不可恢复。')
    if (!ok) return
    setClearingLogs(true)
    try {
      await window.electronAPI.mcpClearCallLogs()
      setLogs([])
      toast('已清空调用日志')
    } finally {
      setClearingLogs(false)
    }
  }

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
    setConfig({ ...config, enabled })
    const saved = await window.electronAPI.mcpSetConfig({ enabled })
    setConfig(saved)
  }

  async function handleDownloadSpec() {
    const res = await window.electronAPI.mcpDownloadPluginSpec()
    if (res.canceled) return
    if (res.ok) {
      toast(`已保存: ${res.path}`)
    } else {
      toast(`保存失败: ${res.error ?? '未知错误'}`)
    }
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
    <div className="flex h-full">
      {/* 内容区 */}
      <div className="flex min-w-0 flex-1 flex-col">
        {menu === 'plugins' ? (
          <>
            <div className="flex items-center justify-between border-b border-divider px-3 py-2">
              <h2 className="flex items-center gap-1.5 text-sm font-medium">
                <Boxes className="size-3.5" />
                插件
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
          </>
        ) : menu === 'logs' ? (
          <>
            <div className="flex items-center justify-between border-b border-divider px-3 py-2">
              <h2 className="flex items-center gap-1.5 text-sm font-medium">
                <History className="size-3.5" />
                调用日志
              </h2>
              <div className="flex items-center gap-2">
                <button
                  onClick={loadLogs}
                  disabled={logsLoading}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50"
                >
                  <RefreshCw className="size-3" />
                  刷新
                </button>
                <button
                  onClick={handleClearLogs}
                  disabled={clearingLogs || logs.length === 0}
                  className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-destructive disabled:opacity-50"
                >
                  <Trash2 className="size-3" />
                  清空
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              {logsLoading ? (
                <p className="text-xs text-muted-foreground">加载中…</p>
              ) : logs.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-2 text-muted-foreground">
                  <History className="size-6" />
                  <p className="text-xs">暂无调用记录</p>
                  <p className="text-[11px]">
                    智能体通过 MCP 调用工具后，记录会出现在这里（本地 JSONL 文件，跨会话保留）
                  </p>
                </div>
              ) : (
                <ul className="space-y-2">
                  {logs.map((log) => (
                    <li
                      key={log.id}
                      className="animate-fade-slide-up rounded-lg border border-divider bg-panel p-2.5 shadow-sm"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="truncate font-mono text-xs font-medium">{log.tool}</span>
                          {log.source === 'gui' ? (
                            <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                              GUI
                            </span>
                          ) : (
                            <span className="rounded bg-accent px-1.5 py-0.5 text-[11px] text-muted-foreground">
                              MCP
                            </span>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {log.ok ? (
                            <span className="text-[11px] text-green-700 dark:text-green-300">
                              成功
                            </span>
                          ) : (
                            <span className="text-[11px] text-red-700 dark:text-red-300">失败</span>
                          )}
                          <span className="text-[11px] text-muted-foreground">{log.ms}ms</span>
                        </div>
                      </div>
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {format(log.ts, 'yyyy-MM-dd HH:mm:ss')}
                      </div>
                      {Object.keys(log.args).length > 0 && (
                        <div className="mt-1.5 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
                          {JSON.stringify(log.args)}
                        </div>
                      )}
                      {log.error && (
                        <div className="mt-1.5 truncate rounded bg-red-50 px-1.5 py-0.5 text-[11px] text-red-700 dark:bg-red-950 dark:text-red-300">
                          {log.error}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between border-b border-divider px-3 py-2">
              <h2 className="flex items-center gap-1.5 text-sm font-medium">
                <FileText className="size-3.5" />
                插件开发文档
              </h2>
              <button
                onClick={handleDownloadSpec}
                className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent"
              >
                <Download className="size-3" />
                下载 Markdown
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4">
              {specLoading ? (
                <p className="text-xs text-muted-foreground">加载中…</p>
              ) : specHtml ? (
                <div
                  className="text-sm [&_h1]:mb-2 [&_h1]:border-b [&_h1]:border-divider [&_h1]:pb-1 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mb-1 [&_h3]:mt-4 [&_h3]:text-sm [&_h3]:font-medium [&_p]:my-1.5 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-[12px] [&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:text-xs [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs [&_th]:border [&_th]:border-divider [&_th]:bg-muted/50 [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-divider [&_td]:px-2 [&_td]:py-1 [&_a]:text-primary [&_a]:underline"
                  dangerouslySetInnerHTML={{ __html: specHtml }}
                />
              ) : (
                <p className="text-xs text-muted-foreground">未找到开发文档</p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
