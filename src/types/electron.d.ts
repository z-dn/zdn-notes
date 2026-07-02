import type { Task, CreateTaskDTO, UpdateTaskDTO, Category, CreateCategoryDTO } from './task'

declare global {
  interface Window {
    electronAPI: {
      platform: string
      taskCreate(dto: CreateTaskDTO): Promise<Task>
      taskGetAll(): Promise<Task[]>
      taskGetById(id: string): Promise<Task | null>
      taskUpdate(dto: UpdateTaskDTO): Promise<Task | null>
      taskDelete(id: string): Promise<boolean>
      taskUpdateStatus(id: string, status: string): Promise<Task | null>

      categoryCreate(dto: CreateCategoryDTO): Promise<Category>
      categoryGetAll(): Promise<Category[]>
      categoryUpdate(id: string, data: Partial<Pick<Category, 'name' | 'color' | 'sortOrder'>>): Promise<Category | null>
      categoryDelete(id: string): Promise<boolean>
      categoryGetTaskCounts(): Promise<Record<string, number>>

      exportMarkdown(): Promise<boolean>
    }
  }
}
