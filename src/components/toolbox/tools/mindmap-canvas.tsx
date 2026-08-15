import { useMemo, useRef, useState } from 'react'
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
import { ListPlus, Plus, X } from 'lucide-react'

const NODE_BASE =
  'absolute flex items-center gap-1 rounded-md border border-input px-2 text-sm shadow-sm transition-colors'
const NODE_SELECTED = 'ring-1 ring-ring'
const NODE_ACTIONS =
  'flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground'

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
  const inputRef = useRef<HTMLInputElement>(null)

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
        className={cn(
          NODE_BASE,
          isRoot && 'bg-primary/10 text-primary font-medium',
          selected && !editing && NODE_SELECTED,
          !isRoot && 'bg-background',
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
            className={NODE_ACTIONS}
            title={isRoot ? '添加子节点' : '添加同级节点'}
            onClick={(e) => {
              e.stopPropagation()
              handleAddSibling(node.id)
            }}
          >
            <ListPlus className="size-3" />
          </button>
          <button
            className={NODE_ACTIONS}
            title="添加子节点"
            onClick={(e) => {
              e.stopPropagation()
              handleAddChild(node.id)
            }}
          >
            <Plus className="size-3" />
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
              <X className="size-3" />
            </button>
          )}
        </span>
      </div>
    )
  }

  return (
    <div
      className="group h-full w-full overflow-auto"
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
      <div className="relative" style={{ width: tree.width, height: tree.height }}>
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
                className="text-border"
                strokeWidth={1.5}
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
  )
}
