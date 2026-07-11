import { useState, useEffect, useRef } from 'react'
import { marked } from 'marked'
import { useTaskStore } from '@/stores/task-store'

export function ExpandedDescription() {
  const selectedTask = useTaskStore((s) => s.selectedTask)
  const updateTask = useTaskStore((s) => s.updateTask)
  const setExpandedDesc = useTaskStore((s) => s.setExpandedDesc)
  const [description, setDescription] = useState('')
  const [previewMode, setPreviewMode] = useState(false)
  const descTimer = useRef<number>(undefined)

  useEffect(() => {
    if (selectedTask) {
      setDescription(selectedTask.description || '')
    }
  }, [selectedTask])

  if (!selectedTask) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        未选择任务
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="truncate text-sm font-semibold">{selectedTask.title}</h2>
          <span className="shrink-0 text-[10px] text-muted-foreground/50">描述</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setPreviewMode((p) => !p)}
            className="rounded px-2 py-1 text-[11px] text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
          >
            {previewMode ? '编辑' : '预览'}
          </button>
          <button
            onClick={() => setExpandedDesc(null)}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
          >
            ✕ 收起
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-4">
        {previewMode ? (
          <div
            className="h-full w-full overflow-auto break-words rounded-md border border-input bg-transparent p-4 text-sm
              [&_ul]:list-disc [&_ul]:pl-4
              [&_ol]:list-decimal [&_ol]:pl-4
              [&_code]:rounded [&_code]:bg-muted [&_code]:px-1
              [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs
              [&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground
              [&_h1]:text-lg [&_h1]:font-bold
              [&_h2]:text-base [&_h2]:font-semibold
              [&_h3]:text-sm [&_h3]:font-medium"
            dangerouslySetInnerHTML={{ __html: marked.parse(description || '', { async: false }) as string }}
          />
        ) : (
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              clearTimeout(descTimer.current)
              descTimer.current = setTimeout(() => {
                updateTask({ id: selectedTask.id, description: e.target.value })
              }, 500)
            }}
            onBlur={() => {
              clearTimeout(descTimer.current)
              if (description !== selectedTask.description) {
                updateTask({ id: selectedTask.id, description })
              }
            }}
            placeholder="支持 Markdown 格式..."
            className="h-full w-full resize-none rounded-md border border-input bg-transparent p-4 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        )}
      </div>
    </div>
  )
}
