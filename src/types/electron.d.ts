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

      settingsGetAll(): Promise<Record<string, string>>
      settingsSet(key: string, value: string): Promise<void>

      exportMarkdown(): Promise<boolean>

      updateCheck(): Promise<void>
      updateDownload(): Promise<void>
      updateInstall(): Promise<void>
      onUpdateChecking(cb: () => void): () => void
      onUpdateAvailable(cb: (info: unknown) => void): () => void
      onUpdateNotAvailable(cb: (info: unknown) => void): () => void
      onUpdateError(cb: (msg: string) => void): () => void
      onUpdateProgress(cb: (progress: unknown) => void): () => void
      onUpdateDownloaded(cb: (info: unknown) => void): () => void
    }
  }
}
