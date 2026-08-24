import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useToolStore } from '@/stores/tool-store'
import { TaskList } from '@/components/task-list'
import { DetailPanel } from '@/components/detail-panel'
import { CategorySidebar } from '@/components/category-sidebar'
import { ExpandedDescription } from '@/components/expanded-description'
import { SettingsDialog } from '@/components/settings-dialog'
import { ToolboxSidebar } from '@/components/toolbox/toolbox-sidebar'
import { ToolboxWorkspace } from '@/components/toolbox/toolbox-workspace'
import { AgentToolsPage } from '@/components/agent/agent-tools-page'
import { AgentSidebar } from '@/components/agent/agent-sidebar'
import type { AgentMenuKey } from '@/components/agent/agent-sidebar'
import { DshPage } from '@/components/dsh/dsh-page'
import { useTheme } from '@/hooks/use-theme'
import { useFeature } from '@/hooks/use-feature'
import { ToastContainer } from '@/components/toast'
import { ConfirmDialog } from '@/components/confirm-dialog'
import { FadeSwitch } from '@/components/fade'
import { TabContextMenu, type TabMenuState } from '@/components/tab-context-menu'
import { collectViews } from '@/modules'

import { toast } from '@/lib/toast'

export default function App() {
  useTheme()
  const loadTasks = useTaskStore((s) => s.loadTasks)
  const selectTask = useTaskStore((s) => s.selectTask)
  const loadCategories = useCategoryStore((s) => s.loadCategories)
  const activeCategoryId = useCategoryStore((s) => s.activeCategoryId)
  const expandedDescId = useTaskStore((s) => s.expandedDescId)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const loadToolStates = useToolStore((s) => s.loadStates)
  const [showSettings, setShowSettings] = useState(false)
  const [maximized, setMaximized] = useState(false)
  const [pendingUpdate, setPendingUpdate] = useState('')
  const tasksEnabled = useFeature('tasks')
  const toolboxEnabled = useFeature('toolbox')
  const mcpEnabled = useFeature('mcp')
  const dshEnabled = useFeature('dsh')
  const views = collectViews().filter((v) => {
    if (v.id === 'dsh') return dshEnabled
    if (v.id === 'toolbox') return toolboxEnabled
    if (v.id === 'agent') return mcpEnabled
    return tasksEnabled
  })
  // 初始视图：新窗口通过 URL query（?view=<id>）指定要打开的模块 tab，
  // 非法/被禁用的 id 由下方兜底 effect 回落到第一个可用视图
  const [sidebarTab, setSidebarTab] = useState<string>(
    () => new URLSearchParams(window.location.search).get('view') ?? views[0]?.id ?? 'categories',
  )
  const [agentMenu, setAgentMenu] = useState<AgentMenuKey>('plugins')
  const [tabMenu, setTabMenu] = useState<TabMenuState | null>(null)

  useEffect(() => {
    loadTasks()
    loadCategories()
    loadSettings()
    loadToolStates()
  }, [loadTasks, loadCategories, loadSettings, loadToolStates])

  useEffect(() => {
    const unsub = window.electronAPI.onWindowMaximizedChange((v) => setMaximized(v))
    return () => unsub()
  }, [])

  useEffect(() => {
    const a = window.electronAPI.onUpdateAvailable((info) => {
      const ver = (info as { version?: string }).version ?? ''
      setPendingUpdate(ver)
    })
    const b = window.electronAPI.onUpdateNotAvailable(() => {
      /* noop */
    })
    const c = window.electronAPI.onUpdateError((msg) => {
      console.warn('[update]', msg)
    })
    return () => {
      a?.()
      b?.()
      c?.()
    }
  }, [])

  useEffect(() => {
    const unsub = window.electronAPI.onInboxProcessed((result) => {
      if (!result.ok) {
        toast(`收件夹导入失败: ${result.error ?? result.file}`)
        return
      }
      loadTasks()
      loadCategories()
      const s = result.stats
      const parts: string[] = []
      if (s) {
        if (s.tasksAdded) parts.push(`新增任务 ${s.tasksAdded}`)
        if (s.tasksUpdated) parts.push(`更新任务 ${s.tasksUpdated}`)
        if (s.categoriesAdded) parts.push(`新增分类 ${s.categoriesAdded}`)
        if (s.categoriesUpdated) parts.push(`更新分类 ${s.categoriesUpdated}`)
        if (s.imagesAdded) parts.push(`新增图片 ${s.imagesAdded}`)
        if (s.settingsAdded) parts.push(`新增设置 ${s.settingsAdded}`)
      }
      toast(parts.length ? `已导入 ${result.file}（${parts.join('、')}）` : `已导入 ${result.file}`)
    })
    return () => unsub()
  }, [loadTasks, loadCategories])

  // 数据被外部写者（MCP 智能体经 GUI-IPC 委托）修改时刷新界面
  useEffect(() => {
    const unsub = window.electronAPI.onDataChanged(() => {
      loadTasks(true)
      loadCategories()
    })
    return () => unsub()
  }, [loadTasks, loadCategories])

  // 点击系统提醒通知：唤起任务页并定位到对应任务
  useEffect(() => {
    const unsub = window.electronAPI.onReminderOpen((taskId) => {
      setSidebarTab('categories')
      const found = useTaskStore.getState().tasks.find((t) => t.id === taskId)
      if (found) {
        selectTask(found)
        return
      }
      loadTasks().then(() => {
        const task = useTaskStore.getState().tasks.find((t) => t.id === taskId)
        if (task) selectTask(task)
      })
    })
    return () => unsub()
  }, [loadTasks, selectTask])

  useEffect(() => {
    selectTask(null)
  }, [activeCategoryId, selectTask])

  useEffect(() => {
    if (!views.some((v) => v.id === sidebarTab) && views.length > 0) {
      setSidebarTab(views[0].id)
    }
  }, [views, sidebarTab])

  async function handleExport() {
    const ok = await window.electronAPI.exportMarkdown()
    toast(ok ? '导出成功' : '取消导出')
  }

  const DRAG = { WebkitAppRegion: 'drag' } as React.CSSProperties
  const NO_DRAG = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

  return (
    <TooltipProvider>
      <div className="flex h-screen flex-col bg-background text-foreground">
        <header className="flex h-12 items-center justify-between border-b border-divider bg-panel-header px-3" style={DRAG}>
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide select-none">ZDNotes</h1>
            <div className="flex items-center gap-1" style={NO_DRAG}>
              {views.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setSidebarTab(tab.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    setTabMenu({ x: e.clientX, y: e.clientY, viewId: tab.id })
                  }}
                  className={`min-w-16 max-w-36 truncate rounded-md px-4 py-1.5 text-xs transition-colors ${
                    sidebarTab === tab.id
                      ? 'bg-accent font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex items-center">
            <div className="flex items-center gap-1" style={NO_DRAG}>
              <button
                onClick={() => {
                  setShowSettings(true)
                  setPendingUpdate('')
                }}
                className="relative rounded px-2 py-1.5 transition-colors hover:bg-accent"
                title="设置"
              >
                <Settings className="size-3.5" />
                {pendingUpdate && (
                  <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-green-500" />
                )}
              </button>
              <button
                onClick={handleExport}
                className="rounded px-2 py-1.5 text-xs transition-colors hover:bg-accent"
              >
                导出
              </button>
            </div>
            <span className="mx-1 h-4 w-px bg-border" />
            <div className="flex" style={NO_DRAG}>
              <button
                onClick={() => window.electronAPI.windowMinimize()}
                className="titlebar-btn"
                title="最小化"
              >
                <svg
                  viewBox="0 0 12 12"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.2}
                >
                  <line x1="2" y1="6" x2="10" y2="6" />
                </svg>
              </button>
              <button
                onClick={() => window.electronAPI.windowMaximizeToggle()}
                className="titlebar-btn"
                title={maximized ? '还原' : '最大化'}
              >
                {maximized ? (
                  <svg
                    viewBox="0 0 12 12"
                    className="size-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.2}
                  >
                    <rect x="1" y="1.5" width="9" height="9" rx="0.5" opacity="0.4" />
                    <rect
                      x="3"
                      y="3"
                      width="8.5"
                      height="8.5"
                      rx="0.5"
                      fill="var(--color-background)"
                      stroke="currentColor"
                    />
                  </svg>
                ) : (
                  <svg
                    viewBox="0 0 12 12"
                    className="size-3"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.2}
                  >
                    <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => window.electronAPI.windowClose()}
                className="titlebar-btn titlebar-close"
                title="关闭"
              >
                <svg
                  viewBox="0 0 12 12"
                  className="size-3"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.2}
                >
                  <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
                  <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
                </svg>
              </button>
            </div>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {sidebarTab !== 'dsh' && (
            <aside className="hidden h-full w-48 flex-col border-r border-divider bg-panel-sidebar md:flex">
              <FadeSwitch
                current={sidebarTab}
                className="flex min-h-0 flex-1 flex-col"
                render={(k) => {
                  if (k === 'toolbox') return <ToolboxSidebar />
                  if (k === 'agent') return <AgentSidebar menu={agentMenu} onMenuChange={setAgentMenu} />
                  return <CategorySidebar />
                }}
              />
            </aside>
          )}

          <div className="animate-fade-slide-up relative flex-1 overflow-hidden bg-panel">
            <FadeSwitch
              current={sidebarTab}
              className="relative h-full overflow-hidden"
              render={(k) => {
                if (k === 'toolbox') {
                  return (
                    <div className="h-full overflow-y-auto p-3">
                      <ToolboxWorkspace />
                    </div>
                  )
                }
                if (k === 'agent') {
                  return <AgentToolsPage menu={agentMenu} />
                }
                if (k === 'dsh') {
                  return <DshPage />
                }
                return (
                  <>
                    <FadeSwitch
                      current={activeCategoryId ?? 'all'}
                      className="absolute inset-0"
                      render={(catId) => (
                        <div
                          className={`h-full overflow-y-auto p-3 transition-all duration-300 ease-in-out ${
                            expandedDescId
                              ? 'opacity-0 -translate-y-1 pointer-events-none'
                              : 'opacity-100 translate-y-0'
                          }`}
                        >
                          <TaskList key={catId} categoryId={catId === 'all' ? null : catId} />
                        </div>
                      )}
                    />
                    <div className={`absolute inset-0 ${!expandedDescId ? 'pointer-events-none' : ''}`}>
                      <ExpandedDescription />
                    </div>
                  </>
                )
              }}
            />
          </div>

          {sidebarTab !== 'toolbox' && sidebarTab !== 'agent' && sidebarTab !== 'dsh' && (
            <aside className="hidden w-80 border-l border-divider bg-panel-detail md:block">
              <DetailPanel />
            </aside>
          )}
        </div>
        <SettingsDialog
          open={showSettings}
          onClose={() => setShowSettings(false)}
          pendingVersion={pendingUpdate || undefined}
        />
        {tabMenu && <TabContextMenu menu={tabMenu} onClose={() => setTabMenu(null)} />}
        <ToastContainer />
        <ConfirmDialog />
      </div>
    </TooltipProvider>
  )
}
