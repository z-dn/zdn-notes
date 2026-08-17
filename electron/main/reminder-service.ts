import type { Database } from 'sql.js'
import type { Task } from '@/types/task'
import { getDueTasks } from './database/task-dao'

// ===================================================================
// 待办提醒调度器（纯 TS，不依赖 Electron，可单测）。
// 周期性扫描已到 reminder_time 的未完成任务，交给调用方触发通知。
// 去重状态按 任务id -> 已提醒的 reminderTime 记录：提醒时间被修改后
// 自动重新武装；应用重启后错过的提醒会补发。
// ===================================================================

export const DEFAULT_CHECK_INTERVAL_MS = 30_000

export interface ReminderServiceDeps {
  getDB: () => Database
  /** 是否启用提醒（每 tick 实时读取，开关即时生效） */
  isEnabled: () => boolean
  getNotifiedMap: () => Record<string, number>
  setNotifiedMap: (map: Record<string, number>) => void
  /** 对每一条到期未提醒过的任务触发一次 */
  onDue: (task: Task) => void
  intervalMs?: number
}

export interface EvaluateResult {
  toFire: Task[]
  next: Record<string, number>
}

/** 计算需要触发的任务与更新后的去重映射（纯函数，便于测试） */
export function evaluateDue(
  due: Task[],
  notified: Record<string, number>,
): EvaluateResult {
  const next = { ...notified }
  const toFire: Task[] = []
  for (const task of due) {
    if (task.reminderTime == null) continue
    if (next[task.id] === task.reminderTime) continue
    toFire.push(task)
    next[task.id] = task.reminderTime
  }
  return { toFire, next }
}

export interface ReminderService {
  stop: () => void
}

export function startReminderService(deps: ReminderServiceDeps): ReminderService {
  const intervalMs = deps.intervalMs ?? DEFAULT_CHECK_INTERVAL_MS
  let timer: NodeJS.Timeout | null = null
  let stopped = false

  const tick = () => {
    if (stopped) return
    try {
      if (!deps.isEnabled()) return
      const due = getDueTasks(Date.now(), deps.getDB())
      if (!due.length) return
      const { toFire, next } = evaluateDue(due, deps.getNotifiedMap())
      for (const task of toFire) deps.onDue(task)
      deps.setNotifiedMap(next)
    } catch (e) {
      console.error('[reminder]', e)
    }
  }

  tick()
  timer = setInterval(tick, intervalMs)

  return {
    stop: () => {
      stopped = true
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    },
  }
}
