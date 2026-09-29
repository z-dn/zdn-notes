import {
  addDays,
  differenceInCalendarDays,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'
import type { Task } from '@/types/task'
import { PRIORITY_ORDER } from './task-list-view'

/** 跨天区间超过该天数时，只在首尾两天归格（防极端数据爆桶） */
export const RANGE_DAY_LIMIT = 90

export function dayKey(ts: number | Date): string {
  return format(typeof ts === 'number' ? new Date(ts) : ts, 'yyyy-MM-dd')
}

function byPriorityThenTitle(a: Task, b: Task): number {
  const pa = PRIORITY_ORDER[a.priority] ?? 2
  const pb = PRIORITY_ORDER[b.priority] ?? 2
  if (pa !== pb) return pa - pb
  return a.title.localeCompare(b.title)
}

export interface TaskRange {
  start: number
  end: number
}

/** 任务的日期区间（start = startDate ?? dueDate，end = dueDate ?? startDate）；两者皆空返回 null */
export function taskRange(task: Task): TaskRange | null {
  if (task.dueDate == null && task.startDate == null) return null
  const a = task.startDate ?? task.dueDate!
  const b = task.dueDate ?? task.startDate!
  return a <= b ? { start: a, end: b } : { start: b, end: a }
}

/** 待办且截止日期早于今天零点（当天到期不算逾期） */
export function isOverdue(task: Task, now = Date.now()): boolean {
  return task.status === 'todo' && task.dueDate != null && task.dueDate < startOfDay(now).getTime()
}

/** 父任务对子任务的宽松约束端点：lower = 父 startDate（未设则无下界），upper = 父 dueDate（未设则无上界） */
export interface ParentBounds {
  lower: number | null
  upper: number | null
}

export function parentBounds(parent: Task): ParentBounds {
  return { lower: parent.startDate ?? null, upper: parent.dueDate ?? null }
}

/** 子任务日期范围是否越出父任务（宽松包含）；子任务无日期或无父任务时永不违反 */
export function violatesParentRange(child: Task, parent: Task | null | undefined): boolean {
  if (!parent) return false
  const range = taskRange(child)
  if (!range) return false
  const { lower, upper } = parentBounds(parent)
  return (lower != null && range.start < lower) || (upper != null && range.end > upper)
}

const DAY_MS = 86_400_000

function clampPoint(ts: number, bounds?: ParentBounds | null): number {
  let out = ts
  if (bounds?.lower != null && out < bounds.lower) out = bounds.lower
  if (bounds?.upper != null && out > bounds.upper) out = bounds.upper
  return out
}

/** 在保时长的前提下把平移天数收窄到父任务范围内（拖过头停在边界） */
function clampDelta(range: TaskRange, delta: number, bounds: ParentBounds): number {
  let d = delta
  if (bounds.lower != null) d = Math.max(d, Math.ceil((bounds.lower - range.start) / DAY_MS))
  if (bounds.upper != null) d = Math.min(d, Math.floor((bounds.upper - range.end) / DAY_MS))
  return d
}

export interface DropPatch {
  startDate?: number | null
  dueDate?: number | null
  /** 结果被父任务范围夹紧过（供调用方提示） */
  clamped?: boolean
}

/**
 * 拖拽/快捷改期的字段增量。
 * - fromKey 为空（从未设置日期拖入）：设 dueDate 为当天 23:59
 * - 否则按 fromKey → toKey 的天数差整体平移已有日期（保留时分）
 * - bounds 提供时把结果夹进父任务范围（先收窄 delta 保时长，越界端点兜底夹紧）
 */
export function taskDropUpdate(
  task: Task,
  fromKey: string | null,
  toKey: string,
  bounds?: ParentBounds | null,
): DropPatch {
  if (fromKey == null) {
    const d = parseISO(toKey)
    d.setHours(23, 59, 0, 0)
    const point = clampPoint(d.getTime(), bounds)
    return { dueDate: point, ...(point !== d.getTime() ? { clamped: true } : {}) }
  }
  const delta = differenceInCalendarDays(parseISO(toKey), parseISO(fromKey))
  if (delta === 0) return {}
  const out: DropPatch = {}
  const range = taskRange(task)
  const d = range && bounds ? clampDelta(range, delta, bounds) : delta
  let clamped = d !== delta
  if (task.dueDate != null) out.dueDate = addDays(task.dueDate, d).getTime()
  if (task.startDate != null) out.startDate = addDays(task.startDate, d).getTime()
  if (out.dueDate == null && out.startDate == null) {
    const pd = parseISO(toKey)
    pd.setHours(23, 59, 0, 0)
    out.dueDate = pd.getTime()
  }
  if (bounds) {
    if (out.dueDate != null) {
      const c = clampPoint(out.dueDate, bounds)
      if (c !== out.dueDate) {
        out.dueDate = c
        clamped = true
      }
    }
    if (out.startDate != null) {
      const c = clampPoint(out.startDate, bounds)
      if (c !== out.startDate) {
        out.startDate = c
        clamped = true
      }
    }
  }
  return clamped ? { ...out, clamped: true } : out
}

export interface CalendarGroup {
  byDay: Map<string, Task[]>
  unscheduled: Task[]
}

/**
 * 按日期区间归入本地日期格（yyyy-MM-dd）；无任何日期进 unscheduled；
 * 区间内每一天都入同一桶；桶内按优先级、标题排序
 */
export function groupTasksByDueDay(tasks: Task[]): CalendarGroup {
  const byDay = new Map<string, Task[]>()
  const unscheduled: Task[] = []
  const push = (key: string, task: Task) => {
    const bucket = byDay.get(key)
    if (bucket) bucket.push(task)
    else byDay.set(key, [task])
  }
  for (const task of tasks) {
    const range = taskRange(task)
    if (!range) {
      unscheduled.push(task)
      continue
    }
    const startKey = dayKey(range.start)
    const endKey = dayKey(range.end)
    if (startKey === endKey) {
      push(startKey, task)
      continue
    }
    const days = eachDayOfInterval({
      start: startOfDay(range.start),
      end: startOfDay(range.end),
    })
    if (days.length > RANGE_DAY_LIMIT) {
      push(startKey, task)
      push(endKey, task)
      continue
    }
    for (const day of days) push(dayKey(day), task)
  }
  for (const bucket of byDay.values()) bucket.sort(byPriorityThenTitle)
  unscheduled.sort(byPriorityThenTitle)
  return { byDay, unscheduled }
}

export interface MonthCell {
  date: Date
  key: string
  inMonth: boolean
}

/** 锚点月份的月视图格子：周一起始，含前后补位日，长度恒为 7 的倍数 */
export function buildMonthGrid(anchor: Date): MonthCell[] {
  const start = startOfWeek(startOfMonth(anchor), { weekStartsOn: 1 })
  const end = endOfWeek(endOfMonth(anchor), { weekStartsOn: 1 })
  return eachDayOfInterval({ start, end }).map((date) => ({
    date,
    key: dayKey(date),
    inMonth: isSameMonth(date, anchor),
  }))
}
