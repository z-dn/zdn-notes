import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  taskCreate: (dto: unknown) => ipcRenderer.invoke('task:create', dto),
  taskGetAll: (filter: unknown) => ipcRenderer.invoke('task:getAll', filter),
  taskGetById: (id: string) => ipcRenderer.invoke('task:getById', id),
  taskUpdate: (dto: unknown) => ipcRenderer.invoke('task:update', dto),
  taskDelete: (id: string) => ipcRenderer.invoke('task:delete', id),
  taskUpdateStatus: (id: string, status: string) =>
    ipcRenderer.invoke('task:updateStatus', id, status),

  categoryCreate: (dto: unknown) => ipcRenderer.invoke('category:create', dto),
  categoryGetAll: () => ipcRenderer.invoke('category:getAll'),
  categoryUpdate: (id: string, data: unknown) => ipcRenderer.invoke('category:update', id, data),
  categoryDelete: (id: string) => ipcRenderer.invoke('category:delete', id),
  categoryGetTaskCounts: () => ipcRenderer.invoke('category:getTaskCounts'),

  windowMinimize: () => ipcRenderer.invoke('window:minimize'),
  windowMaximizeToggle: () => ipcRenderer.invoke('window:maximizeToggle'),
  windowClose: () => ipcRenderer.invoke('window:close'),
  setThemeSource: (source: string) => ipcRenderer.invoke('window:setThemeSource', source),
  onWindowMaximizedChange: (cb: (maximized: boolean) => void) => {
    const handler = (_e: unknown, v: boolean) => cb(v)
    ipcRenderer.on('window:maximizedChange', handler)
    return () => ipcRenderer.removeListener('window:maximizedChange', handler)
  },

  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  getFeatures: () => ipcRenderer.invoke('app:getFeatures'),

  exportMarkdown: () => ipcRenderer.invoke('task:exportMarkdown'),
  exportBackup: () => ipcRenderer.invoke('db:export'),
  importBackup: () => ipcRenderer.invoke('db:import'),
  getDataDir: () => ipcRenderer.invoke('db:getDataDir'),
  getDataDirFallback: () => ipcRenderer.invoke('db:getDataDirFallback'),
  chooseDataDir: () => ipcRenderer.invoke('db:chooseDataDir'),
  setDataDir: (path: string) => ipcRenderer.invoke('db:setDataDir', path),
  getInboxDir: () => ipcRenderer.invoke('inbox:getDir'),
  openInboxDir: () => ipcRenderer.invoke('inbox:openDir'),
  onInboxProcessed: (cb: (result: unknown) => void) => {
    const handler = (_e: unknown, result: unknown) => cb(result)
    ipcRenderer.on('inbox:processed', handler)
    return () => ipcRenderer.removeListener('inbox:processed', handler)
  },
  onDataChanged: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('data:changed', handler)
    return () => ipcRenderer.removeListener('data:changed', handler)
  },
  saveImageFromData: (dataUri: string) => ipcRenderer.invoke('image:saveFromData', dataUri),
  pickAndSaveImage: () => ipcRenderer.invoke('image:pickAndSave'),
  deleteImage: (url: string) => ipcRenderer.invoke('image:delete', url),
  settingsGetAll: () => ipcRenderer.invoke('settings:getAll'),
  settingsSet: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),

  mcpGetConfig: () => ipcRenderer.invoke('mcp:getConfig'),
  mcpSetConfig: (cfg: unknown) => ipcRenderer.invoke('mcp:setConfig', cfg),
  mcpGetCatalog: () => ipcRenderer.invoke('mcp:getCatalog'),
  mcpListPlugins: () => ipcRenderer.invoke('mcp:listPlugins'),
  mcpInstallPlugin: () => ipcRenderer.invoke('mcp:installPlugin'),
  mcpUninstallPlugin: (id: string) => ipcRenderer.invoke('mcp:uninstallPlugin', id),
  mcpGetPluginsDir: () => ipcRenderer.invoke('mcp:getPluginsDir'),
  onMcpCatalogChanged: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('mcp:catalogChanged', handler)
    return () => ipcRenderer.removeListener('mcp:catalogChanged', handler)
  },

  toolGetAll: () => ipcRenderer.invoke('tool:getAll'),
  toolSet: (key: string, value: string) => ipcRenderer.invoke('tool:set', key, value),
  httpRequest: (config: unknown) => ipcRenderer.invoke('http:request', config),

  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateChecking: (cb: () => void) => {
    const handler = () => cb()
    ipcRenderer.on('update:checking', handler)
    return () => ipcRenderer.removeListener('update:checking', handler)
  },
  onUpdateAvailable: (cb: (info: unknown) => void) => {
    const handler = (_e: unknown, info: unknown) => cb(info)
    ipcRenderer.on('update:available', handler)
    return () => ipcRenderer.removeListener('update:available', handler)
  },
  onUpdateNotAvailable: (cb: (info: unknown) => void) => {
    const handler = (_e: unknown, info: unknown) => cb(info)
    ipcRenderer.on('update:not-available', handler)
    return () => ipcRenderer.removeListener('update:not-available', handler)
  },
  onUpdateError: (cb: (msg: string) => void) => {
    const handler = (_e: unknown, msg: string) => cb(msg)
    ipcRenderer.on('update:error', handler)
    return () => ipcRenderer.removeListener('update:error', handler)
  },
  onUpdateProgress: (cb: (progress: unknown) => void) => {
    const handler = (_e: unknown, progress: unknown) => cb(progress)
    ipcRenderer.on('update:progress', handler)
    return () => ipcRenderer.removeListener('update:progress', handler)
  },
  onUpdateDownloaded: (cb: (info: unknown) => void) => {
    const handler = (_e: unknown, info: unknown) => cb(info)
    ipcRenderer.on('update:downloaded', handler)
    return () => ipcRenderer.removeListener('update:downloaded', handler)
  },
})
