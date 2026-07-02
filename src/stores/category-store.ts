import { create } from 'zustand'
import type { Category, CreateCategoryDTO } from '@/types/task'
import { toast } from '@/lib/toast'
import { showConfirm } from '@/components/confirm-dialog'

interface CategoryStore {
  categories: Category[]
  taskCounts: Record<string, number>
  activeCategoryId: string | null
  loadCategories: () => Promise<void>
  createCategory: (dto: CreateCategoryDTO) => Promise<Category | null>
  updateCategory: (id: string, data: Partial<Pick<Category, 'name' | 'color' | 'sortOrder'>>) => Promise<void>
  deleteCategory: (id: string) => Promise<void>
  selectCategory: (id: string | null) => void
}

function api() {
  return window.electronAPI
}

export const useCategoryStore = create<CategoryStore>((set, get) => ({
  categories: [],
  taskCounts: {},
  activeCategoryId: null,

  loadCategories: async () => {
    try {
      const [categories, taskCounts] = await Promise.all([
        api().categoryGetAll(),
        api().categoryGetTaskCounts(),
      ])
      set({ categories, taskCounts })
    } catch (e) {
      toast('加载分类失败')
    }
  },

  createCategory: async (dto) => {
    try {
      const category = await api().categoryCreate(dto)
      const { categories } = get()
      set({ categories: [...categories, category] })
      return category
    } catch (e) {
      toast('创建分类失败')
      return null
    }
  },

  updateCategory: async (id, data) => {
    try {
      await api().categoryUpdate(id, data)
      const { categories } = get()
      set({
        categories: categories.map((c) => (c.id === id ? { ...c, ...data } : c)),
      })
    } catch (e) {
      toast('更新分类失败')
    }
  },

  deleteCategory: async (id) => {
    try {
      if (!(await showConfirm('确认删除', '确定要删除此分类吗？该分类下的任务将归入「未分类」。'))) return
      await api().categoryDelete(id)
      const { categories, activeCategoryId } = get()
      set({
        categories: categories.filter((c) => c.id !== id),
        activeCategoryId: activeCategoryId === id ? null : activeCategoryId,
      })
      get().loadCategories()
    } catch (e) {
      toast('删除分类失败')
    }
  },

  selectCategory: (id) => set({ activeCategoryId: id }),
}))
