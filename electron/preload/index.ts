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

  exportMarkdown: () => ipcRenderer.invoke('task:exportMarkdown'),
})
