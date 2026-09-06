import { useMemo, useState, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useTaskStore } from '@/stores/task-store'
import { TaskItem } from './task-item'
import { ContextMenu } from './context-menu'
import { InlineTaskInput } from './inline-task-input'
import { FilterBar } from './filter-bar'
import {
  buildTree,
  collectExpandableIds,
  flattenTree,
  isDescendantOf,
  partitionByStatus,
  sortTasks,
  type FlatRow,
  type SortDir,
  type SortField,
} from './task-list-view'
import { generateBetween, rebalance } from '@/lib/lexorank'
import type { Task } from '@/types/task'

const SORT_LABELS: Record<string, string> = {
  order: '自定义',
  priority: '优先级',
  dueDate: '截止日期',
  createdAt: '创建时间',
}

const ROW_HEIGHT = 38
const INLINE_INPUT_HEIGHT = 44

interface InlineInputState {
  afterTaskId: string
  parentId: string | null
  orderIndex: number
  depth: number
}

function DropLine({ depth, levelChange }: { depth: number; levelChange: boolean }) {
  return (
    <div
      className="absolute top-0 h-0.5 rounded bg-foreground/60"
      style={
        levelChange
          ? { left: `${12 + depth * 20}px`, width: '24px' }
          : { left: `${12 + depth * 20}px`, right: 0 }
      }
    />
  )
}

export function TaskList({ categoryId }: { categoryId: string | null }) {
  const tasks = useTaskStore((s) => s.tasks)
  const loading = useTaskStore((s) => s.loading)
  const expandedIds = useTaskStore((s) => s.expandedIds)
  const statusView = useTaskStore((s) => s.statusView)
  const setStatusView = useTaskStore((s) => s.setStatusView)
  const selectTask = useTaskStore((s) => s.selectTask)
  const toggleExpand = useTaskStore((s) => s.toggleExpand)
  const updateTask = useTaskStore((s) => s.updateTask)
  const expandAll = useTaskStore((s) => s.expandAll)
  const collapseAll = useTaskStore((s) => s.collapseAll)
  const [sortField, setSortField] = useState<SortField>('order')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [donePanelState, setDonePanelState] = useState<'hidden' | 'shown' | 'leaving'>('hidden')
  const donePanelStateRef = useRef(donePanelState)
  donePanelStateRef.current = donePanelState
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; task: Task } | null>(null)
  const [blankMenuPos, setBlankMenuPos] = useState<{ x: number; y: number } | null>(null)
  const [inlineInput, setInlineInput] = useState<InlineInputState | null>(null)
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null)
  const [dropTargetLevelChange, setDropTargetLevelChange] = useState(false)
  const [dropDepth, setDropDepth] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const doneScrollRef = useRef<HTMLDivElement>(null)
  const dragIdRef = useRef<string | null>(null)
  const dropIdxRef = useRef<number | null>(null)
  const dropDepthRef = useRef(0)

  const view = useMemo(() => {
    const filtered = categoryId ? tasks.filter((t) => t.categoryId === categoryId) : tasks
    const { todo, done } = partitionByStatus(filtered)
    const build = (list: Task[]) => {
      const sorted =
        sortField === 'order'
          ? [...list].sort((a, b) => a.orderIndex - b.orderIndex)
          : sortTasks(list, sortField, sortDir)
      return buildTree(sorted)
    }
    const mainTree = build(todo)
    const doneTree = build(done)
    const flatList: FlatRow[] = []
    flattenTree(mainTree, 0, expandedIds, flatList)
    const doneRows: FlatRow[] = []
    flattenTree(doneTree, 0, expandedIds, doneRows)
    return {
      flatList,
      doneRows,
      doneCount: done.length,
      expandableIds: collectExpandableIds(mainTree),
    }
  }, [tasks, expandedIds, sortField, sortDir, categoryId])

  const flatList = view.flatList

  const mainVirtualizer = useVirtualizer({
    count: flatList.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => flatList[index]?.task.id ?? index,
  })
  const doneVirtualizer = useVirtualizer({
    count: view.doneRows.length,
    getScrollElement: () => doneScrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    getItemKey: (index) => view.doneRows[index]?.task.id ?? index,
  })
  const mainItems = mainVirtualizer.getVirtualItems()
  const doneItems = doneVirtualizer.getVirtualItems()
  const mainTotalSize = mainVirtualizer.getTotalSize()

  const [leavingRows, setLeavingRows] = useState<
    { task: Task; depth: number; hasChildren: boolean; uid: string }[]
  >([])
  const prevIdsRef = useRef<Set<string> | null>(null)
  const prevFlatRef = useRef(flatList)
  const prevExpandedSizeRef = useRef(expandedIds.size)

  useLayoutEffect(() => {
    const cur = new Set(flatList.map((f) => f.task.id))
    const prev = prevIdsRef.current
    prevIdsRef.current = cur
    if (expandedIds.size !== prevExpandedSizeRef.current) {
      prevExpandedSizeRef.current = expandedIds.size
      prevFlatRef.current = flatList
      return
    }
    const prevFlat = prevFlatRef.current
    prevFlatRef.current = flatList
    if (!prev) return
    const gone = prevFlat.filter(
      (f) => !cur.has(f.task.id) && tasks.some((t) => t.id === f.task.id),
    )
    if (gone.length === 0) return
    const batch = crypto.randomUUID()
    setLeavingRows((rows) => [
      ...rows,
      ...gone.map((f) => ({
        task: f.task,
        depth: f.depth,
        hasChildren: f.hasChildren,
        uid: `${batch}:${f.task.id}`,
      })),
    ])
    const t = setTimeout(
      () => setLeavingRows((rows) => rows.filter((r) => !r.uid.startsWith(`${batch}:`))),
      200,
    )
    return () => clearTimeout(t)
  }, [flatList, tasks, expandedIds])

  useEffect(() => {
    if (statusView === 'done') {
      if (donePanelStateRef.current !== 'shown') setDonePanelState('shown')
    } else if (donePanelStateRef.current === 'shown') {
      setDonePanelState('leaving')
      const t = setTimeout(() => setDonePanelState('hidden'), 300)
      return () => clearTimeout(t)
    }
  }, [statusView])

  useEffect(() => {
    const el = listRef.current
    if (!el || sortField !== 'order') return

    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      const childEls = el.querySelectorAll<HTMLElement>(':scope > [data-task-wrap]')
      const dragId = dragIdRef.current

      let hoveredIdx = -1
      let targetIdx = childEls.length > 0 ? Number(childEls[0].getAttribute('data-index')) : 0
      childEls.forEach((child) => {
        const i = Number(child.getAttribute('data-index'))
        const r = child.getBoundingClientRect()
        if (e.clientY >= r.top && e.clientY <= r.bottom) hoveredIdx = i
        if (e.clientY > r.top + r.height / 2) targetIdx = i + 1
      })

      if (hoveredIdx >= 0 && dragId && flatList[hoveredIdx]?.task.id !== dragId) {
        const child = el.querySelector<HTMLElement>(
          `:scope > [data-task-wrap][data-index="${hoveredIdx}"]`,
        )
        const r = child?.getBoundingClientRect()
        if (!child || !r) return
        const relX = (e.clientX - r.left) / r.width
        const taskDepth = flatList[hoveredIdx].depth

        if (relX >= 0.5) {
          dropDepthRef.current = taskDepth + 1
          setDropDepth(taskDepth + 1)
          setDropTargetLevelChange(true)
          targetIdx = hoveredIdx + 1
        } else {
          const isTop = e.clientY < r.top + r.height / 2
          dropDepthRef.current = taskDepth
          setDropDepth(taskDepth)
          setDropTargetLevelChange(false)
          targetIdx = isTop ? hoveredIdx : hoveredIdx + 1
        }

        dropIdxRef.current = targetIdx
        setDropTargetIndex(targetIdx)
        return
      }

      setDropTargetIndex(targetIdx)
      dropIdxRef.current = targetIdx
      const baseDepth = targetIdx === 0 ? 0 : (flatList[targetIdx - 1]?.depth ?? 0)
      dropDepthRef.current = baseDepth
      setDropDepth(baseDepth)
      setDropTargetLevelChange(false)
    }

    const onDrop = (e: DragEvent) => {
      e.preventDefault()
      const dragId = dragIdRef.current
      const dropIdx = dropIdxRef.current
      if (!dragId || dropIdx === null) return

      const draggedTask = tasks.find((t) => t.id === dragId)
      if (!draggedTask) {
        dragIdRef.current = null
        dropIdxRef.current = null
        setDropTargetIndex(null)
        setDropTargetLevelChange(false)
        setDropDepth(0)
        dropDepthRef.current = 0
        return
      }

      const dropDepth = dropDepthRef.current
      let newParentId: string | null = null
      if (dropDepth === 0) {
        newParentId = null
      } else {
        for (let i = dropIdx - 1; i >= 0; i--) {
          if (flatList[i].depth === dropDepth - 1 && flatList[i].task.id !== dragId) {
            newParentId = flatList[i].task.id
            break
          }
        }
      }
      if (!newParentId) {
        newParentId = dropIdx === 0 ? null : (flatList[dropIdx - 1]?.task.parentId ?? null)
      }

      if (
        newParentId === draggedTask.id ||
        (newParentId && isDescendantOf(draggedTask.id, newParentId, tasks))
      ) {
        dragIdRef.current = null
        dropIdxRef.current = null
        setDropTargetIndex(null)
        setDropTargetLevelChange(false)
        setDropDepth(0)
        dropDepthRef.current = 0
        return
      }

      let siblingAbove: Task | null = null
      let siblingBelow: Task | null = null
      for (let i = dropIdx - 1; i >= 0; i--) {
        if (flatList[i].task.parentId === newParentId && flatList[i].task.id !== dragId) {
          siblingAbove = flatList[i].task
          break
        }
      }
      for (let i = dropIdx; i < flatList.length; i++) {
        if (flatList[i].task.parentId === newParentId && flatList[i].task.id !== dragId) {
          siblingBelow = flatList[i].task
          break
        }
      }

      let newOrderIndex: number
      try {
        newOrderIndex = generateBetween(
          siblingAbove?.orderIndex ?? null,
          siblingBelow?.orderIndex ?? null,
        )
      } catch {
        const siblingTasks = tasks.filter((t) => t.parentId === newParentId && t.id !== dragId)
        const siblingIds = siblingTasks.map((t) => t.id)
        const ranks = siblingTasks.map((t) => t.orderIndex)
        const newRanks = rebalance(ranks)
        siblingIds.forEach((id, i) => updateTask({ id, orderIndex: newRanks[i] }))

        const freshTasks = useTaskStore.getState().tasks
        const idToTask = new Map(freshTasks.map((t) => [t.id, t]))
        let freshAbove: Task | null = null
        let freshBelow: Task | null = null
        for (let i = dropIdx - 1; i >= 0; i--) {
          const f = flatList[i]
          if (f.task.parentId === newParentId && f.task.id !== dragId) {
            freshAbove = idToTask.get(f.task.id) ?? f.task
            break
          }
        }
        for (let i = dropIdx; i < flatList.length; i++) {
          const f = flatList[i]
          if (f.task.parentId === newParentId && f.task.id !== dragId) {
            freshBelow = idToTask.get(f.task.id) ?? f.task
            break
          }
        }
        newOrderIndex = generateBetween(
          freshAbove?.orderIndex ?? null,
          freshBelow?.orderIndex ?? null,
        )
      }

      updateTask({ id: dragId, orderIndex: newOrderIndex, parentId: newParentId })
      dragIdRef.current = null
      dropIdxRef.current = null
      setDropTargetIndex(null)
      setDropTargetLevelChange(false)
      setDropDepth(0)
      dropDepthRef.current = 0
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
      setDropTargetLevelChange(false)
      setDropDepth(0)
      dropDepthRef.current = 0
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

  const handleAddSibling = useCallback(
    (task: Task) => {
      const siblings = tasks
        .filter((t) => t.parentId === task.parentId && t.id !== task.id)
        .sort((a, b) => a.orderIndex - b.orderIndex)

      const idx = siblings.findIndex((t) => t.orderIndex > task.orderIndex)
      const next = idx >= 0 ? siblings[idx].orderIndex : null
      const orderIndex = generateBetween(task.orderIndex, next)

      const flatIndex = flatList.findIndex((f) => f.task.id === task.id)
      const depth = flatIndex >= 0 ? flatList[flatIndex].depth : 0

      setInlineInput({ afterTaskId: task.id, parentId: task.parentId, orderIndex, depth })
    },
    [tasks, flatList],
  )

  const handleAddChild = useCallback(
    (task: Task) => {
      const children = tasks
        .filter((t) => t.parentId === task.id)
        .sort((a, b) => a.orderIndex - b.orderIndex)

      const last = children.length > 0 ? children[children.length - 1].orderIndex : null
      const orderIndex = generateBetween(last, null)
      if (!expandedIds.has(task.id)) toggleExpand(task.id)

      const flatIndex = flatList.findIndex((f) => f.task.id === task.id)
      const depth = flatIndex >= 0 ? flatList[flatIndex].depth + 1 : 1

      setInlineInput({ afterTaskId: task.id, parentId: task.id, orderIndex, depth })
    },
    [tasks, flatList, expandedIds, toggleExpand],
  )

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

  const rootInputOpen =
    !!inlineInput && !flatList.some((f) => f.task.id === inlineInput.afterTaskId)
  const targetRendered =
    dropTargetIndex !== null && mainItems.some((vr) => vr.index === dropTargetIndex)
  const lastRendered = mainItems[mainItems.length - 1]
  const endLineTop = lastRendered ? lastRendered.start + lastRendered.size : 0
  const doneTotalSize = doneVirtualizer.getTotalSize()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="mb-2 flex items-center gap-1 border-b border-divider pb-1.5 text-[11px] text-muted-foreground/60">
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
        <div className="ml-auto flex gap-1">
          <button
            onClick={() => expandAll(view.expandableIds)}
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
            title="展开全部子任务"
          >
            全部展开
          </button>
          <button
            onClick={() => collapseAll()}
            className="rounded px-1.5 py-0.5 transition-colors hover:bg-accent hover:text-foreground"
            title="收起全部子任务"
          >
            全部收起
          </button>
        </div>
      </div>

      <FilterBar />

      {loading ? (
        <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
          加载中...
        </div>
      ) : (
        <div className="relative min-h-0 flex-1">
          <div ref={scrollRef} className="absolute inset-0 overflow-y-auto">
            <div
              ref={listRef}
              className="relative"
              style={{
                height: rootInputOpen ? mainTotalSize + INLINE_INPUT_HEIGHT : mainTotalSize,
                minHeight: '100%',
              }}
              onClick={() => {
                if (!dragIdRef.current) selectTask(null)
              }}
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
              ) : (
                mainItems.map((vr) => {
                  const row = flatList[vr.index]
                  if (!row) return null
                  const { task, depth, hasChildren } = row
                  return (
                    <div
                      key={vr.key}
                      ref={mainVirtualizer.measureElement}
                      data-task-wrap
                      data-index={vr.index}
                      className="absolute left-0 top-0 w-full pb-[2px]"
                      style={{ transform: `translateY(${vr.start}px)` }}
                    >
                      {dropTargetIndex === vr.index && dragIdRef.current && (
                        <DropLine depth={dropDepth} levelChange={dropTargetLevelChange} />
                      )}
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
                      {inlineInput?.afterTaskId === task.id && (
                        <InlineTaskInput
                          parentId={inlineInput.parentId}
                          orderIndex={inlineInput.orderIndex}
                          depth={inlineInput.depth}
                          onClose={() => setInlineInput(null)}
                        />
                      )}
                    </div>
                  )
                })
              )}
              {dragIdRef.current && dropTargetIndex !== null && !targetRendered && (
                <div
                  className="absolute left-0 w-full"
                  style={{ top: Math.max(0, endLineTop - 1) }}
                >
                  <DropLine depth={dropDepth} levelChange={dropTargetLevelChange} />
                </div>
              )}
              {rootInputOpen && flatList.length === 0 && (
                <InlineTaskInput
                  key="inline-root-input"
                  parentId={inlineInput!.parentId}
                  orderIndex={inlineInput!.orderIndex}
                  depth={inlineInput!.depth}
                  onClose={() => setInlineInput(null)}
                />
              )}
              {rootInputOpen && flatList.length > 0 && (
                <div className="absolute left-0 w-full" style={{ top: mainTotalSize }}>
                  <InlineTaskInput
                    key="inline-root-input"
                    parentId={inlineInput!.parentId}
                    orderIndex={inlineInput!.orderIndex}
                    depth={inlineInput!.depth}
                    onClose={() => setInlineInput(null)}
                  />
                </div>
              )}
              {leavingRows.map((l, i) => (
                <div
                  key={`leaving-${l.uid}`}
                  className="pointer-events-none absolute left-0 w-full animate-fade-out"
                  style={{ top: mainTotalSize + i * ROW_HEIGHT }}
                >
                  <TaskItem task={l.task} depth={l.depth} hasChildren={l.hasChildren} />
                </div>
              ))}
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

            {statusView === 'all' && view.doneCount > 0 && (
              <div className="sticky bottom-0 z-10 border-t border-divider bg-panel">
                <button
                  onClick={() => setStatusView('done')}
                  className="flex w-full items-center gap-1 rounded px-3 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <span className="inline-block">▸</span>
                  已完成 ({view.doneCount})
                </button>
              </div>
            )}
          </div>

          {donePanelState !== 'hidden' && (
            <div
              className={`absolute inset-0 z-10 flex flex-col bg-panel ${
                donePanelState === 'leaving' ? 'animate-panel-down' : 'animate-panel-up'
              }`}
            >
              <div className="flex shrink-0 items-center justify-between border-b border-divider px-3 py-2">
                <span className="text-[11px] text-muted-foreground">已完成 ({view.doneCount})</span>
                <button
                  onClick={() => setStatusView('all')}
                  className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  收起
                </button>
              </div>
              <div ref={doneScrollRef} className="min-h-0 flex-1 overflow-y-auto">
                <div className="relative" style={{ height: doneTotalSize, minHeight: '100%' }}>
                  {doneItems.map((vr) => {
                    const row = view.doneRows[vr.index]
                    if (!row) return null
                    return (
                      <div
                        key={vr.key}
                        ref={doneVirtualizer.measureElement}
                        data-index={vr.index}
                        className="absolute left-0 top-0 w-full pb-[2px]"
                        style={{ transform: `translateY(${vr.start}px)` }}
                      >
                        <TaskItem task={row.task} depth={row.depth} hasChildren={row.hasChildren} />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
