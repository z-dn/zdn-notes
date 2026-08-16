import { ipcMain } from 'electron'
import {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  getCategoryTaskCounts,
} from '../../main/database/category-dao'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

function registerIpc(_ctx: MainModuleContext): void {
  ipcMain.handle('category:create', (_e, dto) => createCategory(dto))
  ipcMain.handle('category:getAll', () => getAllCategories())
  ipcMain.handle('category:update', (_e, id, data) => updateCategory(id, data))
  ipcMain.handle('category:delete', (_e, id) => deleteCategory(id))
  ipcMain.handle('category:getTaskCounts', () => getCategoryTaskCounts())
}

export const categoriesModule: FeatureModule = {
  id: 'categories',
  name: '分类',
  kind: 'core',
  defaultEnabled: true,
  registerIpc,
}