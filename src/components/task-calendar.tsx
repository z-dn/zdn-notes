import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { addDays, addMonths, format, isToday, nextMonday, startOfDay, startOfMonth } from 'date-fns'
import { Bell, ChevronLeft, ChevronRight, ListTree } from 'lucide-react'
import { useTaskStore } from '@/stores/task-store'
import { Checkbox } from '@/components/ui/checkbox'
import { ChipSubtaskTree } from './chip-subtask-tree'
import { Collapse } from './fade'
import { Tip } from '@/components/tip-button'
import {
  buildMonthGrid,
  dayKey,
  groupTasksByDueDay,
  isOverdue,
  parentBounds,
  taskDropUpdate,
  taskRange,
} from './task-calendar-view'
import { toast } from '@/lib/toast'
import type { Task } from '@/types/task'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']
const MAX_DAY_TASKS = 3

const PRIORITY_DOTS: Record<string, string> = {
  P0: 'bg-red-500',
  P1: 'bg-orange-500',
  P2: 'bg-blue-500',
  P3: 'bg-green-500',
}

export interface ChipProgress {
  done: number
  total: number
}

interface ChipProps {
  task: Task
  fromKey: string | null
  dueDay: boolean
  dimmed: boolean
  selected: boolean
  progress?: ChipProgress
  /** 跨天区间的当日段：left/right 表示该端需要圆角（区间端点或周行端点） */
  segment?: { left: boolean; right: boolean }
  onSelect: (t: Task) => void
  onToggleDone: (id: string, status: string) => void
  onOpenSubtree: (task: Task, anchor: DOMRect) => void
  onDragStart: (task: Task, fromKey: string | null, e: React.DragEvent) => void
  onContextMenu: (task: Task, fromKey: string | null, e: React.MouseEvent) => void
}

const TaskChip = memo(function TaskChip({
  task,
  fromKey,
  dueDay,
  dimmed,
  selected,
  progress,
  segment,
  onSelect,
  onToggleDone,
  onOpenSubtree,
  onDragStart,
  onContextMenu,
}: ChipProps) {
  const isDone = task.status === 'done'
  const overdue = isOverdue(task)
  const dim = dimmed || (!dueDay && !segment)
  const showBell = task.reminderTime != null && !isDone
  const segShape = segment
    ? `${segment.left ? '' : 'rounded-l-none'} ${segment.right ? '' : 'rounded-r-none'}`
    : ''
  const segTag = segment
    ? segment.left && segment.right
      ? 'lr'
      : segment.left
        ? 'l'
        : segment.right
          ? 'r'
          : 'm'
    : undefined
  return (
    <div
      role="button"
      tabIndex={0}
      data-cal-task-id={task.id}
      data-range-seg={segTag}
      draggable
      onDragStart={(e) => onDragStart(task, fromKey, e)}
      onContextMenu={(e) => {
        e.stopPropagation()
        e.preventDefault()
        onContextMenu(task, fromKey, e)
      }}
      onClick={(e) => {
        e.stopPropagation()
        onSelect(task)
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect(task)
        }
      }}
      className={`group flex ${segment ? '-mx-1' : 'w-full'} cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-left text-[11px] transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${segShape} ${
        selected ? 'bg-accent' : ''
      } ${isDone ? 'text-muted-foreground line-through' : ''} ${dim ? 'opacity-60' : ''}`}
    >
      <span className="relative flex size-2.5 shrink-0 items-center justify-center">
        <span
          aria-hidden
          className={`size-1.5 rounded-full ${
            PRIORITY_DOTS[task.priority] ?? PRIORITY_DOTS.P2
          } ${isDone ? 'invisible' : 'group-hover:invisible'}`}
        />
        <Checkbox
          checked={isDone}
          onCheckedChange={() => onToggleDone(task.id, task.status)}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          className={`absolute inset-0 size-full shadow-none [&_svg]:size-2 ${
            isDone ? '' : 'opacity-0 group-hover:opacity-100'
          }`}
        />
      </span>
      <span className={`min-w-0 flex-1 truncate ${overdue ? 'text-destructive' : ''}`}>
        {task.title}
      </span>
      {progress && (
        <button
          type="button"
          data-subtree-entry
          onClick={(e) => {
            e.stopPropagation()
            onOpenSubtree(task, e.currentTarget.getBoundingClientRect())
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className="shrink-0 cursor-pointer rounded text-[10px] tabular-nums text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {progress.done}/{progress.total}
        </button>
      )}
      <button
        type="button"
        aria-label="管理子任务"
        data-subtree-entry
        onClick={(e) => {
          e.stopPropagation()
          onOpenSubtree(task, e.currentTarget.getBoundingClientRect())
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="shrink-0 text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
      >
        <ListTree className="size-3" />
      </button>
      {showBell && <Bell className="size-3 shrink-0 text-muted-foreground/70" />}
    </div>
  )
})

interface DragPayload {
  task: Task
  fromKey: string | null
}

interface MenuState {
  x: number
  y: number
  task: Task
  fromKey: string | null
}

export function TaskCalendar({ categoryId }: { categoryId: string | null }) {
  const tasks = useTaskStore((s) => s.tasks)
  const statusView = useTaskStore((s) => s.statusView)
  const selectTask = useTaskStore((s) => s.selectTask)
  const selectedTask = useTaskStore((s) => s.selectedTask)
  const updateTask = useTaskStore((s) => s.updateTask)
  const toggleDone = useTaskStore((s) => s.toggleDone)
  const [anchor, setAnchor] = useState(() => startOfMonth(new Date()))
  const [expandedDay, setExpandedDay] = useState<string | null>(null)
  const [showUnscheduled, setShowUnscheduled] = useState(false)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [subtree, setSubtree] = useState<{ root: Task; style: CSSProperties } | null>(null)
  const dragRef = useRef<DragPayload | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const todayStart = useMemo(() => startOfDay(new Date()).getTime(), [])

  useEffect(() => {
    setExpandedDay(null)
    setMenu(null)
    setSubtree(null)
  }, [anchor])

  useEffect(() => {
    const onDragEnd = () => {
      dragRef.current = null
      setDragOverKey(null)
    }
    document.addEventListener('dragend', onDragEnd)
    return () => document.removeEventListener('dragend', onDragEnd)
  }, [])

  useEffect(() => {
    if (!menu) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenu(null)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const visibleTasks = useMemo(() => {
    let list = categoryId ? tasks.filter((t) => t.categoryId === categoryId) : tasks
    if (statusView === 'todo') list = list.filter((t) => t.status === 'todo')
    else if (statusView === 'done') list = list.filter((t) => t.status === 'done')
    return list
  }, [tasks, categoryId, statusView])

  const { byDay, unscheduled } = useMemo(() => groupTasksByDueDay(visibleTasks), [visibleTasks])
  const grid = useMemo(() => buildMonthGrid(anchor), [anchor])
  const progressMap = useMemo(() => {
    const counts = new Map<string, ChipProgress>()
    for (const t of tasks) {
      if (t.parentId == null) continue
      const c = counts.get(t.parentId) ?? { done: 0, total: 0 }
      c.total++
      if (t.status === 'done') c.done++
      counts.set(t.parentId, c)
    }
    return counts
  }, [tasks])
  const selectedId = selectedTask?.id

  const handleChipDragStart = useCallback(
    (task: Task, fromKey: string | null, e: React.DragEvent) => {
      e.dataTransfer.effectAllowed = 'move'
      e.dataTransfer.setData('text/plain', task.id)
      dragRef.current = { task, fromKey }
    },
    [],
  )

  const openMenu = useCallback((task: Task, fromKey: string | null, e: React.MouseEvent) => {
    const rect = rootRef.current?.getBoundingClientRect()
    if (!rect) return
    setSubtree(null)
    setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, task, fromKey })
  }, [])

  const openSubtree = useCallback(
    (root: Task, anchor: DOMRect) => {
      if (subtree?.root.id === root.id) {
        setSubtree(null)
        return
      }
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      setMenu(null)
      const relTop = anchor.top - rect.top
      const relBottom = anchor.bottom - rect.top
      const left = Math.max(0, Math.min(anchor.left - rect.left, rect.width - 244))
      const style: CSSProperties =
        relBottom + 256 > rect.height
          ? { left, bottom: Math.max(0, rect.height - relTop + 4) }
          : { left, top: relBottom + 4 }
      setSubtree({ root, style })
    },
    [subtree],
  )

  const applyDrop = useCallback(
    (task: Task, fromKey: string | null, toKey: string) => {
      const parentTask = task.parentId ? (tasks.find((t) => t.id === task.parentId) ?? null) : null
      const { clamped, ...fields } = taskDropUpdate(
        task,
        fromKey,
        toKey,
        parentTask ? parentBounds(parentTask) : null,
      )
      if (clamped) toast('已限制在父任务日期范围内')
      if (fields.dueDate !== undefined || fields.startDate !== undefined) {
        updateTask({ id: task.id, ...fields })
      }
    },
    [updateTask, tasks],
  )

  const quickMove = (toKey: string) => {
    if (menu) applyDrop(menu.task, menu.fromKey, toKey)
    setMenu(null)
  }

  const clearDates = () => {
    if (menu) updateTask({ id: menu.task.id, dueDate: null, startDate: null })
    setMenu(null)
  }

  const toggleMenuDone = () => {
    if (menu) toggleDone(menu.task.id, menu.task.status)
    setMenu(null)
  }

  const menuTask = menu?.task
  const canClear = menuTask ? taskRange(menuTask) != null : false

  return (
    <div ref={rootRef} className="relative flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-1 border-b border-divider pb-1.5 text-[11px] text-muted-foreground/60">
        <Tip tip="上个月">
          <button
            onClick={() => setAnchor((a) => addMonths(a, -1))}
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />
          </button>
        </Tip>
        <span className="font-medium text-foreground">{format(anchor, 'yyyy年M月')}</span>
        <Tip tip="下个月">
          <button
            onClick={() => setAnchor((a) => addMonths(a, 1))}
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className="size-3.5" />
          </button>
        </Tip>
        <Tip tip="回到本月">
          <button
            onClick={() => setAnchor(startOfMonth(new Date()))}
            className="ml-auto rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
          >
            今天
          </button>
        </Tip>
      </div>

      <div className="grid grid-cols-7 text-center text-[11px] text-muted-foreground/60">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1">
            {w}
          </div>
        ))}
      </div>

      <div
        className="grid min-h-0 flex-1 auto-rows-fr grid-cols-7 border-t border-divider"
        onClick={() => selectTask(null)}
      >
        {grid.map((cell, cellIdx) => {
          const list = byDay.get(cell.key)
          const expanded = expandedDay === cell.key && !!list
          const shown = list ? (expanded ? list : list.slice(0, MAX_DAY_TASKS)) : []
          const hiddenCount = list ? list.length - shown.length : 0
          const today = isToday(cell.date)
          const pastRed =
            cell.date.getTime() < todayStart && !!list?.some((t) => t.status === 'todo')
          const isDropTarget = dragOverKey === cell.key
          return (
            <div
              key={cell.key}
              onDragOver={(e) => {
                if (!dragRef.current) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
                setDragOverKey(cell.key)
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragOverKey(null)
              }}
              onDrop={(e) => {
                e.preventDefault()
                const payload = dragRef.current
                dragRef.current = null
                setDragOverKey(null)
                if (payload) applyDrop(payload.task, payload.fromKey, cell.key)
              }}
              className={`min-w-0 overflow-hidden border-r border-b border-divider p-1 [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0 ${
                cell.inMonth ? '' : 'text-muted-foreground/50'
              } ${isDropTarget ? 'bg-accent' : ''}`}
            >
              <div className="mb-0.5 flex items-center gap-1 px-0.5">
                {cell.inMonth ? (
                  <span
                    className={`inline-block rounded px-1 text-[11px] ${
                      today ? 'bg-accent font-medium text-foreground ring-1 ring-ring/40' : ''
                    } ${pastRed ? 'text-destructive' : ''}`}
                  >
                    {cell.date.getDate()}
                  </span>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setAnchor(startOfMonth(cell.date))
                    }}
                    className={`rounded px-1 text-[11px] transition-colors hover:bg-accent hover:text-foreground ${
                      pastRed ? 'text-destructive' : ''
                    }`}
                  >
                    {cell.date.getDate()}
                  </button>
                )}
                {!!list?.length && (
                  <span className="ml-auto text-[10px] text-muted-foreground/70">
                    {list.length}
                  </span>
                )}
              </div>
              <div className="space-y-0.5">
                {shown.map((t) => {
                  const range = taskRange(t)
                  const col = cellIdx % 7
                  const segment =
                    range && dayKey(range.start) !== dayKey(range.end)
                      ? {
                          left: dayKey(range.start) === cell.key || col === 0,
                          right: dayKey(range.end) === cell.key || col === 6,
                        }
                      : undefined
                  return (
                    <TaskChip
                      key={t.id}
                      task={t}
                      fromKey={cell.key}
                      dueDay={t.dueDate == null || dayKey(t.dueDate) === cell.key}
                      dimmed={statusView === 'all' && t.status === 'done'}
                      selected={t.id === selectedId}
                      progress={progressMap.get(t.id)}
                      segment={segment}
                      onSelect={selectTask}
                      onToggleDone={toggleDone}
                      onOpenSubtree={openSubtree}
                      onDragStart={handleChipDragStart}
                      onContextMenu={openMenu}
                    />
                  )
                })}
                {hiddenCount > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedDay(cell.key)
                    }}
                    className="w-full rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    +{hiddenCount}
                  </button>
                )}
                {expanded && list && list.length > MAX_DAY_TASKS && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setExpandedDay(null)
                    }}
                    className="w-full rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    收起
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {unscheduled.length > 0 && (
        <div className="shrink-0 border-t border-divider">
          <button
            onClick={() => setShowUnscheduled((v) => !v)}
            className="flex w-full items-center gap-1 px-1 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <span>{showUnscheduled ? '▾' : '▸'}</span>
            未设置日期 ({unscheduled.length})
          </button>
          <Collapse open={showUnscheduled} openClass="h-40">
            <div className="h-full space-y-0.5 overflow-y-auto p-1 pt-0">
              {unscheduled.map((t) => (
                <TaskChip
                  key={t.id}
                  task={t}
                  fromKey={null}
                  dueDay
                  dimmed={statusView === 'all' && t.status === 'done'}
                  selected={t.id === selectedId}
                  progress={progressMap.get(t.id)}
                  onSelect={selectTask}
                  onToggleDone={toggleDone}
                  onOpenSubtree={openSubtree}
                  onDragStart={handleChipDragStart}
                  onContextMenu={openMenu}
                />
              ))}
            </div>
          </Collapse>
        </div>
      )}

      {menu && menuTask && (
        <div
          ref={menuRef}
          className="absolute z-50 min-w-[140px] origin-top-left animate-in fade-in-0 zoom-in-95 rounded-md border bg-popover p-1 shadow-lg"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            onClick={toggleMenuDone}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          >
            {menuTask.status === 'done' ? '重新打开' : '标记完成'}
          </button>
          <button
            onClick={() => quickMove(dayKey(new Date()))}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          >
            移到今天
          </button>
          <button
            onClick={() => quickMove(dayKey(addDays(new Date(), 1)))}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          >
            移到明天
          </button>
          <button
            onClick={() => quickMove(dayKey(nextMonday(new Date())))}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          >
            移到下周一
          </button>
          {canClear && (
            <button
              onClick={clearDates}
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent hover:text-destructive"
            >
              清除日期
            </button>
          )}
        </div>
      )}

      {subtree && (
        <ChipSubtaskTree
          key={subtree.root.id}
          root={subtree.root}
          style={subtree.style}
          onReroot={(task) => setSubtree((s) => (s ? { ...s, root: task } : s))}
          onClose={() => setSubtree(null)}
        />
      )}
    </div>
  )
}
