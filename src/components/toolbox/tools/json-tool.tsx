import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Braces, PanelTopClose, PanelTopOpen } from 'lucide-react'
import { useToolStore } from '@/stores/tool-store'
import { TOOL_KEYS, TOOL_DEFAULTS, type JsonToolState } from '@/types/tool'
import { copyText } from '@/lib/copy'
import { toast } from '@/lib/toast'
import { splitJsonLines, tokenizeJson, tokenClass } from '@/lib/json-highlight'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import { FadeBlock, Collapse } from '@/components/fade'

const ROW_HEIGHT = 20

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
    <div className="flex h-full flex-col gap-3">
      <div className="mb-2 flex items-center gap-2 border-b border-divider pb-1.5">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Braces className="size-3.5" /> JSON美化
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

      <Collapse open={!state.inputCollapsed} className="min-h-0">
        <textarea
          value={state.input}
          onChange={(e) => updateState(TOOL_KEYS.json, { input: e.target.value })}
          placeholder="粘贴 JSON 内容..."
          spellCheck={false}
          className="h-full w-full resize-none rounded-md border border-input bg-transparent p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </Collapse>

      <FadeBlock
        show={!!error}
        className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
      >
        {error}
      </FadeBlock>

      <div className="flex items-center gap-2 pt-1.5">
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
          className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
        >
          复制
        </button>
      </div>

      <FadeBlock show={!!output && state.mode === 'beautify'} className="min-h-0 flex-1">
        <div
          ref={containerRef}
          onScroll={computeVisible}
          className="h-full overflow-auto rounded-md border border-input bg-muted/30 font-mono text-xs"
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
      </FadeBlock>
      <FadeBlock show={!!output && state.mode === 'minify'} className="min-h-0 flex-1">
        <textarea
          value={output}
          readOnly
          spellCheck={false}
          className="h-full w-full resize-none rounded-md border border-input bg-muted/30 p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </FadeBlock>
      <FadeBlock show={!output} className="min-h-0 flex-1">
        <div className="flex h-full items-center justify-center rounded-md border border-input bg-muted/30 text-xs text-muted-foreground">
          格式化结果将显示在这里
        </div>
      </FadeBlock>
    </div>
  )
}
