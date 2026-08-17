import { app, Notification } from 'electron'
import { join } from 'path'
import { getMainWindow } from '../../main/window-store'
import { getAllSettings, setSetting } from '../../main/database/settings-dao'
import { startReminderService } from '../../main/reminder-service'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'
import type { Task } from '@/types/task'

// ===================================================================
// 待办任务提醒模块：主进程调度 + 原生系统通知。
// 到点对未完成任务弹系统通知，点击后唤起主窗口并定位到该任务。
// 开关读取 settings 表 reminderEnabled（每 tick 实时生效）。
// ===================================================================

const APP_USER_MODEL_ID = 'com.zdn.notes'
const NOTIFIED_SETTINGS_KEY = 'reminder.notified'

function iconPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'icon.png')
  }
  return join(__dirname, '../../resources/icon.png')
}

function formatBody(task: Task): string {
  const priority = task.priority !== 'P2' ? `[${task.priority}] ` : ''
  const title = `${priority}${task.title}`
  if (!task.dueDate) return title
  const due = new Date(task.dueDate).toLocaleString('zh-CN', {
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
  return `${title}\n截止 ${due}`
}

function loadNotifiedMap(): Record<string, number> {
  try {
    const raw = getAllSettings()[NOTIFIED_SETTINGS_KEY]
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, number>) : {}
  } catch {
    return {}
  }
}

let service: ReturnType<typeof startReminderService> | null = null

function onStart(ctx: MainModuleContext): void {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  if (!Notification.isSupported()) return
  service = startReminderService({
    getDB: ctx.getDB,
    isEnabled: () => getAllSettings().reminderEnabled !== 'false',
    getNotifiedMap: loadNotifiedMap,
    setNotifiedMap: (map) => setSetting(NOTIFIED_SETTINGS_KEY, JSON.stringify(map)),
    onDue: (task) => {
      const notification = new Notification({
        title: '待办提醒',
        body: formatBody(task),
        icon: iconPath(),
      })
      notification.on('click', () => {
        const win = getMainWindow()
        if (win) {
          if (win.isMinimized()) win.restore()
          if (!win.isVisible()) win.show()
          win.focus()
        }
        ctx.send('reminder:open', task.id)
      })
      notification.show()
    },
  })
}

function onShutdown(_ctx: MainModuleContext): void {
  service?.stop()
  service = null
}

export const notificationsModule: FeatureModule = {
  id: 'notifications',
  name: '任务提醒通知',
  kind: 'optional',
  defaultEnabled: true,
  onStart,
  onShutdown,
}
