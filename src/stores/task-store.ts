import { create } from 'zustand'
import type { Task, CreateTaskDTO, UpdateTaskDTO } from '@/types/task'
import { toast } from '@/lib/toast'
import { showConfirm } from '@/components/confirm-dialog'
import { useCategoryStore } from './category-store'

function reloadCategories() {
  useCategoryStore.getState().loadCategories()
}

interface TaskStore {
  tasks: Task[]
  loading: boolean
  selectedTask: Task | null
  expandedIds: Set<string>
  loadTasks: () => Promise<void>
  createTask: (dto: CreateTaskDTO) => Promise<Task | null>
  updateTask: (dto: UpdateTaskDTO) => Promise<void>
  deleteTask: (id: string) => Promise<void>
  toggleDone: (id: string, currentStatus: string) => Promise<void>
  selectTask: (task: Task | null) => void
  toggleExpand: (id: string) => void
}

function api() {
  return window.electronAPI
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: false,
  selectedTask: null,
  expandedIds: new Set<string>(),

  loadTasks: async () => {
    try {
      set({ loading: true })
      const tasks = await api().taskGetAll()
      set({ tasks, loading: false })
    } catch (e) {
      toast('加载任务失败')
      set({ loading: false })
    }
  },

  createTask: async (dto) => {
    try {
      const task = await api().taskCreate(dto)
      const { tasks, expandedIds } = get()
      const nextExpanded = new Set(expandedIds)
      if (dto.parentId) nextExpanded.add(dto.parentId)
      set({ tasks: [...tasks, task], expandedIds: nextExpanded })
      reloadCategories()
      return task
    } catch (e) {
      toast('创建任务失败')
      return null
    }
  },

  updateTask: async (dto) => {
    try {
      const { tasks, selectedTask } = get()
      const idx = tasks.findIndex((t) => t.id === dto.id)
      if (idx === -1) return
      const old = tasks[idx]
      const patched = { ...old, ...dto, updatedAt: Date.now() } as Task
      const nextTasks = [...tasks]
      nextTasks[idx] = patched
      const nextSelected = selectedTask?.id === dto.id ? patched : selectedTask
      set({ tasks: nextTasks, selectedTask: nextSelected })
      await api().taskUpdate(dto)
      reloadCategories()
    } catch (e) {
      toast('更新任务失败')
      const reloaded = await api().taskGetAll().catch(() => get().tasks)
      set({ tasks: reloaded })
    }
  },

  deleteTask: async (id) => {
    try {
      const { tasks } = get()
      const target = tasks.find((t) => t.id === id)
      if (!target) return
      if (!(await showConfirm('确认删除', `确定要删除「${target.title}」及其所有子任务吗？`))) return
      await api().taskDelete(id)
      const { tasks: updatedTasks, selectedTask } = get()
      set({
        tasks: updatedTasks.filter((t) => t.id !== id),
        selectedTask: selectedTask?.id === id ? null : selectedTask,
      })
      reloadCategories()
    } catch (e) {
      toast('删除任务失败')
    }
  },

  toggleDone: async (id, currentStatus) => {
    try {
      const newStatus = currentStatus === 'done' ? 'todo' : 'done'
      await api().taskUpdateStatus(id, newStatus)
      const reloaded = await api().taskGetAll()
      set({ tasks: reloaded })
      reloadCategories()
    } catch (e) {
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
}))
