import {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  getCategoryTaskCounts,
} from '../../main/database/category-dao'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'
import type { AppService } from '../../core/app-service'
import type { CreateCategoryDTO, Category } from '@/types/task'

// 应用业务层：分类 CRUD/计数（UI 与插件 ctx.app 共用）
function appService(svc: AppService, _ctx: MainModuleContext): void {
  svc.register('category:create', (dto: unknown) => createCategory(dto as CreateCategoryDTO))
  svc.register('category:getAll', () => getAllCategories())
  svc.register('category:update', (id: unknown, data: unknown) =>
    updateCategory(String(id), data as Partial<Pick<Category, 'name' | 'color' | 'sortOrder'>>),
  )
  svc.register('category:delete', (id: unknown) => deleteCategory(String(id)))
  svc.register('category:getTaskCounts', () => getCategoryTaskCounts())
}

export const categoriesModule: FeatureModule = {
  id: 'categories',
  name: '分类',
  kind: 'core',
  defaultEnabled: true,
  appService,
}