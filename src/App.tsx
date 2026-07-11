import { useEffect, useState } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'
import { useSettingsStore } from '@/stores/settings-store'
import { TaskList } from '@/components/task-list'
import { DetailPanel } from '@/components/detail-panel'
import { CategorySidebar } from '@/components/category-sidebar'
import { ExpandedDescription } from '@/components/expanded-description'
import { SettingsDialog } from '@/components/settings-dialog'
import { useTheme } from '@/hooks/use-theme'
import { ToastContainer } from '@/components/toast'
import { ConfirmDialog } from '@/components/confirm-dialog'

import { toast } from '@/lib/toast'

export default function App() {
  useTheme()
  const loadTasks = useTaskStore((s) => s.loadTasks)
  const selectTask = useTaskStore((s) => s.selectTask)
  const loadCategories = useCategoryStore((s) => s.loadCategories)
  const activeCategoryId = useCategoryStore((s) => s.activeCategoryId)
  const expandedDescId = useTaskStore((s) => s.expandedDescId)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const [showSettings, setShowSettings] = useState(false)
  const [maximized, setMaximized] = useState(false)

  useEffect(() => {
    loadTasks()
    loadCategories()
    loadSettings()
  }, [loadTasks, loadCategories, loadSettings])

  useEffect(() => {
    const unsub = window.electronAPI.onWindowMaximizedChange((v) => setMaximized(v))
    return () => unsub()
  }, [])

  useEffect(() => {
    selectTask(null)
  }, [activeCategoryId, selectTask])

  async function handleExport() {
    const ok = await window.electronAPI.exportMarkdown()
    toast(ok ? '导出成功' : '取消导出')
  }

  const DRAG = { WebkitAppRegion: 'drag' as string }
  const NO_DRAG = { WebkitAppRegion: 'no-drag' as string }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-3" style={DRAG}>
        <h1 className="text-sm font-bold tracking-wide select-none">ZDNotes</h1>
        <div className="flex items-center">
          <div className="flex items-center gap-1" style={NO_DRAG}>
            <button onClick={() => setShowSettings(true)} className="rounded px-2 py-1.5 text-xs transition-colors hover:bg-accent" title="设置">
              ⚙️
            </button>
            <button onClick={handleExport} className="rounded px-2 py-1.5 text-xs transition-colors hover:bg-accent">
              导出
            </button>
          </div>
          <span className="mx-1 h-4 w-px bg-border" />
          <div className="flex" style={NO_DRAG}>
            <button onClick={() => window.electronAPI.windowMinimize()} className="titlebar-btn" title="最小化">
              <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.2}>
                <line x1="2" y1="6" x2="10" y2="6" />
              </svg>
            </button>
            <button onClick={() => window.electronAPI.windowMaximizeToggle()} className="titlebar-btn" title={maximized ? '还原' : '最大化'}>
              {maximized ? (
                <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.2}>
                  <rect x="1" y="1.5" width="9" height="9" rx="0.5" opacity="0.4" />
                  <rect x="3" y="3" width="8.5" height="8.5" rx="0.5" fill="var(--color-background)" stroke="currentColor" />
                </svg>
              ) : (
                <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.2}>
                  <rect x="1.5" y="1.5" width="9" height="9" rx="0.5" />
                </svg>
              )}
            </button>
            <button onClick={() => window.electronAPI.windowClose()} className="titlebar-btn titlebar-close" title="关闭">
              <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth={1.2}>
                <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
                <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
              </svg>
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden h-full md:block">
          <CategorySidebar />
        </aside>

        <div className="relative flex-1 overflow-hidden">
          <div
            className={`absolute inset-0 transition-all duration-300 ease-in-out ${
              expandedDescId ? 'opacity-0 -translate-y-1 pointer-events-none' : 'opacity-100 translate-y-0'
            }`}
          >
            <div className="h-full overflow-y-auto p-3">
              <TaskList />
            </div>
          </div>
          <div
            className={`absolute inset-0 transition-all duration-300 ease-in-out ${
              expandedDescId ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1 pointer-events-none'
            }`}
          >
            <ExpandedDescription />
          </div>
        </div>

        <aside className="hidden w-80 border-l md:block">
          <DetailPanel />
        </aside>
      </div>
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <ToastContainer />
      <ConfirmDialog />
    </div>
  )
}
