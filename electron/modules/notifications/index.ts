import { app, Notification, shell } from 'electron'
import { join } from 'path'
import { getMainWindow } from '../../main/window-store'
import { getAllSettings, setSetting } from '../../main/database/settings-dao'
import { startReminderService } from '../../main/reminder-service'
import { ipcMain } from 'electron'
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
let lastNotificationFailed = false

function registerIpc(_ctx: MainModuleContext): void {
  ipcMain.handle('notification:checkPermission', async () => {
    const supported = Notification.isSupported()
    if (!supported) return { supported: false, granted: false }

    // 基于最近一次真实通知的结果判断
    if (lastNotificationFailed) {
      return { supported: true, granted: false }
    }

    // 如果没有失败记录，发送测试通知检测
    return new Promise<{ supported: boolean; granted: boolean }>((resolve) => {
      let resolved = false
      const test = new Notification({
        title: '通知权限检测',
        body: '如果看到此消息，说明通知权限正常',
        silent: false,
      })

      test.on('failed', () => {
        if (!resolved) {
          resolved = true
          lastNotificationFailed = true
          resolve({ supported: true, granted: false })
        }
      })

      test.on('show', () => {
        // show 触发不代表成功，等 1秒看是否有 failed
        setTimeout(() => {
          if (!resolved) {
            resolved = true
            lastNotificationFailed = false
            test.close()
            resolve({ supported: true, granted: true })
          }
        }, 1000)
      })

      setTimeout(() => {
        if (!resolved) {
          resolved = true
          test.close()
          resolve({ supported: true, granted: false })
        }
      }, 3000)

      test.show()
    })
  })

  ipcMain.handle('notification:openSettings', async () => {
    shell.openExternal('ms-settings:notifications')
  })
}

function onStart(ctx: MainModuleContext): void {
  app.setAppUserModelId(APP_USER_MODEL_ID)
  if (!Notification.isSupported()) return
  service = startReminderService({
    getDB: ctx.getDB,
    isEnabled: () => getAllSettings().reminderEnabled !== 'false',
    getNotifiedMap: loadNotifiedMap,
    setNotifiedMap: (map) => setSetting(NOTIFIED_SETTINGS_KEY, JSON.stringify(map)),
    onDue: (task) => {
      console.log('[reminder] firing for task:', task.id, task.title, 'reminderTime:', task.reminderTime)
      const notification = new Notification({
        title: '待办提醒',
        body: formatBody(task),
        icon: iconPath(),
      })
      notification.on('show', () => console.log('[reminder] notification shown for:', task.id))
      notification.on('failed', (_e, error) => {
        console.error('[reminder] notification failed for:', task.id, error)
        lastNotificationFailed = true
        ctx.send('reminder:notificationFailed', task.id)
      })
      notification.on('click', () => {
        console.log('[reminder] notification clicked for:', task.id)
        notification.close()
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
  registerIpc,
  onStart,
  onShutdown,
}
