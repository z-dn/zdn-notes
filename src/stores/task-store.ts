import { create } from 'zustand'
import type { Task, TaskFilter, CreateTaskDTO, UpdateTaskDTO } from '@/types/task'
import { toast } from '@/lib/toast'
import { showConfirm } from '@/components/confirm-dialog'
import { useCategoryStore } from './category-store'

function reloadCategories() {
  useCategoryStore.getState().loadCategories()
}

function cleanFilter(f: TaskFilter): TaskFilter | undefined {
  const out: TaskFilter = {}
  if (f.search) out.search = f.search
  if (f.status) out.status = f.status
  return out.search || out.status ? out : undefined
}

interface TaskStore {
  tasks: Task[]
  loading: boolean
  selectedTask: Task | null
  expandedIds: Set<string>
  expandedDescId: string | null
  expandedDescOrigin: { x: number; y: number; width: number; height: number } | null
  filters: TaskFilter
  loadTasks: (silent?: boolean) => Promise<void>
  setFilter: (changes: Partial<TaskFilter>) => void
  createTask: (dto: CreateTaskDTO) => Promise<Task | null>
  updateTask: (dto: UpdateTaskDTO) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  toggleDone: (id: string, currentStatus: string) => Promise<void>
  selectTask: (task: Task | null) => void
  toggleExpand: (id: string) => void
  setExpandedDesc: (id: string | null, origin?: { x: number; y: number; width: number; height: number }) => void
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
      const nextTasks =
        idx !== -1 ? tasks.map((t) => (t.id === dto.id ? patched : t)) : tasks
      const nextSelected = selectedTask?.id === dto.id ? patched : selectedTask
      set({ tasks: nextTasks, selectedTask: nextSelected })
      await api().taskUpdate(dto)
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
      if (!(await showConfirm('确认删除', `确定要删除「${target.title}」及其所有子任务吗？`))) return
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

  setExpandedDesc: (id, origin) => set({ expandedDescId: id, ...(origin ? { expandedDescOrigin: origin } : {}) }),
}))
