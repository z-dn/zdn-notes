import { useEffect } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'
import { TaskInput } from '@/components/task-input'
import { TaskList } from '@/components/task-list'
import { DetailPanel } from '@/components/detail-panel'
import { CategorySidebar } from '@/components/category-sidebar'
import { ToastContainer } from '@/components/toast'
import { ConfirmDialog } from '@/components/confirm-dialog'

import { toast } from '@/lib/toast'

export default function App() {
  const loadTasks = useTaskStore((s) => s.loadTasks)
  const loadCategories = useCategoryStore((s) => s.loadCategories)

  useEffect(() => {
    loadTasks()
    loadCategories()
  }, [loadTasks, loadCategories])

  async function handleExport() {
    const ok = await window.electronAPI.exportMarkdown()
    toast(ok ? '导出成功' : '取消导出')
  }

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b px-4 py-2">
        <h1 className="text-lg font-bold">ZDNotes</h1>
        <button onClick={handleExport} className="rounded px-2 py-1 text-xs transition-colors hover:bg-accent">
          导出为 Markdown
        </button>
      </header>

      <div className="border-b px-4 py-2">
        <TaskInput />
      </div>

      <div className="flex flex-1 overflow-hidden">
        <aside className="hidden h-full md:block">
          <CategorySidebar />
        </aside>

        <div className="flex-1 overflow-y-auto p-3">
          <TaskList />
        </div>

        <aside className="hidden w-80 border-l md:block">
          <DetailPanel />
        </aside>
      </div>
      <ToastContainer />
      <ConfirmDialog />
    </div>
  )
}
