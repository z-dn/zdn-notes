import { useState, useRef, useEffect } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'

interface InlineTaskInputProps {
  parentId: string | null
  orderIndex: number
  depth: number
  onClose: () => void
}

export function InlineTaskInput({ parentId, orderIndex, depth, onClose }: InlineTaskInputProps) {
  const [value, setValue] = useState('')
  const [leaving, setLeaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const createTask = useTaskStore((s) => s.createTask)
  const activeCategoryId = useCategoryStore((s) => s.activeCategoryId)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const close = () => {
    setLeaving(true)
    setTimeout(onClose, 200)
  }

  async function handleSubmit() {
    const text = value.trim()
    if (!text) return
    await createTask({
      title: text,
      parentId,
      orderIndex,
      categoryId: activeCategoryId ?? null,
    })
    close()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      close()
    }
  }

  return (
    <div
      className={`group flex items-center gap-3 rounded-md px-3 py-2 ${
        leaving ? 'animate-fade-out' : 'animate-fade-slide-up'
      }`}
      style={{ paddingLeft: `${12 + depth * 20}px` }}
    >
      <div className="h-4 w-4 shrink-0" />
      <div className="h-4 w-4 shrink-0" />
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => { if (!value.trim()) close() }}
        placeholder="输入任务名称，按回车添加"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
      />
    </div>
  )
}
