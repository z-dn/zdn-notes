import { useEffect, useRef } from 'react'
import { Network } from 'lucide-react'

export function EditorContextMenu({
  x,
  y,
  onClose,
  onInsert,
}: {
  x: number
  y: number
  onClose: () => void
  onInsert: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    const onScroll = () => onClose()
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="absolute z-50 min-w-[150px] origin-top-left animate-in fade-in-0 zoom-in-95 rounded-md border bg-popover p-1 shadow-lg"
      style={{ left: x, top: y }}
    >
      <button
        onClick={() => {
          onInsert()
          onClose()
        }}
        className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-xs hover:bg-accent"
      >
        <Network className="size-3.5" /> 插入思维图
      </button>
    </div>
  )
}
