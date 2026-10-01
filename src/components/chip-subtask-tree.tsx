import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { ListTree } from 'lucide-react'
import { useTaskStore } from '@/stores/task-store'
import { Checkbox } from '@/components/ui/checkbox'
import { generateBetween } from '@/lib/lexorank'
import type { Task } from '@/types/task'

interface SubtreeRow {
  task: Task
  depth: number
}

interface ChipSubtaskTreeProps {
  root: Task
  /** 相对日历根容器的定位样式（父层已做边界翻转/夹紧） */
  style: CSSProperties
  onClose: () => void
  /** 行内下钻：把浮层改根到该行任务（位置不变） */
  onReroot: (task: Task) => void
}

export function ChipSubtaskTree({ root, style, onClose, onReroot }: ChipSubtaskTreeProps) {
  const tasks = useTaskStore((s) => s.tasks)
  const selectTask = useTaskStore((s) => s.selectTask)
  const toggleDone = useTaskStore((s) => s.toggleDone)
  const deleteTask = useTaskStore((s) => s.deleteTask)
  const createTask = useTaskStore((s) => s.createTask)
  const [value, setValue] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const childrenOf = useMemo(() => {
    const map = new Map<string | null, Task[]>()
    for (const t of tasks) {
      const arr = map.get(t.parentId)
      if (arr) arr.push(t)
      else map.set(t.parentId, [t])
    }
    for (const arr of map.values()) arr.sort((a, b) => a.orderIndex - b.orderIndex)
    return map
  }, [tasks])

  const rows = useMemo(() => {
    const out: SubtreeRow[] = []
    const seen = new Set<string>()
    const walk = (parentId: string, depth: number) => {
      for (const t of childrenOf.get(parentId) ?? []) {
        if (seen.has(t.id)) continue
        seen.add(t.id)
        out.push({ task: t, depth })
        walk(t.id, depth + 1)
      }
    }
    walk(root.id, 0)
    return out
  }, [childrenOf, root.id])

  const direct = childrenOf.get(root.id) ?? []
  const doneCount = direct.filter((t) => t.status === 'done').length

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.closest?.('[data-subtree-entry]')) return
      if (ref.current && target && !ref.current.contains(target)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  async function handleCreate() {
    const text = value.trim()
    if (!text) return
    const last = direct[direct.length - 1]
    await createTask({
      title: text,
      parentId: root.id,
      orderIndex: generateBetween(last?.orderIndex ?? null, null),
      categoryId: root.categoryId,
      dueDate: root.dueDate,
      startDate: root.startDate,
    })
    setValue('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCreate()
    }
  }

  return (
    <div
      ref={ref}
      style={style}
      className="absolute z-50 flex max-h-64 w-60 origin-top-left animate-in fade-in-0 zoom-in-95 flex-col rounded-md border bg-popover p-1 shadow-lg"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 px-1 pb-1">
        <button
          type="button"
          onClick={() => selectTask(root)}
          className="min-w-0 truncate rounded px-1 text-left text-[11px] font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {root.title}
        </button>
        {direct.length > 0 && (
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/70">
            {doneCount}/{direct.length}
          </span>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {rows.map(({ task, depth }) => {
          const hasChildren = (childrenOf.get(task.id)?.length ?? 0) > 0
          return (
            <div
              key={task.id}
              className="group flex items-center gap-1.5 rounded pr-1 transition-colors hover:bg-accent"
              style={{ paddingLeft: 8 + depth * 14 }}
            >
              <Checkbox
                checked={task.status === 'done'}
                onCheckedChange={() => toggleDone(task.id, task.status)}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => e.stopPropagation()}
                className="size-3.5 shrink-0"
              />
              <button
                type="button"
                onClick={() => selectTask(task)}
                className={`min-w-0 flex-1 truncate text-left text-[11px] transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${
                  task.status === 'done'
                    ? 'line-through text-muted-foreground'
                    : 'text-muted-foreground'
                }`}
              >
                {task.title}
              </button>
              {hasChildren && (
                <button
                  type="button"
                  aria-label="展开子任务树"
                  onClick={() => onReroot(task)}
                  className="shrink-0 text-muted-foreground/60 opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:opacity-100"
                >
                  <ListTree className="size-3" />
                </button>
              )}
              <button
                type="button"
                aria-label="删除子任务"
                onClick={() => deleteTask(task.id)}
                className="invisible shrink-0 text-[11px] text-muted-foreground/60 transition-opacity hover:text-destructive focus-visible:visible focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring group-hover:visible"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="添加子任务..."
        className="mt-1 h-6 w-full shrink-0 rounded border border-input bg-transparent px-2 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  )
}
