import { useMemo, useState, useCallback, useRef, useEffect } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'
import { TaskItem } from './task-item'
import { ContextMenu } from './context-menu'
import { InlineTaskInput } from './inline-task-input'
import { generateBetween, rebalance } from '@/lib/lexorank'
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

function isDescendantOf(targetId: string, parentId: string, tasks: Task[]): boolean {
  const children = tasks.filter((t) => t.parentId === parentId)
  for (const child of children) {
    if (child.id === targetId) return true
    if (isDescendantOf(targetId, child.id, tasks)) return true
  }
  return false
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
  const toggleExpand = useTaskStore((s) => s.toggleExpand)
  const updateTask = useTaskStore((s) => s.updateTask)
  const activeCategoryId = useCategoryStore((s) => s.activeCategoryId)
  const [sortField, setSortField] = useState<SortField>('order')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: Task } | null>(null)
  const [blankMenuPos, setBlankMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [inlineInput, setInlineInput] = useState<{
    afterTaskId: string
    parentId: string | null
    orderIndex: number
    depth: number
  } | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const dragIdRef = useRef<string | null>(null)
  const dropIdxRef = useRef<number | null>(null)

  const flatList = useMemo(() => {
    const filtered = activeCategoryId ? tasks.filter((t) => t.categoryId === activeCategoryId) : tasks
    const sorted = sortField === 'order' ? [...filtered].sort((a, b) => a.orderIndex - b.orderIndex) : sortTasks(filtered, sortField, sortDir)
    const roots = buildTree(sorted)
    const result: { task: Task; depth: number; hasChildren: boolean }[] = []
    flattenTree(roots, 0, expandedIds, result)
    return result
  }, [tasks, expandedIds, sortField, sortDir, activeCategoryId])

  useEffect(() => {
    const el = listRef.current
    if (!el || sortField !== 'order') return

    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      const childEls = el.querySelectorAll(':scope > [data-task-wrap]')
      let targetIdx = childEls.length
      childEls.forEach((child, i) => {
        const r = child.getBoundingClientRect()
        if (e.clientY > r.top + r.height / 2) targetIdx = i + 1
      })
      dropIdxRef.current = targetIdx
      setDropTargetIndex(targetIdx)
    }

    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const dragId = dragIdRef.current
      const dropIdx = dropIdxRef.current
      if (!dragId || dropIdx === null) return

      const draggedTask = tasks.find((t) => t.id === dragId)
      if (!draggedTask) { dragIdRef.current = null; dropIdxRef.current = null; setDropTargetIndex(null); return }

      const newParentId = dropIdx === 0 ? null : (flatList[dropIdx - 1]?.task.parentId ?? null)

      if (newParentId === draggedTask.id || (newParentId && isDescendantOf(draggedTask.id, newParentId, tasks))) {
        dragIdRef.current = null; dropIdxRef.current = null; setDropTargetIndex(null); return
      }

      let siblingAbove: Task | null = null
      let siblingBelow: Task | null = null
      for (let i = dropIdx - 1; i >= 0; i--) {
        if (flatList[i].task.parentId === newParentId && flatList[i].task.id !== dragId) {
          siblingAbove = flatList[i].task; break
        }
      }
      for (let i = dropIdx; i < flatList.length; i++) {
        if (flatList[i].task.parentId === newParentId && flatList[i].task.id !== dragId) {
          siblingBelow = flatList[i].task; break
        }
      }

      let newOrderIndex: number
      try {
        newOrderIndex = generateBetween(siblingAbove?.orderIndex ?? null, siblingBelow?.orderIndex ?? null)
      } catch {
        const siblingTasks = tasks.filter((t) => t.parentId === newParentId && t.id !== dragId)
        const siblingIds = siblingTasks.map((t) => t.id)
        const ranks = siblingTasks.map((t) => t.orderIndex)
        const newRanks = rebalance(ranks)
        siblingIds.forEach((id, i) => updateTask({ id, orderIndex: newRanks[i] }))
        newOrderIndex = generateBetween(siblingAbove?.orderIndex ?? null, siblingBelow?.orderIndex ?? null)
      }

      updateTask({ id: dragId, orderIndex: newOrderIndex, parentId: newParentId })
      dragIdRef.current = null; dropIdxRef.current = null; setDropTargetIndex(null)
    }

    const onDragStart = (e: DragEvent) => {
      const taskItem = (e.target as HTMLElement)?.closest('[data-task-id]')
      if (taskItem) {
        dragIdRef.current = taskItem.getAttribute('data-task-id')
      }
    }

    const onDragEnd = () => {
      dragIdRef.current = null
      dropIdxRef.current = null
      setDropTargetIndex(null)
    }

    el.addEventListener('dragover', onDragOver)
    el.addEventListener('drop', onDrop)
    document.addEventListener('dragstart', onDragStart)
    document.addEventListener('dragend', onDragEnd)

    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('drop', onDrop)
      document.removeEventListener('dragstart', onDragStart)
      document.removeEventListener('dragend', onDragEnd)
    }
  }, [sortField, tasks, flatList, updateTask])

  const handleAddSibling = useCallback((task: Task) => {
    const siblings = tasks
      .filter((t) => t.parentId === task.parentId && t.id !== task.id)
      .sort((a, b) => a.orderIndex - b.orderIndex)

    const idx = siblings.findIndex((t) => t.orderIndex > task.orderIndex)
    const next = idx >= 0 ? siblings[idx].orderIndex : null
    const orderIndex = generateBetween(task.orderIndex, next)

    const flatIndex = flatList.findIndex((f) => f.task.id === task.id)
    const depth = flatIndex >= 0 ? flatList[flatIndex].depth : 0

    setInlineInput({ afterTaskId: task.id, parentId: task.parentId, orderIndex, depth })
  }, [tasks, flatList])

  const handleAddChild = useCallback((task: Task) => {
    const children = tasks
      .filter((t) => t.parentId === task.id)
      .sort((a, b) => a.orderIndex - b.orderIndex)

    const last = children.length > 0 ? children[children.length - 1].orderIndex : null
    const orderIndex = generateBetween(last, null)
    if (!expandedIds.has(task.id)) toggleExpand(task.id)

    const flatIndex = flatList.findIndex((f) => f.task.id === task.id)
    const depth = flatIndex >= 0 ? flatList[flatIndex].depth + 1 : 1

    setInlineInput({ afterTaskId: task.id, parentId: task.id, orderIndex, depth })
  }, [tasks, flatList, expandedIds, toggleExpand])

  const handleBlankAdd = useCallback(() => {
    const rootTasks = flatList.filter((f) => f.task.parentId === null)
    const lastRoot = rootTasks[rootTasks.length - 1]
    const orderIndex = lastRoot
      ? generateBetween(lastRoot.task.orderIndex, null)
      : generateBetween(null, null)
    setInlineInput({
      afterTaskId: lastRoot?.task.id ?? '__root__',
      parentId: null,
      orderIndex,
      depth: 0,
    })
    setBlankMenuPos(null)
  }, [flatList])

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

  return (
    <div className="flex flex-col min-h-full">
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

      <div ref={listRef} className="relative flex-1 space-y-0.5" onClick={() => { if (!dragIdRef.current) selectTask(null) }}
        onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-task-id]')) return
          e.preventDefault()
          const r = listRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
          setContextMenu(null)
          setBlankMenuPos({ x: e.clientX - r.left, y: e.clientY - r.top })
        }}
      >
        {flatList.length === 0 ? (
          <div className="flex h-32 items-center justify-center text-sm text-muted-foreground select-none">
            暂无任务，右键点击添加
          </div>
        ) : flatList.flatMap(({ task, depth, hasChildren }, flatIndex) => [
          dropTargetIndex === flatIndex && dragIdRef.current && (
            <div key={`drop-${flatIndex}`} className="h-0.5 rounded bg-blue-500" />
          ),
          <div key={task.id} data-task-wrap className="animate-fade-slide-up" style={{ animationDelay: `${flatIndex * 25}ms` }}>
            <TaskItem
              task={task}
              depth={depth}
              hasChildren={hasChildren}
              onContextMenu={(e, t) => {
                const r = listRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
                setBlankMenuPos(null)
                setContextMenu({ x: e.clientX - r.left, y: e.clientY - r.top, task: t })
              }}
              draggable={sortField === 'order'}
              isDragging={dragIdRef.current === task.id}
            />
          </div>,
          inlineInput?.afterTaskId === task.id && (
            <InlineTaskInput
              key="inline-input"
              parentId={inlineInput.parentId}
              orderIndex={inlineInput.orderIndex}
              depth={inlineInput.depth}
              onClose={() => setInlineInput(null)}
            />
          ),
        ]        )}
        {dropTargetIndex === flatList.length && dragIdRef.current && (
          <div key="drop-end" className="h-0.5 rounded bg-blue-500" />
        )}
        {inlineInput && !flatList.some((f) => f.task.id === inlineInput.afterTaskId) && (
          <InlineTaskInput
            key="inline-root-input"
            parentId={inlineInput.parentId}
            orderIndex={inlineInput.orderIndex}
            depth={inlineInput.depth}
            onClose={() => setInlineInput(null)}
          />
        )}
        {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            task={contextMenu.task}
            onClose={() => setContextMenu(null)}
            onAddSibling={handleAddSibling}
            onAddChild={handleAddChild}
          />
        )}
        {blankMenuPos && (
          <ContextMenu
            x={blankMenuPos.x}
            y={blankMenuPos.y}
            onClose={() => setBlankMenuPos(null)}
            onAddTask={handleBlankAdd}
          />
        )}
      </div>
    </div>
  )
}