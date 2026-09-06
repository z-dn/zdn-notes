import type { Task } from '@/types/task'

export type SortField = 'order' | 'priority' | 'dueDate' | 'createdAt'
export type SortDir = 'asc' | 'desc'

export const PRIORITY_ORDER: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 }

export function sortTasks(tasks: Task[], field: SortField, dir: SortDir): Task[] {
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

export interface TreeNode {
  task: Task
  children: TreeNode[]
}

export interface FlatRow {
  task: Task
  depth: number
  hasChildren: boolean
}

export function buildTree(tasks: Task[]): TreeNode[] {
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

export function flattenTree(
  nodes: TreeNode[],
  depth: number,
  expandedIds: Set<string>,
  result: FlatRow[],
) {
  for (const node of nodes) {
    const hasChildren = node.children.length > 0
    result.push({ task: node.task, depth, hasChildren })
    if (hasChildren && expandedIds.has(node.task.id)) {
      flattenTree(node.children, depth + 1, expandedIds, result)
    }
  }
}

export function isDescendantOf(targetId: string, parentId: string, tasks: Task[]): boolean {
  const children = tasks.filter((t) => t.parentId === parentId)
  for (const child of children) {
    if (child.id === targetId) return true
    if (isDescendantOf(targetId, child.id, tasks)) return true
  }
  return false
}

export function partitionByStatus(tasks: Task[]): { todo: Task[]; done: Task[] } {
  const todo: Task[] = []
  const done: Task[] = []
  for (const t of tasks) {
    if (t.status === 'done') done.push(t)
    else todo.push(t)
  }
  return { todo, done }
}

export function collectExpandableIds(nodes: TreeNode[]): string[] {
  const out: string[] = []
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.children.length > 0) {
        out.push(node.task.id)
        walk(node.children)
      }
    }
  }
  walk(nodes)
  return out
}
