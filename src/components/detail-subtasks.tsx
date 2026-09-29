import { useState } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { Checkbox } from '@/components/ui/checkbox'
import { generateBetween } from '@/lib/lexorank'
import type { Task } from '@/types/task'

export function DetailSubtasks({ task }: { task: Task }) {
  const tasks = useTaskStore((s) => s.tasks)
  const selectTask = useTaskStore((s) => s.selectTask)
  const toggleDone = useTaskStore((s) => s.toggleDone)
  const deleteTask = useTaskStore((s) => s.deleteTask)
  const createTask = useTaskStore((s) => s.createTask)
  const [value, setValue] = useState('')

  const subtasks = tasks
    .filter((t) => t.parentId === task.id)
    .sort((a, b) => a.orderIndex - b.orderIndex)
  const doneCount = subtasks.filter((t) => t.status === 'done').length

  async function handleCreate() {
    const text = value.trim()
    if (!text) return
    const last = subtasks[subtasks.length - 1]
    await createTask({
      title: text,
      parentId: task.id,
      orderIndex: generateBetween(last?.orderIndex ?? null, null),
      categoryId: task.categoryId,
      dueDate: task.dueDate,
      startDate: task.startDate,
    })
    setValue('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleCreate()
    }
  }

  async function handleDelete(sub: Task) {
    await deleteTask(sub.id)
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-xs text-muted-foreground/60">子任务</label>
        {subtasks.length > 0 && (
          <span className="text-[11px] text-muted-foreground/70">
            {doneCount}/{subtasks.length}
          </span>
        )}
      </div>
      {subtasks.map((sub) => (
        <div key={sub.id} className="group flex items-center gap-2">
          <Checkbox
            checked={sub.status === 'done'}
            onCheckedChange={() => toggleDone(sub.id, sub.status)}
            onClick={(e) => e.stopPropagation()}
            className="size-3.5"
          />
          <button
            onClick={() => selectTask(sub)}
            className={`min-w-0 flex-1 truncate text-left text-xs transition-colors hover:text-foreground ${
              sub.status === 'done' ? 'line-through text-muted-foreground' : 'text-muted-foreground'
            }`}
          >
            {sub.title}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              handleDelete(sub)
            }}
            className="invisible shrink-0 text-[11px] text-muted-foreground hover:text-destructive group-hover:visible"
            aria-label="删除子任务"
          >
            ✕
          </button>
        </div>
      ))}
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="添加子任务..."
        className="mt-0.5 h-6 w-full rounded border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      />
    </div>
  )
}
