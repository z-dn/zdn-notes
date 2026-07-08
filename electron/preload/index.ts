import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  taskCreate: (dto: unknown) => ipcRenderer.invoke('task:create', dto),
  taskGetAll: () => ipcRenderer.invoke('task:getAll'),
  taskGetById: (id: string) => ipcRenderer.invoke('task:getById', id),
  taskUpdate: (dto: unknown) => ipcRenderer.invoke('task:update', dto),
  taskDelete: (id: string) => ipcRenderer.invoke('task:delete', id),
  taskUpdateStatus: (id: string, status: string) => ipcRenderer.invoke('task:updateStatus', id, status),

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
    return () => ipcRenderer.removeAllListeners('window:maximizedChange')
  },

  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),

  exportMarkdown: () => ipcRenderer.invoke('task:exportMarkdown'),
  settingsGetAll: () => ipcRenderer.invoke('settings:getAll'),
  settingsSet: (key: string, value: string) => ipcRenderer.invoke('settings:set', key, value),

  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateChecking: (cb: () => void) => {
    ipcRenderer.on('update:checking', () => cb())
    return () => ipcRenderer.removeAllListeners('update:checking')
  },
  onUpdateAvailable: (cb: (info: unknown) => void) => {
    ipcRenderer.on('update:available', (_e, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('update:available')
  },
  onUpdateNotAvailable: (cb: (info: unknown) => void) => {
    ipcRenderer.on('update:not-available', (_e, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('update:not-available')
  },
  onUpdateError: (cb: (msg: string) => void) => {
    ipcRenderer.on('update:error', (_e, msg) => cb(msg))
    return () => ipcRenderer.removeAllListeners('update:error')
  },
  onUpdateProgress: (cb: (progress: unknown) => void) => {
    ipcRenderer.on('update:progress', (_e, progress) => cb(progress))
    return () => ipcRenderer.removeAllListeners('update:progress')
  },
  onUpdateDownloaded: (cb: (info: unknown) => void) => {
    ipcRenderer.on('update:downloaded', (_e, info) => cb(info))
    return () => ipcRenderer.removeAllListeners('update:downloaded')
  },
})
