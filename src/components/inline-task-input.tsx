import { useState, useRef, useEffect } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'
import { parseNLP } from '@/lib/nlp'

interface InlineTaskInputProps {
  parentId: string | null
  orderIndex: number
  depth: number
  onClose: () => void
}

export function InlineTaskInput({ parentId, orderIndex, depth, onClose }: InlineTaskInputProps) {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const createTask = useTaskStore((s) => s.createTask)
  const activeCategoryId = useCategoryStore((s) => s.activeCategoryId)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  async function handleSubmit() {
    const text = value.trim()
    if (!text) return
    const p = parseNLP(text)
    await createTask({
      title: p.title || text,
      priority: p.priority ?? 'P2',
      dueDate: p.dueDate,
      startDate: p.startDate,
      tags: p.tags,
      owner: p.owner ?? '',
      parentId,
      orderIndex,
      categoryId: activeCategoryId ?? null,
    })
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onClose()
    }
  }

  return (
    <div
      className="group flex items-center gap-3 rounded-md px-3 py-2"
      style={{ paddingLeft: `${12 + depth * 20}px` }}
    >
      <div className="h-4 w-4 shrink-0" />
      <div className="h-4 w-4 shrink-0" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (!value.trim()) onClose() }}
        placeholder="输入任务名称，按回车添加"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
      />
    </div>
  )
}
