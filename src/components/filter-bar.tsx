import { useState, useEffect, useRef } from 'react'
import { useTaskStore } from '@/stores/task-store'
import type { Status } from '@/types/task'

const STATUS_OPTIONS: { label: string; value: Status | undefined }[] = [
  { label: '全部', value: undefined },
  { label: '待办', value: 'todo' },
  { label: '已完成', value: 'done' },
]

export function FilterBar() {
  const filters = useTaskStore((s) => s.filters)
  const setFilter = useTaskStore((s) => s.setFilter)
  const [localSearch, setLocalSearch] = useState(filters.search ?? '')
  const [expanded, setExpanded] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const inputRef = useRef<HTMLInputElement>(null)

  const hasActiveFilter = !!filters.search || !!filters.status

  useEffect(() => {
    setLocalSearch(filters.search ?? '')
  }, [filters.search])

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const val = localSearch.trim()
      const nextSearch = val || undefined
      if (nextSearch !== filters.search) {
        setFilter({ search: nextSearch })
      }
    }, 300)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [localSearch, filters.search])

  useEffect(() => {
    if (expanded && inputRef.current) {
      inputRef.current.focus()
    }
  }, [expanded])

  function handleClear() {
    setLocalSearch('')
    setFilter({ search: undefined, status: undefined })
    setExpanded(false)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape' && !localSearch.trim()) {
      setExpanded(false)
    }
  }

  return (
    <div className="mb-2 flex items-center gap-2 border-b pb-1.5">
      <button
        onClick={() => setExpanded((v) => !v)}
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded transition-colors ${
          hasActiveFilter
            ? 'text-foreground bg-accent'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent'
        }`}
        title="筛选"
      >
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={1.5}>
          <circle cx="6.5" cy="6.5" r="4.5" />
          <line x1="10" y1="10" x2="14" y2="14" />
        </svg>
      </button>

      <div
        className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden transition-all duration-200 ease-in-out"
        style={{ maxWidth: expanded ? '9999px' : '0', opacity: expanded ? 1 : 0 }}
      >
        <input
          ref={inputRef}
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索任务..."
          className="h-7 min-w-0 flex-1 rounded border border-input bg-background px-2 text-xs outline-none placeholder:text-muted-foreground"
        />
        <div className="flex shrink-0 gap-0.5 rounded-md bg-muted/50 p-0.5">
          {STATUS_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              onClick={() => setFilter({ status: opt.value })}
              className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                (opt.value ?? undefined) === (filters.status ?? undefined)
                  ? 'bg-accent text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleClear}
          className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
        >
          清除
        </button>
      </div>
    </div>
  )
}