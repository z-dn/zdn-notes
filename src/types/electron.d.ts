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

  interface AppLogEntry {
    id: string
    ts: number
    level: 'info' | 'warn' | 'error'
    source: string
    message: string
    detail?: string
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

      toolGetAll(): Promise<Record<string, string>>
      toolSet(key: string, value: string): Promise<void>
      httpRequest(config: HttpRequestConfig): Promise<{
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
      openViewWindow(view: string): Promise<boolean>
      setThemeSource(source: 'system' | 'light' | 'dark'): Promise<void>
      onWindowMaximizedChange(cb: (maximized: boolean) => void): () => void

      getAppVersion(): Promise<string>
      getFeatures(): Promise<Record<string, boolean>>

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
      onReminderOpen(cb: (taskId: string) => void): () => void
      onReminderNotificationFailed(cb: (taskId: string) => void): () => void

      checkNotificationPermission(): Promise<{ supported: boolean; granted: boolean }>
      openNotificationSettings(): Promise<void>

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

      // ---- DeepSeek Harness（DSH）内嵌 Web UI ----
      dshIsReady(): Promise<{ ready: boolean; reason?: string }>
      dshGetVersion(): Promise<string | null>
      dshGetStatus(): Promise<{ running: boolean; port?: number; url?: string }>
      dshStart(opts?: {
        apiKey?: string
        model?: string
      }): Promise<{ ok: boolean; port?: number; error?: string }>
      dshStop(): Promise<boolean>
      onDshStatusChanged(
        cb: (status: { running: boolean; port?: number; url?: string }) => void,
      ): () => void
      dshListPlugins(): Promise<{
        ok: boolean
        plugins?: Array<{ name: string; version: string; active?: boolean }>
        quarantined?: Array<{ entryId: string; name?: string; reason: string; at: number }>
        error?: string
      }>
      dshAddPlugin(spec: string): Promise<{ ok: boolean; error?: string }>
      dshRemovePlugin(name: string): Promise<{ ok: boolean; error?: string }>
      dshRestoreQuarantine(entryId: string): Promise<{ ok: boolean; error?: string }>
      onDshPluginLog(cb: (chunk: string) => void): () => void
      onDshPluginDone(
        cb: (result: {
          action: 'add' | 'remove'
          name: string
          ok: boolean
          error?: string
        }) => void,
      ): () => void

      // ---- DSH 运行时升级 + 插件兼容性检测 ----
      dshCheckRuntimeUpdate(): Promise<{
        ok: boolean
        current: string | null
        hasUserOverride: boolean
        meta: { version: string; source: 'user'; at: number; vendorPatchApplied: boolean } | null
        distTags?: Record<string, string> | null
        latest?: string | null
        recommended?: string | null
        versions?: Array<{
          version: string
          publishedAt: number | null
          addonRange: string | null
          deprecated: string | null
          tags: string[]
          hostAddonCompatible: boolean | null
        }>
        pinned?: string | null
        ignored?: string[]
        previous?: { version: string; at: number } | null
        host?: { electron: string | null; node: string; appBootPatchRequired: boolean }
        error?: string
      }>
      dshCheckPluginCompatibility(): Promise<{
        ok: boolean
        plugins?: Array<{
          name: string
          version: string
          active: boolean
          status: 'ok' | 'incompatible' | 'inactive'
          issues: string[]
        }>
        integrity?: Array<{ name: string; ok: boolean; reason?: string }>
        error?: string
      }>
      dshPreviewUpgrade(target: string): Promise<{
        ok: boolean
        from?: string | null
        to?: string
        crossMinor?: boolean
        breaking?: Array<{ name: string; version: string; issues: string[] }>
        integrity?: Array<{ name: string; ok: boolean; reason?: string }>
        error?: string
      }>
      /** 升级前完整预演：声明层闭包 + 目标运行时实机启动真实插件集 + 推荐版本验证 */
      dshPreflightUpgrade(target: string): Promise<{
        ok: boolean
        from: string | null
        to: string
        crossMinor: boolean
        declaredIssues: Array<{
          package: string
          version: string
          root: string
          parent: string | null
          errors: string[]
          warnings: string[]
          children?: string[]
        }>
        probeOk: boolean
        probeError?: string
        probeFailures: Array<{
          entryId?: string
          name?: string
          package?: string
          reason: string
        }>
        recommendations: Array<{
          package: string
          current: string | null
          recommended: string | null
          kind: 'direct' | 'transitive'
          children?: string[]
          verified?: boolean
          note?: string
        }>
        integrity: Array<{ name: string; ok: boolean; reason?: string }>
        error?: string
      }>
      dshUpgradeRuntime(target: string): Promise<{
        ok: boolean
        from: string | null
        to: string
        reverted?: boolean
        error?: string
      }>
      dshRevertRuntime(): Promise<{ ok: boolean; error?: string }>
      dshRestorePreviousRuntime(): Promise<{ ok: boolean; version?: string; error?: string }>
      dshGetRuntimeNotes(version: string): Promise<{
        ok: boolean
        version: string
        title: string
        body: string
        url: string
        source: 'github' | 'npm' | 'error'
        publishedAt?: number | null
        error?: string
      }>
      dshSetRuntimePin(version: string | null): Promise<{ ok: boolean; error?: string }>
      dshSetRuntimeIgnored(
        version: string,
        ignored: boolean,
      ): Promise<{ ok: boolean; ignored?: string[]; error?: string }>
      dshBackupHome(): Promise<{ ok: boolean; path?: string; error?: string }>
      dshRepairProfile(): Promise<{ ok: boolean; error?: string }>
      onDshUpgradeLog(cb: (chunk: string) => void): () => void
      onDshUpgradeDone(
        cb: (result: {
          ok: boolean
          from: string | null
          to: string
          reverted?: boolean
          error?: string
        }) => void,
      ): () => void

      // ---- 应用日志（core/app-log，logs 模块）----
      logsGet(query?: {
        source?: string
        level?: 'info' | 'warn' | 'error'
        limit?: number
      }): Promise<AppLogEntry[]>
      logsClear(): Promise<boolean>
      logsOpenDir(): Promise<boolean>
      onLogAppended(cb: (entry: AppLogEntry) => void): () => void
    }
  }
}
