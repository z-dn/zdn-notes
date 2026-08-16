import { ipcMain, dialog } from 'electron'
import { writeFileSync, existsSync, unlinkSync } from 'fs'
import { join } from 'path'
import {
  createTask,
  getTaskById,
  getAllTasks,
  updateTask,
  deleteTask,
  updateTaskStatus,
} from '../../main/database/task-dao'
import { getImagesDir } from '../../main/data-location'
import { isSafeImageFilename } from '../../main/image-utils'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'
import { TASK_TOOLS } from './tools'
import type { Task, Status } from '@/types/task'

async function exportMarkdown(): Promise<boolean> {
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
}

function registerIpc(_ctx: MainModuleContext): void {
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
  ipcMain.handle('task:exportMarkdown', exportMarkdown)
}

export const tasksModule: FeatureModule = {
  id: 'tasks',
  name: '待办任务',
  kind: 'core',
  defaultEnabled: true,
  registerIpc,
  agentTools: TASK_TOOLS,
  renderer: {
    view: { id: 'categories', label: '待办项' },
  },
}