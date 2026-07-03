import { useState, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { parseNLP, type NLPResult } from '@/lib/nlp'
import { useTaskStore } from '@/stores/task-store'
import type { Priority } from '@/types/task'

const PRIORITY_CYCLE: Priority[] = ['P2', 'P1', 'P0', 'P3']

export function TaskInput() {
  const [value, setValue] = useState('')
  const [preview, setPreview] = useState<NLPResult | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const createTask = useTaskStore((s) => s.createTask)
  const selectedTask = useTaskStore((s) => s.selectedTask)
  const selectTask = useTaskStore((s) => s.selectTask)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value
    setValue(text)
    if (text.trim()) {
      const result = parseNLP(text)
      setPreview(result)
      setShowPreview(true)
    } else {
      setPreview(null)
      setShowPreview(false)
    }
  }

  function cyclePriority() {
    if (!preview) return
    const current = preview.priority
    if (!current) { setPreview({ ...preview, priority: 'P2' }); return }
    const idx = PRIORITY_CYCLE.indexOf(current)
    setPreview({ ...preview, priority: PRIORITY_CYCLE[(idx + 1) % PRIORITY_CYCLE.length] })
  }

  function removeTag(tag: string) {
    if (!preview) return
    setPreview({ ...preview, tags: preview.tags.filter((t) => t !== tag) })
  }

  function toggleDueDate() {
    if (!preview) return
    setPreview({ ...preview, dueDate: null })
  }

  async function handleSubmit() {
    const text = value.trim()
    if (!text) return
    const p = preview ?? parseNLP(text)
    await createTask({
      title: p.title || text,
      priority: p.priority ?? 'P2',
      dueDate: p.dueDate,
      tags: p.tags,
      owner: p.owner ?? '',
      parentId: selectedTask?.id ?? null,
    })

    setValue('')
    setPreview(null)
    setShowPreview(false)
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      setValue('')
      setPreview(null)
      setShowPreview(false)
    }
  }

  const isSubtask = !!selectedTask

  return (
    <div className="relative">
      {isSubtask && (
        <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">子任务</Badge>
          <span className="max-w-[200px] truncate font-medium text-foreground">
            {selectedTask.title}
          </span>
          <button
            onClick={() => selectTask(null)}
            className="ml-0.5 rounded-sm px-1 hover:bg-accent hover:text-foreground"
            title="改为添加顶级任务"
          >
            ✕
          </button>
        </div>
      )}
      <Input
        ref={inputRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        placeholder={isSubtask ? '输入子任务名称，按回车添加' : '添加任务，支持自然语言：明天下午3点写周报 #工作 P1'}
        className="h-10 text-base"
      />
      {showPreview && preview && (
        <div className="absolute top-full left-0 right-0 z-10 mt-1 rounded-md border bg-popover p-2 shadow-md">
          <div className="flex flex-wrap items-center gap-1.5 text-xs">
            {preview.title && (
              <span className="font-medium text-foreground">{preview.title}</span>
            )}
            <Badge
              variant="outline"
              className="cursor-pointer text-[10px] hover:bg-accent"
              onClick={cyclePriority}
              title="点击切换优先级"
            >
              {preview.priority ?? 'P?单击'}
            </Badge>
            {preview.tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="cursor-pointer text-[10px] hover:bg-destructive/20">
                #{tag}
                <button onClick={() => removeTag(tag)} className="ml-1">✕</button>
              </Badge>
            ))}
            {preview.owner && (
              <Badge variant="secondary" className="text-[10px]">
                @{preview.owner}
              </Badge>
            )}
            {preview.dueDate && (
              <span
                className="cursor-pointer text-muted-foreground hover:text-destructive"
                onClick={toggleDueDate}
                title="点击移除截止日期"
              >
                {new Date(preview.dueDate).toLocaleString('zh-CN', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
