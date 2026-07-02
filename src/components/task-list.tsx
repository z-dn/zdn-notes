import { useMemo, useState } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'
import { TaskItem } from './task-item'
import type { Task } from '@/types/task'

type SortField = 'order' | 'priority' | 'dueDate' | 'createdAt'
type SortDir = 'asc' | 'desc'

const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

function sortTasks(tasks: Task[], field: SortField, dir: SortDir): Task[] {
  const copy = [...tasks]
  copy.sort((a, b) => {
    let cmp = 0
    if (field === 'order') {
      cmp = a.orderIndex - b.orderIndex
    } else if (field === 'priority') {
      cmp = (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2)
    } else if (field === 'dueDate') {
      cmp = (a.dueDate ?? 9e15) - (b.dueDate ?? 9e15)
    } else if (field === 'createdAt') {
      cmp = a.createdAt - b.createdAt
    }
    return dir === 'asc' ? cmp : -cmp
  })
  return copy
}

interface TreeNode {
  task: Task
  children: TreeNode[]
}

function buildTree(tasks: Task[]): TreeNode[] {
  const map = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  for (const task of tasks) {
    map.set(task.id, { task, children: [] })
  }

  for (const node of map.values()) {
    if (node.task.parentId && map.has(node.task.parentId)) {
      map.get(node.task.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  return roots
}

function flattenTree(
  nodes: TreeNode[],
  depth: number,
  expandedIds: Set<string>,
  result: { task: Task; depth: number; hasChildren: boolean }[],
) {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0
    result.push({ task: node.task, depth, hasChildren })
    if (hasChildren && expandedIds.has(node.task.id)) {
      flattenTree(node.children, depth + 1, expandedIds, result)
    }
  }
}

const SORT_LABELS: Record<string, string> = {
  order: '自定义',
  priority: '优先级',
  dueDate: '截止日期',
  createdAt: '创建时间',
}

export function TaskList() {
  const tasks = useTaskStore((s) => s.tasks)
  const loading = useTaskStore((s) => s.loading)
  const expandedIds = useTaskStore((s) => s.expandedIds)
  const selectTask = useTaskStore((s) => s.selectTask)
  const activeCategoryId = useCategoryStore((s) => s.activeCategoryId)
  const [sortField, setSortField] = useState<SortField>('order')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const flatList = useMemo(() => {
    const filtered = activeCategoryId ? tasks.filter((t) => t.categoryId === activeCategoryId) : tasks
    const roots = buildTree(sortField === 'order' ? filtered : sortTasks(filtered, sortField, sortDir))
    const result: { task: Task; depth: number; hasChildren: boolean }[] = []
    flattenTree(roots, 0, expandedIds, result)
    return result
  }, [tasks, expandedIds, sortField, sortDir, activeCategoryId])

  function toggleSort(field: SortField) {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortField(field)
      setSortDir('asc')
    }
  }

  if (loading) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        加载中...
      </div>
    )
  }

  if (flatList.length === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
        暂无任务，在上方输入框添加
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex gap-1 border-b pb-1.5 text-[11px] text-muted-foreground/60">
        {(['order', 'priority', 'dueDate', 'createdAt'] as SortField[]).map((f) => (
          <button
            key={f}
            onClick={() => toggleSort(f)}
            className={`rounded px-1.5 py-0.5 transition-colors hover:text-foreground ${
              sortField === f ? 'bg-accent text-foreground' : ''
            }`}
          >
            {SORT_LABELS[f]} {sortField === f ? (sortDir === 'asc' ? '↑' : '↓') : ''}
          </button>
        ))}
      </div>

      <div className="space-y-0.5" onClick={() => selectTask(null)}>
        {flatList.map(({ task, depth, hasChildren }) => (
          <TaskItem key={task.id} task={task} depth={depth} hasChildren={hasChildren} />
        ))}
      </div>
    </div>
  )
}
