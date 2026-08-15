import { useState, useRef, useEffect } from 'react'
import { useCategoryStore } from '@/stores/category-store'
import type { Category } from '@/types/task'
import { ColorPicker } from '@/components/color-picker'

const COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#06b6d4',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
]

export function CategorySidebar() {
  const {
    categories,
    taskCounts,
    activeCategoryId,
    selectCategory,
    createCategory,
    deleteCategory,
    updateCategory,
  } = useCategoryStore()
  const [showCreator, setShowCreator] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#6b7280')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const [colorPickerOpen, setColorPickerOpen] = useState(false)
  const colorPickerOpenRef = useRef(false)
  const editRef = useRef<HTMLInputElement>(null)
  const editContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus()
      editRef.current.select()
    }
  }, [editingId])

  useEffect(() => {
    colorPickerOpenRef.current = colorPickerOpen
  }, [colorPickerOpen])

  useEffect(() => {
    if (!editingId) return
    function handleMouseDown(e: MouseEvent) {
      if (colorPickerOpenRef.current) return
      if (editContainerRef.current && !editContainerRef.current.contains(e.target as Node)) {
        saveEdit()
      }
    }
    document.addEventListener('mousedown', handleMouseDown)
    return () => document.removeEventListener('mousedown', handleMouseDown)
  }, [editingId, editValue])

  const handleCreate = async () => {
    if (!newName.trim()) return
    await createCategory({ name: newName.trim(), color: newColor })
    setNewName('')
    setNewColor('#6b7280')
    setShowCreator(false)
  }

  const startEdit = (cat: Category, e: React.MouseEvent) => {
    e.stopPropagation()
    if (cat.id === '__uncategorized') return
    setEditingId(cat.id)
    setEditValue(cat.name)
  }

  const saveEdit = async () => {
    if (!editingId) return
    const trimmed = editValue.trim()
    if (trimmed) await updateCategory(editingId, { name: trimmed })
    setEditingId(null)
    setEditValue('')
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditValue('')
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
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

  const totalCount = Object.values(taskCounts).reduce((a, b) => a + b, 0)

  return (
    <div className="group relative flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        <button
          onClick={() => selectCategory(null)}
          className={`flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
            activeCategoryId === null
              ? 'bg-primary/10 text-primary font-medium'
              : 'hover:bg-accent text-muted-foreground hover:text-foreground'
          }`}
        >
          <span
            className="block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{
              background: 'conic-gradient(red, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, red)',
            }}
          />
          <span className="flex-1 truncate">全部</span>
          <span className="text-xs tabular-nums text-muted-foreground">{totalCount}</span>
          <span
            className="invisible flex h-4 w-4 shrink-0 items-center justify-center"
            aria-hidden
          />
          <span
            className="invisible flex h-4 w-4 shrink-0 items-center justify-center"
            aria-hidden
          />
        </button>

        {categories.map((cat) => {
          const count = taskCounts[cat.id] ?? 0
          const editing = editingId === cat.id
          return (
            <div
              key={cat.id}
              className={`group/item flex items-center gap-1 rounded-md px-2 py-1.5 text-sm transition-colors ${
                editing
                  ? 'bg-blue-50/80 text-foreground'
                  : activeCategoryId === cat.id
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-accent text-muted-foreground hover:text-foreground'
              }`}
              onClick={editing ? undefined : () => selectCategory(cat.id)}
            >
              {!editing && cat.id !== '__uncategorized' ? (
                <ColorPicker
                  value={cat.color}
                  onChange={(color) => updateCategory(cat.id, { color })}
                  onOpenChange={setColorPickerOpen}
                  triggerClassName="h-2.5 w-2.5"
                  triggerStyle={{ background: cat.color }}
                  title="修改颜色"
                />
              ) : (
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: cat.color }}
                />
              )}

              {editing ? (
                <div ref={editContainerRef} className="flex flex-1 flex-col gap-1.5 min-w-0">
                  <div className="flex items-center gap-1">
                    <input
                      ref={editRef}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={handleEditKeyDown}
                      onClick={(e) => e.stopPropagation()}
                      placeholder="请输入分类名称"
                      className="min-w-0 flex-1 rounded border border-input bg-background px-1 py-0.5 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        saveEdit()
                      }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-green-700 dark:text-green-300 hover:bg-green-100 dark:hover:bg-green-950"
                      title="保存"
                    >
                      ✓
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        cancelEdit()
                      }}
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent"
                      title="取消"
                    >
                      ✕
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {COLORS.map((c) => (
                      <button
                        key={c}
                        onClick={(e) => {
                          e.stopPropagation()
                          updateCategory(cat.id, { color: c })
                        }}
                        className={`h-3.5 w-3.5 rounded-full border transition-transform ${
                          cat.color === c ? 'scale-125 ring-1 ring-ring ring-offset-1' : ''
                        }`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                    <ColorPicker
                      value={cat.color}
                      onChange={(color) => updateCategory(cat.id, { color })}
                      onOpenChange={setColorPickerOpen}
                    />
                  </div>
                </div>
              ) : (
                <>
                  <span
                    className="flex-1 truncate text-xs"
                    onDoubleClick={(e) => startEdit(cat, e)}
                  >
                    {cat.name}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
                  {cat.id !== '__uncategorized' ? (
                    <>
                      <button
                        onClick={(e) => startEdit(cat, e)}
                        className="invisible flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground group-hover/item:visible"
                        title="重命名"
                      >
                        ✎
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteCategory(cat.id)
                        }}
                        className="invisible flex h-4 w-4 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive group-hover/item:visible"
                        title="删除"
                      >
                        ✕
                      </button>
                    </>
                  ) : (
                    <>
                      <span
                        className="invisible flex h-4 w-4 shrink-0 items-center justify-center"
                        aria-hidden
                      />
                      <span
                        className="invisible flex h-4 w-4 shrink-0 items-center justify-center"
                        aria-hidden
                      />
                    </>
                  )}
                </>
              )}
            </div>
          )
        })}
      </div>

      <div className="invisible group-hover:visible border-t border-divider p-2">
        {showCreator ? (
          <div className="space-y-2">
            <input
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate()
                if (e.key === 'Escape') setShowCreator(false)
              }}
              placeholder="分类名称"
              className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap gap-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setNewColor(c)}
                  className={`h-4 w-4 rounded-full border transition-transform ${
                    newColor === c ? 'scale-125 ring-1 ring-ring ring-offset-1' : ''
                  }`}
                  style={{ backgroundColor: c }}
                />
              ))}
              <ColorPicker
                value={newColor}
                onChange={setNewColor}
                onOpenChange={setColorPickerOpen}
              />
            </div>
            <div className="flex gap-1">
              <button
                onClick={handleCreate}
                disabled={!newName.trim()}
                className="flex-1 rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
              >
                添加
              </button>
              <button
                onClick={() => setShowCreator(false)}
                className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
              >
                取消
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => {
              const active = categories.find((c) => c.id === activeCategoryId)
              setNewColor(active?.color ?? '#6b7280')
              setShowCreator(true)
            }}
            className="flex w-full items-center gap-1 rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <span className="text-base leading-none">+</span>
            <span>新建分类</span>
          </button>
        )}
      </div>
    </div>
  )
}
