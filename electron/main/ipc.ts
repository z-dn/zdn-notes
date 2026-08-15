import { app, ipcMain, dialog, shell, net } from 'electron'
import { randomUUID } from 'crypto'
import { writeFileSync, existsSync, copyFileSync, unlinkSync } from 'fs'
import { join, isAbsolute, relative } from 'path'
import {
  createTask,
  getTaskById,
  getAllTasks,
  updateTask,
  deleteTask,
  updateTaskStatus,
} from './database/task-dao'
import {
  createCategory,
  getAllCategories,
  updateCategory,
  deleteCategory,
  getCategoryTaskCounts,
} from './database/category-dao'
import { getAllSettings, setSetting } from './database/settings-dao'
import { getAllToolState, setToolState } from './database/tool-state-dao'
import { backupDatabase, restoreDatabase } from './backup'
import { getDB, reloadDB, getActiveDataDir, getDataDirFallback, isDBReady } from './database'
import {
  getDataDir,
  getImagesDir,
  copyDataTo,
  clearDataDir,
  writeDataDirConfig,
} from './data-location'
import { inboxDir } from './import-inbox'
import { isSafeImageFilename } from './image-utils'
import { isPrivateHost } from './net-utils'
import type { Task, Status } from '@/types/task'

export function registerIpcHandlers(): void {
  ipcMain.handle('task:create', (_e, dto) => createTask(dto))
  ipcMain.handle('task:getById', (_e, id) => getTaskById(id))
  ipcMain.handle('task:getAll', (_e, filter) => getAllTasks(filter))
  ipcMain.handle('task:update', (_e, dto) => updateTask(dto))
  ipcMain.handle('task:delete', (_e, id) => {
    const task = getTaskById(id)
    if (!task) return false

    const imageUrls = task.description?.match(/zdn-img:\/\/\/(\S+?)(?=[\s")}\]]|$)/g) || []

    const result = deleteTask(id)
    if (!result) return false

    if (imageUrls.length) {
      const imageDir = getImagesDir()
      const allTasks = getAllTasks()
      for (const url of imageUrls) {
        const filename = url.replace('zdn-img:///', '')
        if (!isSafeImageFilename(filename)) continue
        const stillUsed = allTasks.some((t) => t.description?.includes(filename))
        if (!stillUsed) {
          const filePath = join(imageDir, filename)
          try {
            if (existsSync(filePath)) unlinkSync(filePath)
          } catch {
            /* ignore */
          }
        }
      }
    }
    return true
  })
  ipcMain.handle('task:updateStatus', (_e, id, status) => updateTaskStatus(id, status))

  ipcMain.handle('category:create', (_e, dto) => createCategory(dto))
  ipcMain.handle('category:getAll', () => getAllCategories())
  ipcMain.handle('category:update', (_e, id, data) => updateCategory(id, data))
  ipcMain.handle('category:delete', (_e, id) => deleteCategory(id))
  ipcMain.handle('category:getTaskCounts', () => getCategoryTaskCounts())

  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('db:export', async () => {
    const result = await dialog.showSaveDialog({
      title: '备份数据',
      defaultPath: `zdn-notes-backup-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ name: 'ZDNotes 备份', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return false
    try {
      backupDatabase(result.filePath)
      return true
    } catch (e) {
      console.error('[db:export]', e)
      return false
    }
  })

  ipcMain.handle('db:import', async () => {
    const result = await dialog.showOpenDialog({
      title: '恢复数据',
      properties: ['openFile'],
      filters: [{ name: 'ZDNotes 备份', extensions: ['zip'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, error: '已取消' }
    try {
      await restoreDatabase(result.filePaths[0])
      return { ok: true }
    } catch (e) {
      console.error('[db:import]', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('db:getDataDir', () => getActiveDataDir())

  ipcMain.handle('db:getDataDirFallback', () => getDataDirFallback())

  ipcMain.handle('inbox:getDir', () => inboxDir())

  ipcMain.handle('inbox:openDir', async () => {
    const err = await shell.openPath(inboxDir())
    return err || true
  })

  ipcMain.handle('db:chooseDataDir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择数据存储位置',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('db:setDataDir', async (_e, target: string) => {
    const currentDir = getDataDir()
    const targetDir = target && target.trim() ? target.trim() : app.getPath('userData')
    if (targetDir === currentDir) return { ok: true, path: currentDir }
    if (!isAbsolute(targetDir)) return { ok: false, error: '存储位置必须是绝对路径' }
    const rel = relative(currentDir, targetDir)
    if (rel && !rel.startsWith('..') && !isAbsolute(rel)) {
      return { ok: false, error: '新位置不能是当前数据目录或其子目录' }
    }
    try {
      const oldImagesDir = getImagesDir()
      const dbBuffer = getDB().export()
      copyDataTo(targetDir, dbBuffer, oldImagesDir)
      await reloadDB(join(targetDir, 'zdn-notes.db'))
      writeDataDirConfig(targetDir)
      clearDataDir(currentDir)
      return { ok: true, path: targetDir }
    } catch (e) {
      console.error('[db:setDataDir]', e)
      if (!isDBReady()) {
        try {
          await reloadDB()
        } catch (e2) {
          console.error('[db:setDataDir] rollback failed', e2)
        }
      }
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })

  ipcMain.handle('settings:getAll', () => getAllSettings())
  ipcMain.handle('settings:set', (_e, key, value) => setSetting(key, value))

  ipcMain.handle('tool:getAll', () => getAllToolState())
  ipcMain.handle('tool:set', (_e, key, value) => setToolState(key, value))

  ipcMain.handle('http:request', async (_e, config) => {
    const method = String(config?.method ?? 'GET').toUpperCase()
    const url = String(config?.url ?? '').trim()
    const validMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

    if (!validMethods.includes(method)) {
      return { ok: false, error: `不支持的请求方法: ${method}` }
    }
    if (!/^https?:\/\//i.test(url)) {
      return { ok: false, error: 'URL 必须以 http:// 或 https:// 开头' }
    }

    try {
      const settings = getAllSettings()
      if (settings.allowLocalRequests !== 'true' && (await isPrivateHost(new URL(url).hostname))) {
        return { ok: false, error: '禁止访问内网/本机地址（可在设置中开启）' }
      }
    } catch {
      // invalid URL: let the request below produce its own error
    }

    const headers: Record<string, string> = {}
    if (Array.isArray(config?.headers)) {
      for (const h of config.headers) {
        const key = String(h?.key ?? '').trim()
        if (!key) continue
        const value = h?.value == null ? '' : String(h.value)
        headers[key] = headers[key] === undefined ? value : `${headers[key]}, ${value}`
      }
    }

    const rawBody = config?.body == null ? '' : String(config.body)
    const body = method === 'HEAD' || rawBody === '' ? undefined : rawBody

    const startedAt = Date.now()
    try {
      const res = await net.fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(15000),
      })
      const resHeaders: Record<string, string> = {}
      res.headers.forEach((value, key) => {
        resHeaders[key] = resHeaders[key] === undefined ? value : `${resHeaders[key]}, ${value}`
      })
      const raw = method === 'HEAD' ? '' : await res.text()
      return {
        ok: true,
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: raw,
        timeMs: Date.now() - startedAt,
        size: Buffer.byteLength(raw, 'utf-8'),
      }
    } catch (e) {
      const name = e instanceof Error ? e.name : ''
      let message = e instanceof Error ? e.message : String(e)
      if (name === 'TimeoutError' || name === 'AbortError') message = '请求超时（15s）'
      if (name === 'ERR_FAILED') message = '网络错误，无法连接到服务器'
      return { ok: false, error: message }
    }
  })

  ipcMain.handle('image:saveFromData', (_e, dataUri: string) => {
    const matches = dataUri.match(/^data:image\/([a-z0-9.+-]+);base64,(.+)$/i)
    if (!matches) throw new Error('Invalid image data URI')
    let ext = matches[1].toLowerCase()
    if (ext === 'jpeg') ext = 'jpg'
    if (ext === 'svg+xml') ext = 'svg'
    if (ext === 'x-icon' || ext === 'vnd.microsoft.icon') ext = 'ico'
    const buffer = Buffer.from(matches[2], 'base64')
    const imageDir = getImagesDir()
    const filename = `${randomUUID()}.${ext}`
    writeFileSync(join(imageDir, filename), buffer)
    return `zdn-img:///${filename}`
  })

  ipcMain.handle('image:pickAndSave', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    const srcPath = result.filePaths[0]
    const ext = srcPath.split('.').pop()?.toLowerCase() || 'png'
    const imageDir = getImagesDir()
    const filename = `${randomUUID()}.${ext}`
    copyFileSync(srcPath, join(imageDir, filename))
    return `zdn-img:///${filename}`
  })

  ipcMain.handle('image:delete', (_e, url: string) => {
    const filename = url.replace('zdn-img:///', '')
    if (!isSafeImageFilename(filename)) return
    const filePath = join(getImagesDir(), filename)
    if (existsSync(filePath)) unlinkSync(filePath)
  })

  ipcMain.handle('task:exportMarkdown', async () => {
    const tasks = getAllTasks()
    const lines: string[] = []
    lines.push('# ZDNotes 任务导出', '')
    lines.push(`导出时间: ${new Date().toLocaleString('zh-CN')}`, '')
    lines.push(`任务总数: ${tasks.length}`, '')

    const childrenOf = new Map<string, Task[]>()
    const roots: Task[] = []
    for (const t of tasks) {
      if (t.parentId) {
        if (!childrenOf.has(t.parentId)) childrenOf.set(t.parentId, [])
        childrenOf.get(t.parentId)!.push(t)
      } else {
        roots.push(t)
      }
    }

    function statusCheckbox(s: Status): string {
      if (s === 'todo') return '[ ]'
      if (s === 'done') return '[x]'
      return '[~]'
    }

    function renderTask(t: Task, depth: number) {
      const indent = '  '.repeat(depth)
      const badge = t.priority !== 'P2' ? ` \`${t.priority}\`` : ''
      const tagStr = t.tags.length ? ' ' + t.tags.map((x) => `#${x}`).join(' ') : ''
      const proj = t.owner ? ` @${t.owner}` : ''
      const start = t.startDate ? ` 🚀${new Date(t.startDate).toLocaleDateString('zh-CN')}` : ''
      const due = t.dueDate ? ` 📅${new Date(t.dueDate).toLocaleDateString('zh-CN')}` : ''
      lines.push(
        `${indent}- ${statusCheckbox(t.status)} **${t.title}**${badge}${tagStr}${proj}${start}${due}`,
      )
      if (t.description) {
        const firstLine = t.description.split('\n')[0].trim()
        if (firstLine) lines.push(`${indent}  > ${firstLine}`)
      }
      const kids = childrenOf.get(t.id) ?? []
      for (const kid of kids) renderTask(kid, depth + 1)
    }

    const sections: { status: Status; icon: string; label: string }[] = [
      { status: 'todo', icon: '📋', label: '待办' },
      { status: 'done', icon: '✅', label: '已完成' },
    ]

    for (const { status, icon, label } of sections) {
      const sectionRoots = roots.filter((t) => t.status === status)
      if (sectionRoots.length === 0) continue
      lines.push('', `## ${icon} ${label} (${sectionRoots.length})`, '')
      for (const t of sectionRoots) renderTask(t, 0)
    }

    const content = lines.join('\n')
    const result = await dialog.showSaveDialog({
      title: '导出任务为 Markdown',
      defaultPath: `zdn-notes-${new Date().toISOString().slice(0, 10)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    })
    if (result.canceled || !result.filePath) return false
    writeFileSync(result.filePath, content, 'utf-8')
    return true
  })
}
