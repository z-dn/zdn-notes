import { useEffect, useRef } from 'react'
import type { Task } from '@/types/task'

interface ContextMenuProps {
  x: number
  y: number
  task?: Task
  onClose: () => void
  onAddSibling?: (task: Task) => void
  onAddChild?: (task: Task) => void
  onAddTask?: () => void
}

export function ContextMenu({ x, y, task, onClose, onAddSibling, onAddChild, onAddTask }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const keydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keydown)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute z-50 min-w-[140px] rounded-md border bg-popover p-1 shadow-md"
      style={{ left: x, top: y }}
    >
      {task ? (
        <>
          <button
            onClick={() => { onAddSibling?.(task); onClose() }}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          >
            添加同级任务
          </button>
          <button
            onClick={() => { onAddChild?.(task); onClose() }}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
          >
            添加子级任务
          </button>
        </>
      ) : (
        <button
          onClick={() => { onAddTask?.(); onClose() }}
          className="flex w-full items-center rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
        >
          添加任务
        </button>
      )}
    </div>
  )
}
