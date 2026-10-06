import { useState, useRef, useEffect } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'
import type { Task } from '@/types/task'

interface InlineTaskInputProps {
  parentId: string | null
  /** 缺省时由 DAO 按「排在末尾」生成 */
  orderIndex?: number
  depth: number
  /** 显式指定日期（日历按格子日期预填）；不传则继承父任务日期 */
  dueDate?: number | null
  startDate?: number | null
  /** 创建成功后回传新任务（日历用于选中并打开详情面板） */
  onCreated?: (task: Task) => void
  /** 紧凑模式：省略列表行的勾选/缩进占位（日历格子宽度有限） */
  compact?: boolean
  onClose: () => void
}

export function InlineTaskInput({
  parentId,
  orderIndex,
  depth,
  dueDate,
  startDate,
  onCreated,
  compact,
  onClose,
}: InlineTaskInputProps) {
  const [value, setValue] = useState('')
  const [leaving, setLeaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const createTask = useTaskStore((s) => s.createTask)
  const parentTask = useTaskStore((s) =>
    parentId ? (s.tasks.find((t) => t.id === parentId) ?? null) : null,
  )
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
    const created = await createTask({
      title: text,
      parentId,
      orderIndex,
      categoryId: activeCategoryId ?? null,
      dueDate: dueDate !== undefined ? dueDate : (parentTask?.dueDate ?? null),
      startDate: startDate !== undefined ? startDate : (parentTask?.startDate ?? null),
    })
    if (created) onCreated?.(created)
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
      style={compact ? undefined : { paddingLeft: `${12 + depth * 20}px` }}
    >
      {!compact && <div className="h-4 w-4 shrink-0" />}
      {!compact && <div className="h-4 w-4 shrink-0" />}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!value.trim()) close()
        }}
        placeholder="输入任务名称，按回车添加"
        className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/40"
      />
    </div>
  )
}
