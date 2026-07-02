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
}

export function TaskItem({ task, depth, hasChildren }: TaskItemProps) {
  const toggleDone = useTaskStore((s) => s.toggleDone)
  const selectTask = useTaskStore((s) => s.selectTask)
  const selectedTask = useTaskStore((s) => s.selectedTask)
  const expandedIds = useTaskStore((s) => s.expandedIds)
  const toggleExpand = useTaskStore((s) => s.toggleExpand)
  const deleteTask = useTaskStore((s) => s.deleteTask)
  const isExpanded = expandedIds.has(task.id)
  const isSelected = selectedTask?.id === task.id

  const isDone = task.status === 'done'
  const isCancelled = task.status === 'cancelled'

  return (
    <div
      className={`group flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 transition-colors hover:bg-accent/50 ${
        isSelected ? 'bg-accent' : ''
      } ${isDone ? 'opacity-60' : ''}`}
      style={{ paddingLeft: `${12 + depth * 20}px` }}
      onClick={(e) => { e.stopPropagation(); selectTask(task) }}
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

      <span
        className={`flex-1 truncate text-sm ${
          isDone ? 'line-through text-muted-foreground' : ''
        } ${isCancelled ? 'line-through text-muted-foreground/50' : ''}`}
      >
        {task.title}
      </span>

      <Badge className={`${PRIORITY_COLORS[task.priority] || ''} text-[10px]`}>
        {task.priority}
      </Badge>

      {task.project && (
        <Badge variant="outline" className="text-[10px]">
          @{task.project}
        </Badge>
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
