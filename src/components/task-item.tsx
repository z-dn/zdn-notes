import { useState, useRef, useEffect } from 'react'
import type { Task } from '@/types/task'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { useTaskStore } from '@/stores/task-store'

const PRIORITY_COLORS: Record<string, string> = {
  P0: 'bg-red-100 text-red-700 border-red-200 dark:bg-red-950 dark:text-red-300',
  P1: 'bg-orange-100 text-orange-700 border-orange-200 dark:bg-orange-950 dark:text-orange-300',
  P2: 'bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-950 dark:text-blue-300',
  P3: 'bg-green-100 text-green-700 border-green-200 dark:bg-green-950 dark:text-green-300',
}

export { PRIORITY_COLORS }

interface TaskItemProps {
  task: Task
  depth: number
  hasChildren: boolean
  onContextMenu?: (e: React.MouseEvent, task: Task) => void
  draggable?: boolean
  isDragging?: boolean
}

export function TaskItem({ task, depth, hasChildren, onContextMenu, draggable, isDragging }: TaskItemProps) {
  const toggleDone = useTaskStore((s) => s.toggleDone)
  const selectTask = useTaskStore((s) => s.selectTask)
  const selectedTask = useTaskStore((s) => s.selectedTask)
  const expandedIds = useTaskStore((s) => s.expandedIds)
  const toggleExpand = useTaskStore((s) => s.toggleExpand)
  const deleteTask = useTaskStore((s) => s.deleteTask)
  const updateTask = useTaskStore((s) => s.updateTask)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const isExpanded = expandedIds.has(task.id)
  const isSelected = selectedTask?.id === task.id

  const isDone = task.status === 'done'
  const isCancelled = task.status === 'cancelled'

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus()
      editRef.current.select()
    }
  }, [editing])

  function startEdit(e: React.MouseEvent) {
    e.stopPropagation()
    setEditValue(task.title)
    setEditing(true)
  }

  function saveEdit() {
    const trimmed = editValue.trim()
    if (trimmed && trimmed !== task.title) {
      updateTask({ id: task.id, title: trimmed })
    }
    setEditing(false)
  }

  function cancelEdit() {
    setEditing(false)
  }

  function handleEditKeyDown(e: React.KeyboardEvent) {
    e.stopPropagation()
    if (e.key === 'Enter') {
      e.preventDefault()
      saveEdit()
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      cancelEdit()
    }
  }

  function handleDragStart(e: React.DragEvent) {
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', task.id)
  }

  return (
    <div
      data-task-id={task.id}
      className={`group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors ${
        isDragging ? 'opacity-30' : 'hover:bg-accent/50'
      } ${isSelected ? 'bg-accent' : ''} ${isDone ? 'opacity-60' : ''}`}
      style={{ paddingLeft: `${12 + depth * 20}px` }}
      onClick={(e) => { if (!editing) { e.stopPropagation(); selectTask(task) } }}
      onDoubleClick={startEdit}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContextMenu?.(e, task) }}
      draggable={draggable ?? false}
      onDragStart={handleDragStart}
    >
      {hasChildren ? (
        <button
          onClick={(e) => { e.stopPropagation(); toggleExpand(task.id) }}
          className="flex h-4 w-4 shrink-0 items-center justify-center text-muted-foreground transition-transform hover:text-foreground"
          title={isExpanded ? '折叠' : '展开'}
        >
          <span className={`inline-block transition-transform duration-150 ${isExpanded ? 'rotate-90' : ''}`}>
            ▸
          </span>
        </button>
      ) : (
        <div className="h-4 w-4 shrink-0" />
      )}

      <Checkbox
        checked={isDone}
        onCheckedChange={() => toggleDone(task.id, task.status)}
        onClick={(e) => e.stopPropagation()}
        className={`shrink-0 ${isCancelled ? 'opacity-40' : ''}`}
      />

      {editing ? (
        <input
          ref={editRef}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={handleEditKeyDown}
          onBlur={saveEdit}
          className="flex-1 rounded border border-input bg-background px-1 text-sm outline-none focus:ring-1 focus:ring-ring"
        />
      ) : (
        <span
          className={`flex-1 truncate text-sm ${
            isDone ? 'line-through text-muted-foreground' : ''
          } ${isCancelled ? 'line-through text-muted-foreground/50' : ''}`}
        >
          {task.title}
        </span>
      )}

      <Badge className={`${PRIORITY_COLORS[task.priority] || ''} text-[10px]`}>
        {task.priority}
      </Badge>

      {task.owner && (
        <Badge variant="outline" className="text-[10px]">
          @{task.owner}
        </Badge>
      )}

      {task.startDate && (
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {new Date(task.startDate).toLocaleDateString('zh-CN')} →
        </span>
      )}

      {task.dueDate && (
        <span className="hidden text-xs text-muted-foreground sm:inline">
          {new Date(task.dueDate).toLocaleDateString('zh-CN')}
        </span>
      )}

      <button
        onClick={(e) => { e.stopPropagation(); deleteTask(task.id) }}
        className="invisible ml-auto text-muted-foreground hover:text-destructive group-hover:visible"
        title="删除任务"
      >
        ✕
      </button>
    </div>
  )
}