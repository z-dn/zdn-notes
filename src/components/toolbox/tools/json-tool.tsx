import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Braces, PanelTopClose, PanelTopOpen } from 'lucide-react'
import { useToolStore } from '@/stores/tool-store'
import { TOOL_KEYS, TOOL_DEFAULTS, type JsonToolState } from '@/types/tool'
import { copyText } from '@/lib/copy'
import { toast } from '@/lib/toast'
import { splitJsonLines, tokenizeJson, type JsonToken } from '@/lib/json-highlight'
import { useDebouncedValue } from '@/hooks/use-debounced-value'

const BRACKET_COLORS = [
  'text-red-500 dark:text-red-400',
  'text-orange-500 dark:text-orange-400',
  'text-amber-500 dark:text-amber-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-sky-500 dark:text-sky-400',
  'text-violet-500 dark:text-violet-400',
]

const ROW_HEIGHT = 20

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

function formatJson(input: string, mode: 'beautify' | 'minify'): { text: string; error?: string } {
  const trimmed = input.trim()
  if (!trimmed) return { text: '' }
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { text: '', error: `JSON 解析失败：${msg}` }
  }
  return { text: JSON.stringify(parsed, null, mode === 'beautify' ? 2 : undefined) }
}

export function JsonTool() {
  const state =
    (useToolStore((s) => s.states[TOOL_KEYS.json]) as JsonToolState | undefined) ??
    TOOL_DEFAULTS[TOOL_KEYS.json]
  const updateState = useToolStore((s) => s.updateState)

  const debouncedInput = useDebouncedValue(state.input, 400)
  const pending = debouncedInput !== state.input

  const { text: output, error } = useMemo(
    () => formatJson(debouncedInput, state.mode),
    [debouncedInput, state.mode],
  )
  const lines = useMemo(() => splitJsonLines(output), [output])

  const containerRef = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState({ start: 0, end: 0 })

  const computeVisible = () => {
    const el = containerRef.current
    if (!el) return
    const { scrollTop, clientHeight } = el
    const buffer = Math.ceil(clientHeight / ROW_HEIGHT)
    const start = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - buffer)
    const end = Math.min(lines.length, Math.ceil((scrollTop + clientHeight) / ROW_HEIGHT) + buffer)
    setVisible((v) => (v.start === start && v.end === end ? v : { start, end }))
  }

  useLayoutEffect(() => {
    computeVisible()
  }, [output])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(computeVisible)
    ro.observe(el)
    return () => ro.disconnect()
  }, [output])

  return (
    <div className="animate-fade-slide-up flex h-full flex-col gap-3">
      <div className="mb-2 flex items-center gap-2 border-b pb-1.5">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Braces className="size-3.5" /> JSON 输入
        </span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex gap-0.5 rounded-md bg-muted/50 p-0.5">
            {(['beautify', 'minify'] as const).map((m) => (
              <button
                key={m}
                onClick={() => updateState(TOOL_KEYS.json, { mode: m })}
                className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
                  state.mode === m
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {m === 'beautify' ? '美化' : '压缩'}
              </button>
            ))}
          </div>
          <button
            onClick={() => updateState(TOOL_KEYS.json, { inputCollapsed: !state.inputCollapsed })}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent"
          >
            {state.inputCollapsed ? (
              <PanelTopOpen className="size-3" />
            ) : (
              <PanelTopClose className="size-3" />
            )}
            {state.inputCollapsed ? '展开输入' : '收起输入'}
          </button>
          <button
            onClick={() => updateState(TOOL_KEYS.json, { input: '' })}
            disabled={!state.input}
            className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
          >
            清空
          </button>
        </div>
      </div>

      {state.inputCollapsed ? (
        <div className="rounded-md border border-dashed border-input px-3 py-1.5 text-xs text-muted-foreground">
          输入区已收起，点击上方「展开输入」恢复
        </div>
      ) : (
        <textarea
          value={state.input}
          onChange={(e) => updateState(TOOL_KEYS.json, { input: e.target.value })}
          placeholder="粘贴 JSON 内容..."
          spellCheck={false}
          className="min-h-0 flex-1 resize-none rounded-md border border-input bg-transparent p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2 border-t pt-1.5">
        <span className="text-xs font-medium text-muted-foreground">输出</span>
        {pending && (
          <span className="animate-pulse text-[11px] text-muted-foreground/60">格式化中…</span>
        )}
        <button
          onClick={async () => {
            const ok = await copyText(output)
            toast(ok ? '已复制' : '复制失败')
          }}
          disabled={!output}
          className="ml-auto rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          复制
        </button>
      </div>

      {output ? (
        state.mode === 'beautify' ? (
          <div
            ref={containerRef}
            onScroll={computeVisible}
            className="min-h-0 flex-1 overflow-auto rounded-md border border-input bg-muted/30 font-mono text-xs"
          >
            <div style={{ height: lines.length * ROW_HEIGHT, position: 'relative' }}>
              {lines.slice(visible.start, visible.end).map((line, k) => {
                const i = visible.start + k
                const tokens = tokenizeJson(line.text, line.startDepth)
                return (
                  <div
                    key={i}
                    className="absolute left-0 w-full whitespace-pre px-2"
                    style={{
                      top: i * ROW_HEIGHT,
                      height: ROW_HEIGHT,
                      lineHeight: `${ROW_HEIGHT}px`,
                    }}
                  >
                    {tokens.map((t, j) => (
                      <span key={j} className={tokenClass(t)}>
                        {t.text}
                      </span>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <textarea
            value={output}
            readOnly
            spellCheck={false}
            className="min-h-0 flex-1 resize-none rounded-md border border-input bg-muted/30 p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        )
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-md border border-input bg-muted/30 text-xs text-muted-foreground">
          格式化结果将显示在这里
        </div>
      )}
    </div>
  )
}
