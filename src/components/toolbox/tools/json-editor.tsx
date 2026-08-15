import { useLayoutEffect, useMemo, useRef } from 'react'
import { tokenizeJson, type JsonToken } from '@/lib/json-highlight'
import { cn } from '@/lib/utils'

const BRACKET_COLORS = [
  'text-red-500 dark:text-red-400',
  'text-orange-500 dark:text-orange-400',
  'text-amber-500 dark:text-amber-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-sky-500 dark:text-sky-400',
  'text-violet-500 dark:text-violet-400',
]

function tokenClass(t: JsonToken): string {
  switch (t.type) {
    case 'bracket':
      return BRACKET_COLORS[(t.depth ?? 0) % BRACKET_COLORS.length]
    case 'key':
      return 'text-blue-600 dark:text-blue-300'
    case 'string':
      return 'text-green-700 dark:text-green-400'
    case 'number':
      return 'text-orange-600 dark:text-orange-300'
    case 'boolean':
      return 'text-violet-600 dark:text-violet-300'
    case 'null':
      return 'text-red-600 dark:text-red-400'
    case 'punct':
      return 'text-muted-foreground'
    default:
      return ''
  }
}

export function JsonEditor({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}) {
  const isJson = useMemo(() => {
    if (!value.trim()) return true
    try {
      JSON.parse(value)
      return true
    } catch {
      return false
    }
  }, [value])
  const tokens = useMemo(() => (isJson ? tokenizeJson(value) : []), [isJson, value])

  const taRef = useRef<HTMLTextAreaElement>(null)
  const preRef = useRef<HTMLPreElement>(null)

  function syncScroll() {
    const ta = taRef.current
    const pre = preRef.current
    if (ta && pre) pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`
  }

  useLayoutEffect(() => {
    syncScroll()
  }, [value, isJson])

  if (!isJson) {
    return (
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className={cn(
          'min-h-0 w-full resize-y whitespace-pre-wrap break-all bg-transparent p-2 font-mono text-xs leading-5 focus-visible:outline-none',
          className,
        )}
      />
    )
  }

  return (
    <div className={cn('relative min-h-0 w-full resize-y overflow-hidden', className)}>
      <pre
        ref={preRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 m-0 whitespace-pre-wrap break-all p-2 font-mono text-xs leading-5"
      >
        {tokens.map((t, i) => (
          <span key={i} className={tokenClass(t)}>
            {t.text}
          </span>
        ))}
      </pre>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        spellCheck={false}
        className="relative block h-full min-h-0 w-full resize-none whitespace-pre-wrap break-all bg-transparent p-2 font-mono text-xs leading-5 text-transparent caret-foreground selection:bg-primary/30 focus-visible:outline-none"
      />
    </div>
  )
}
