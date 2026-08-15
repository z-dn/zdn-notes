import { useLayoutEffect, useMemo, useRef } from 'react'
import { tokenizeJson, tokenClass } from '@/lib/json-highlight'
import { cn } from '@/lib/utils'

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
