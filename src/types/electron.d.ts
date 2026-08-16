import type {
  Task,
  TaskFilter,
  CreateTaskDTO,
  UpdateTaskDTO,
  Category,
  CreateCategoryDTO,
} from './task'

declare global {
  interface HttpRequestConfig {
    method: string
    url: string
    headers: { key: string; value: string }[]
    body: string
  }

  type McpOperationKey =
    | 'task:create'
    | 'task:read_list'
    | 'task:read_detail'
    | 'task:update_status'
    | 'task:update'
    | 'task:delete'

  interface McpConfig {
    enabled: boolean
    graph: string
    maxWaitLockMs: number
    permissions: Record<McpOperationKey, boolean>
  }

  interface Window {
    electronAPI: {
      platform: string
      taskCreate(dto: CreateTaskDTO): Promise<Task>
      taskGetAll(filter?: TaskFilter): Promise<Task[]>
      taskGetById(id: string): Promise<Task | null>
      taskUpdate(dto: UpdateTaskDTO): Promise<Task | null>
      taskDelete(id: string): Promise<boolean>
      taskUpdateStatus(id: string, status: string): Promise<Task | null>

      categoryCreate(dto: CreateCategoryDTO): Promise<Category>
      categoryGetAll(): Promise<Category[]>
      categoryUpdate(
        id: string,
        data: Partial<Pick<Category, 'name' | 'color' | 'sortOrder'>>,
      ): Promise<Category | null>
      categoryDelete(id: string): Promise<boolean>
      categoryGetTaskCounts(): Promise<Record<string, number>>

      settingsGetAll(): Promise<Record<string, string>>
      settingsSet(key: string, value: string): Promise<void>

      mcpGetConfig(): Promise<McpConfig>
      mcpSetConfig(cfg: Partial<McpConfig>): Promise<McpConfig>

      toolGetAll(): Promise<Record<string, string>>
      toolSet(key: string, value: string): Promise<void>
      httpRequest(
        config: HttpRequestConfig,
      ): Promise<{
        ok: boolean
        status?: number
        statusText?: string
        headers?: Record<string, string>
        body?: string
        timeMs?: number
        size?: number
        error?: string
      }>

      windowMinimize(): Promise<void>
      windowMaximizeToggle(): Promise<void>
      windowClose(): Promise<void>
      setThemeSource(source: 'system' | 'light' | 'dark'): Promise<void>
      onWindowMaximizedChange(cb: (maximized: boolean) => void): () => void

      getAppVersion(): Promise<string>

      exportMarkdown(): Promise<boolean>

      exportBackup(): Promise<boolean>
      importBackup(): Promise<{ ok: boolean; error?: string }>

      getDataDir(): Promise<string>
      getDataDirFallback(): Promise<string | null>
      chooseDataDir(): Promise<string | null>
      setDataDir(path: string): Promise<{ ok: boolean; path?: string; error?: string }>

      getInboxDir(): Promise<string>
      openInboxDir(): Promise<boolean>
      onInboxProcessed(
        cb: (result: {
          ok: boolean
          file: string
          stats?: {
            tasksAdded: number
            tasksUpdated: number
            categoriesAdded: number
            categoriesUpdated: number
            settingsAdded: number
            imagesAdded: number
          }
          error?: string
        }) => void,
      ): () => void
      onDataChanged(cb: () => void): () => void

      saveImageFromData(dataUri: string): Promise<string>
      pickAndSaveImage(): Promise<string | null>
      deleteImage(url: string): Promise<void>

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
