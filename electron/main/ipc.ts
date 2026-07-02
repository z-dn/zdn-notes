import { ipcMain, dialog } from 'electron'
import { writeFileSync } from 'fs'
import { createTask, getTaskById, getAllTasks, updateTask, deleteTask, updateTaskStatus } from './database/task-dao'
import { createCategory, getAllCategories, updateCategory, deleteCategory, getCategoryTaskCounts } from './database/category-dao'
import type { Task, Status } from '@/types/task'

export function registerIpcHandlers(): void {
  ipcMain.handle('task:create', (_e, dto) => createTask(dto))
  ipcMain.handle('task:getById', (_e, id) => getTaskById(id))
  ipcMain.handle('task:getAll', () => getAllTasks())
  ipcMain.handle('task:update', (_e, dto) => updateTask(dto))
  ipcMain.handle('task:delete', (_e, id) => deleteTask(id))
  ipcMain.handle('task:updateStatus', (_e, id, status) => updateTaskStatus(id, status))

  ipcMain.handle('category:create', (_e, dto) => createCategory(dto))
  ipcMain.handle('category:getAll', () => getAllCategories())
  ipcMain.handle('category:update', (_e, id, data) => updateCategory(id, data))
  ipcMain.handle('category:delete', (_e, id) => deleteCategory(id))
  ipcMain.handle('category:getTaskCounts', () => getCategoryTaskCounts())

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
      if (s === 'in_progress') return '[/]'
      if (s === 'done') return '[x]'
      return '[~]'
    }

    function renderTask(t: Task, depth: number) {
      const indent = '  '.repeat(depth)
      const badge = t.priority !== 'P2' ? ` \`${t.priority}\`` : ''
      const tagStr = t.tags.length ? ' ' + t.tags.map((x) => `#${x}`).join(' ') : ''
      const proj = t.project ? ` @${t.project}` : ''
      const due = t.dueDate ? ` 📅${new Date(t.dueDate).toLocaleDateString('zh-CN')}` : ''
      lines.push(`${indent}- ${statusCheckbox(t.status)} **${t.title}**${badge}${tagStr}${proj}${due}`)
      if (t.description) {
        const firstLine = t.description.split('\n')[0].trim()
        if (firstLine) lines.push(`${indent}  > ${firstLine}`)
      }
      const kids = childrenOf.get(t.id) ?? []
      for (const kid of kids) renderTask(kid, depth + 1)
    }

    const sections: { status: Status; icon: string; label: string }[] = [
      { status: 'todo', icon: '📋', label: '待办' },
      { status: 'in_progress', icon: '🔄', label: '进行中' },
      { status: 'done', icon: '✅', label: '已完成' },
      { status: 'cancelled', icon: '❌', label: '已取消' },
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
