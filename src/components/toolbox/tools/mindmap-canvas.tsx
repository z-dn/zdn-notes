import { useEffect, useMemo, useRef, useState } from 'react'
import type { MindNode } from '@/types/tool'
import {
  layoutMindmap,
  addMindChild,
  removeMindNode,
  updateMindText,
  createMindNode,
  createEmptyMindmap,
  MIND_NODE_W,
  MIND_NODE_H,
  MIND_LEVEL_GAP,
} from '@/lib/mindmap'
import { addMindSibling } from '@/lib/mindmap-outline'
import { cn } from '@/lib/utils'
import { ListPlus, Plus, RotateCcw, X, ZoomIn, ZoomOut } from 'lucide-react'

const ZOOM_MIN = 0.5
const ZOOM_MAX = 2

function clampZoom(z: number) {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z))
}

const NODE_BASE =
  'group absolute flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-sm transition-colors'
const NODE_SELECTED = 'ring-1 ring-ring border-ring/70'
const NODE_ACTIONS =
  'flex size-5 items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:bg-accent hover:text-foreground'
const NODE_ACTIONS_ROOT =
  'flex size-5 items-center justify-center rounded-full text-primary-foreground/70 transition-colors hover:bg-primary-foreground/15 hover:text-primary-foreground'

export function MindMapCanvas({
  nodes,
  onChange,
}: {
  nodes: MindNode[]
  onChange: (n: MindNode[]) => void
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [zoom, setZoom] = useState(1)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [panning, setPanning] = useState(false)
  const panRef = useRef({ startX: 0, startY: 0, left: 0, top: 0 })

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return
      e.preventDefault()
      setZoom((z) => clampZoom(z - e.deltaY * 0.002))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const root = nodes[0] ?? null
  const layout = useMemo(() => (root ? layoutMindmap(root) : null), [root])

  function commitEdit() {
    if (editingId && editText.trim()) {
      onChange(updateMindText(nodes, editingId, editText.trim()))
    } else if (editingId) {
      onChange(removeMindNode(nodes, editingId))
    }
    setEditingId(null)
  }

  function handleAddChild(parentId: string) {
    const child = createMindNode('')
    onChange(addMindChild(nodes, parentId, child))
    setSelectedId(child.id)
    setEditingId(child.id)
    setEditText('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleAddSibling(nodeId: string) {
    if (nodeId === root?.id) {
      handleAddChild(nodeId)
      return
    }
    const sibling = createMindNode('')
    onChange(addMindSibling(nodes, nodeId, sibling))
    setSelectedId(sibling.id)
    setEditingId(sibling.id)
    setEditText('')
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  function handleRemove(id: string) {
    if (id === root?.id) return
    onChange(removeMindNode(nodes, id))
    if (selectedId === id) setSelectedId(null)
    if (editingId === id) setEditingId(null)
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (e.button !== 0 || target.closest('button') || target.closest('[data-node]')) return
    const el = scrollRef.current
    if (!el) return
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      left: el.scrollLeft,
      top: el.scrollTop,
    }
    setPanning(true)
    el.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!panning) return
    const el = scrollRef.current
    if (!el) return
    el.scrollLeft = panRef.current.left - (e.clientX - panRef.current.startX)
    el.scrollTop = panRef.current.top - (e.clientY - panRef.current.startY)
  }

  function handlePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!panning) return
    setPanning(false)
    scrollRef.current?.releasePointerCapture(e.pointerId)
  }

  if (!root) {
    return (
      <div className="flex h-full items-center justify-center rounded-md border border-input bg-muted/30 text-xs text-muted-foreground">
        <button
          onClick={() => onChange(createEmptyMindmap())}
          className="flex items-center gap-1 rounded px-3 py-1.5 text-primary hover:bg-accent"
        >
          <Plus className="size-3.5" /> 创建思维图
        </button>
      </div>
    )
  }
  const tree = layout!

  function renderNode(pos: { id: string; x: number; y: number }, node: MindNode, isRoot: boolean) {
    const editing = editingId === node.id
    const selected = selectedId === node.id
    return (
      <div
        key={node.id}
        data-node
        className={cn(
          NODE_BASE,
          isRoot
            ? 'bg-primary font-medium text-primary-foreground shadow-sm'
            : 'border border-border/70 bg-background hover:bg-accent',
          selected && !editing && NODE_SELECTED,
        )}
        style={{ left: pos.x, top: pos.y, width: MIND_NODE_W, height: MIND_NODE_H }}
        onClick={() => setSelectedId(node.id)}
        onDoubleClick={() => {
          setEditingId(node.id)
          setEditText(node.text)
          setSelectedId(node.id)
          requestAnimationFrame(() => {
            inputRef.current?.focus()
            inputRef.current?.select()
          })
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={editText}
            autoFocus
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.stopPropagation()
                commitEdit()
              } else if (e.key === 'Escape') {
                e.stopPropagation()
                setEditingId(null)
              }
            }}
            onBlur={commitEdit}
            className="h-full w-full bg-transparent text-sm focus:outline-none"
          />
        ) : (
          <span className="flex-1 truncate">{node.text || '未命名'}</span>
        )}
        <span className={cn('flex shrink-0 gap-0.5', selected ? '' : 'hidden group-hover:flex')}>
          <button
            className={isRoot ? NODE_ACTIONS_ROOT : NODE_ACTIONS}
            title={isRoot ? '添加子节点' : '添加同级节点'}
            onClick={(e) => {
              e.stopPropagation()
              handleAddSibling(node.id)
            }}
          >
            <ListPlus className="size-3.5" />
          </button>
          <button
            className={isRoot ? NODE_ACTIONS_ROOT : NODE_ACTIONS}
            title="添加子节点"
            onClick={(e) => {
              e.stopPropagation()
              handleAddChild(node.id)
            }}
          >
            <Plus className="size-3.5" />
          </button>
          {!isRoot && (
            <button
              className={NODE_ACTIONS}
              title="删除节点"
              onClick={(e) => {
                e.stopPropagation()
                handleRemove(node.id)
              }}
            >
              <X className="size-3.5" />
            </button>
          )}
        </span>
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className={cn(
        'relative flex h-full w-full overflow-auto',
        panning ? 'cursor-grabbing select-none' : 'cursor-grab',
      )}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={(e) => {
        if (!selectedId || editingId) return
        if (e.key === 'Enter') {
          e.preventDefault()
          handleAddSibling(selectedId)
        } else if (e.key === 'Tab') {
          e.preventDefault()
          handleAddChild(selectedId)
        } else if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault()
          handleRemove(selectedId)
        }
      }}
      tabIndex={0}
    >
      <div
        className="relative my-auto shrink-0"
        style={{ width: tree.width * zoom, height: tree.height * zoom }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ width: tree.width, height: tree.height, transform: `scale(${zoom})` }}
        >
          <svg className="absolute inset-0" width={tree.width} height={tree.height} fill="none">
            {tree.edges.map((edge, i) => {
              const x1 = edge.from.x + MIND_NODE_W
              const y1 = edge.from.y + MIND_NODE_H / 2
              const x2 = edge.to.x
              const y2 = edge.to.y + MIND_NODE_H / 2
              const dx = Math.max((x2 - x1) / 2, MIND_LEVEL_GAP / 2)
              return (
                <path
                  key={i}
                  d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                  stroke="currentColor"
                  className="text-border/80"
                  strokeWidth={1.5}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              )
            })}
          </svg>
          {tree.nodes.map((pos) => {
            const isRoot = pos.id === root.id
            return renderNode(pos, pos.node, isRoot)
          })}
        </div>
      </div>
      <div className="absolute right-2 top-2 z-10 flex items-center gap-0.5 rounded-md border border-input bg-background/90 p-0.5 shadow-sm">
        <button
          className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="缩小"
          onClick={() => setZoom((z) => clampZoom(z - 0.1))}
        >
          <ZoomOut className="size-3.5" />
        </button>
        <span className="w-9 text-center text-[11px] tabular-nums text-muted-foreground">
          {Math.round(zoom * 100)}%
        </span>
        <button
          className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="放大"
          onClick={() => setZoom((z) => clampZoom(z + 0.1))}
        >
          <ZoomIn className="size-3.5" />
        </button>
        <button
          className="flex size-5 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          title="重置缩放"
          onClick={() => setZoom(1)}
        >
          <RotateCcw className="size-3.5" />
        </button>
      </div>
    </div>
  )
}
