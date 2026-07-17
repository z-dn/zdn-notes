import { useState, useRef } from 'react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'

export function TaskInput() {
  const [value, setValue] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const createTask = useTaskStore((s) => s.createTask)
  const selectedTask = useTaskStore((s) => s.selectedTask)
  const selectTask = useTaskStore((s) => s.selectTask)
  const activeCategoryId = useCategoryStore((s) => s.activeCategoryId)

  async function handleSubmit() {
    const text = value.trim()
    if (!text) return
    await createTask({
      title: text,
      parentId: selectedTask?.id ?? null,
      categoryId: activeCategoryId ?? null,
    })
    setValue('')
    inputRef.current?.focus()
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSubmit()
    }
    if (e.key === 'Escape') {
      setValue('')
    }
  }

  const isSubtask = !!selectedTask

  return (
    <div className="relative">
      {isSubtask && (
        <div className="mb-1 flex items-center gap-1 text-xs text-muted-foreground">
          <Badge variant="outline" className="text-[10px]">子任务</Badge>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="max-w-[200px] truncate font-medium text-foreground">
                {selectedTask.title}
              </span>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <p className="max-w-xs break-words">{selectedTask.title}</p>
            </TooltipContent>
          </Tooltip>
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
        id="task-input"
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="添加任务，按回车确认"
        className="h-10 text-base"
      />
    </div>
  )
}
