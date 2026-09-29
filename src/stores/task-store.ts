import { create } from 'zustand'
import type { Task, TaskFilter, CreateTaskDTO, UpdateTaskDTO } from '@/types/task'
import { toast } from '@/lib/toast'
import { showConfirm } from '@/components/confirm-dialog'
import { violatesParentRange } from '@/components/task-calendar-view'
import { useCategoryStore } from './category-store'

function reloadCategories() {
  useCategoryStore.getState().loadCategories()
}

function cleanFilter(f: TaskFilter): TaskFilter | undefined {
  const out: TaskFilter = {}
  if (f.search) out.search = f.search
  return out.search ? out : undefined
}

interface TaskStore {
  tasks: Task[]
  loading: boolean
  selectedTask: Task | null
  expandedIds: Set<string>
  expandedDescId: string | null
  expandedDescOrigin: { x: number; y: number; width: number; height: number } | null
  filters: TaskFilter
  statusView: 'all' | 'todo' | 'done'
  setStatusView: (view: 'all' | 'todo' | 'done') => void
  taskView: 'list' | 'calendar'
  setTaskView: (view: 'list' | 'calendar') => void
  loadTasks: (silent?: boolean) => Promise<void>
  setFilter: (changes: Partial<TaskFilter>) => void
  createTask: (dto: CreateTaskDTO) => Promise<Task | null>
  updateTask: (dto: UpdateTaskDTO) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  toggleDone: (id: string, currentStatus: string) => Promise<void>
  selectTask: (task: Task | null) => void
  toggleExpand: (id: string) => void
  expandAll: (ids: string[]) => void
  collapseAll: () => void
  setExpandedDesc: (
    id: string | null,
    origin?: { x: number; y: number; width: number; height: number },
  ) => void
}

function api() {
  return window.electronAPI
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: false,
  selectedTask: null,
  expandedIds: new Set<string>(),
  expandedDescId: null,
  expandedDescOrigin: null,
  filters: {},
  statusView: 'all',
  taskView: 'list',

  loadTasks: async (silent = false) => {
    try {
      if (!silent) set({ loading: true })
      const { filters } = get()
      const tasks = await api().taskGetAll(cleanFilter(filters))
      set({ tasks, loading: false })
    } catch {
      toast('加载任务失败')
      set({ loading: false })
    }
  },

  setFilter: (changes) => {
    const next = { ...get().filters, ...changes }
    set({ filters: next })
    get().loadTasks()
  },

  setStatusView: (view) => set({ statusView: view }),

  setTaskView: (view) => set({ taskView: view }),

  createTask: async (dto) => {
    try {
      const task = await api().taskCreate(dto)
      const { tasks, expandedIds } = get()
      const nextExpanded = new Set(expandedIds)
      if (dto.parentId) nextExpanded.add(dto.parentId)
      set({ tasks: [...tasks, task], expandedIds: nextExpanded })
      reloadCategories()
      get().loadTasks()
      return task
    } catch {
      toast('创建任务失败')
      return null
    }
  },

  updateTask: async (dto) => {
    try {
      const { tasks, selectedTask } = get()
      const idx = tasks.findIndex((t) => t.id === dto.id)
      const old = idx !== -1 ? tasks[idx] : undefined
      if (!old && selectedTask?.id !== dto.id) return
      const base = old ?? selectedTask
      if (!base) return
      const patched = { ...base, ...dto, updatedAt: Date.now() } as Task
      let violators: Task[] = []
      if (dto.dueDate !== undefined || dto.startDate !== undefined) {
        violators = tasks.filter((t) => t.parentId === dto.id && violatesParentRange(t, patched))
        if (violators.length > 0) {
          const ok = await showConfirm(
            '日期联动',
            `调整父任务日期将清除 ${violators.length} 个子任务的日期，是否继续？`,
          )
          if (!ok) return
        }
      }
      const clearedIds = new Set(violators.map((v) => v.id))
      const nextTasks =
        idx !== -1
          ? tasks.map((t) =>
              t.id === dto.id
                ? patched
                : clearedIds.has(t.id)
                  ? { ...t, startDate: null, dueDate: null, updatedAt: Date.now() }
                  : t,
            )
          : tasks
      const nextSelected =
        selectedTask?.id === dto.id
          ? patched
          : selectedTask && clearedIds.has(selectedTask.id)
            ? { ...selectedTask, startDate: null, dueDate: null, updatedAt: Date.now() }
            : selectedTask
      set({ tasks: nextTasks, selectedTask: nextSelected })
      await api().taskUpdate(dto)
      for (const v of violators) {
        await api().taskUpdate({ id: v.id, startDate: null, dueDate: null })
      }
      reloadCategories()
    } catch {
      toast('更新任务失败')
      get().loadTasks()
    }
  },

  deleteTask: async (id) => {
    try {
      const { tasks } = get()
      const target = tasks.find((t) => t.id === id)
      if (!target) return
      if (!(await showConfirm('确认删除', `确定要删除「${target.title}」及其所有子任务吗？`)))
        return
      await api().taskDelete(id)
      reloadCategories()
      get().loadTasks()
    } catch {
      toast('删除任务失败')
    }
  },

  toggleDone: async (id, currentStatus) => {
    try {
      const newStatus = currentStatus === 'done' ? 'todo' : 'done'
      await api().taskUpdateStatus(id, newStatus)
      reloadCategories()
      get().loadTasks(true)
    } catch {
      toast('切换状态失败')
    }
  },

  selectTask: (task) => set({ selectedTask: task }),

  toggleExpand: (id) => {
    const { expandedIds } = get()
    const next = new Set(expandedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    set({ expandedIds: next })
  },

  expandAll: (ids) => set({ expandedIds: new Set(ids) }),

  collapseAll: () => set({ expandedIds: new Set() }),

  setExpandedDesc: (id, origin) =>
    set({ expandedDescId: id, ...(origin ? { expandedDescOrigin: origin } : {}) }),
}))
