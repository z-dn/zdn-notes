import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, History, Plus, RotateCcw, Send, Trash2, Wand2 } from 'lucide-react'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { useToolStore } from '@/stores/tool-store'
import {
  TOOL_KEYS,
  TOOL_DEFAULTS,
  type ApiHistoryEntry,
  type ApiResponseResult,
  type ApiToolState,
} from '@/types/tool'
import { Select } from '@/components/ui/select'
import { copyText } from '@/lib/copy'
import { toast } from '@/lib/toast'
import { splitJsonLines, tokenizeJson } from '@/lib/json-highlight'
import { JsonEditor } from './json-editor'

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const

const HISTORY_LIMIT = 30
const BODY_TRUNCATE_BYTES = 100 * 1024

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-green-700 dark:text-green-400',
  POST: 'text-amber-700 dark:text-amber-400',
  PUT: 'text-blue-700 dark:text-blue-400',
  PATCH: 'text-violet-700 dark:text-violet-400',
  DELETE: 'text-red-700 dark:text-red-400',
  HEAD: 'text-slate-500 dark:text-slate-400',
  OPTIONS: 'text-slate-500 dark:text-slate-400',
}

const ROW_HEIGHT = 20

const BRACKET_COLORS = [
  'text-red-500 dark:text-red-400',
  'text-orange-500 dark:text-orange-400',
  'text-amber-500 dark:text-amber-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-sky-500 dark:text-sky-400',
  'text-violet-500 dark:text-violet-400',
]

function formatHistoryTime(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  return d.toDateString() === now.toDateString()
    ? format(d, 'HH:mm', { locale: zhCN })
    : format(d, 'M月d日 HH:mm', { locale: zhCN })
}

function statusBadgeClass(status: number): string {
  if (status >= 200 && status < 300)
    return 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300'
  if (status >= 300 && status < 400)
    return 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
  return 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

const TEXTAREA_CLS =
  'min-h-0 w-full resize-none rounded-md border border-input bg-transparent p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

export function ApiTool() {
  const state =
    (useToolStore((s) => s.states[TOOL_KEYS.api]) as ApiToolState | undefined) ??
    TOOL_DEFAULTS[TOOL_KEYS.api]
  const updateState = useToolStore((s) => s.updateState)

  const [loading, setLoading] = useState(false)
  const [showHeaders, setShowHeaders] = useState(false)
  const [showBody, setShowBody] = useState(true)
  const [showResponseHeaders, setShowResponseHeaders] = useState(true)

  const response = state.lastResponse
  const error = response && !response.ok ? (response.error ?? '') : ''

  const bodyText = response?.body ?? ''
  const parsedJson = useMemo(() => {
    if (!bodyText) return null
    try {
      return JSON.parse(bodyText) as unknown
    } catch {
      return null
    }
  }, [bodyText])
  const prettyJson = parsedJson === null ? '' : JSON.stringify(parsedJson, null, 2)
  const lines = useMemo(() => splitJsonLines(prettyJson), [prettyJson])

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
  }, [prettyJson])

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(computeVisible)
    ro.observe(el)
    return () => ro.disconnect()
  }, [prettyJson])

  function setHeaders(next: { key: string; value: string }[]) {
    updateState(TOOL_KEYS.api, { headers: next })
  }

  function patchHeader(i: number, patch: Partial<{ key: string; value: string }>) {
    setHeaders(state.headers.map((h, k) => (k === i ? { ...h, ...patch } : h)))
  }

  function handleBeautifyBody() {
    const trimmed = state.body.trim()
    if (!trimmed) return
    try {
      updateState(TOOL_KEYS.api, { body: JSON.stringify(JSON.parse(trimmed), null, 2) })
      toast('已美化')
    } catch {
      toast('请求体不是有效的 JSON')
    }
  }

  async function handleSend() {
    if (loading) return
    const url = state.url.trim()
    if (!url) {
      toast('请输入请求 URL')
      return
    }
    const headers = state.headers.filter((h) => h.key.trim())
    const reqBody = state.body
    setLoading(true)
    updateState(TOOL_KEYS.api, { lastResponse: null })
    try {
      const res = await window.electronAPI.httpRequest({
        method: state.method,
        url,
        headers,
        body: reqBody,
      })
      const result: ApiResponseResult = res
      if (result.ok && result.body && result.body.length > BODY_TRUNCATE_BYTES) {
        result.body = result.body.slice(0, BODY_TRUNCATE_BYTES)
        result.truncated = true
        result.size = BODY_TRUNCATE_BYTES
      }
      const entry: ApiHistoryEntry = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        method: state.method,
        url,
        headers,
        body: reqBody,
        truncated: result.truncated ?? false,
        response: result,
      }
      const history = [entry, ...state.history].slice(0, HISTORY_LIMIT)
      updateState(TOOL_KEYS.api, { history, lastResponse: result })
    } catch (e) {
      const result: ApiResponseResult = { ok: false, error: e instanceof Error ? e.message : String(e) }
      const entry: ApiHistoryEntry = {
        id: crypto.randomUUID(),
        createdAt: Date.now(),
        method: state.method,
        url,
        headers,
        body: reqBody,
        truncated: false,
        response: result,
      }
      const history = [entry, ...state.history].slice(0, HISTORY_LIMIT)
      updateState(TOOL_KEYS.api, { history, lastResponse: result })
    } finally {
      setLoading(false)
    }
  }

  function handleLoadHistory(entry: ApiHistoryEntry) {
    updateState(TOOL_KEYS.api, {
      method: entry.method,
      url: entry.url,
      headers: entry.headers.map((h) => ({ ...h })),
      body: entry.body,
      lastResponse: entry.response,
    })
    setShowResponseHeaders(true)
  }

  function handleDeleteHistory(id: string) {
    updateState(TOOL_KEYS.api, { history: state.history.filter((h) => h.id !== id) })
  }

  function handleClearHistory() {
    updateState(TOOL_KEYS.api, { history: [] })
  }

  function handleClear() {
    updateState(TOOL_KEYS.api, {
      url: '',
      method: 'GET',
      headers: [{ key: '', value: '' }],
      body: '',
      history: [],
      lastResponse: null,
    })
  }

  return (
    <div className="animate-fade-slide-up flex h-full gap-3">
      <aside className="flex w-44 shrink-0 flex-col border-r pr-2">
        <div className="mb-1 flex items-center gap-1 border-b pb-1.5">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <History className="size-3.5" /> 历史记录
          </span>
          <button
            onClick={handleClearHistory}
            disabled={state.history.length === 0}
            className="ml-auto rounded px-1 py-0.5 text-[10px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40"
            title="清空历史"
          >
            清空
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">
          {state.history.length === 0 ? (
            <div className="py-4 text-center text-[11px] text-muted-foreground/60">暂无历史记录</div>
          ) : (
            state.history.map((h) => (
              <div key={h.id} className="group relative">
                <button
                  onClick={() => handleLoadHistory(h)}
                  className="flex w-full flex-col gap-0.5 rounded-md border border-transparent px-1.5 py-1 text-left transition-colors hover:border-input hover:bg-muted"
                >
                  <span className="flex min-w-0 items-center gap-1">
                    <span className={`w-9 shrink-0 text-[10px] font-semibold ${METHOD_COLORS[h.method] ?? ''}`}>
                      {h.method}
                    </span>
                    <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{h.url}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-muted-foreground/60">
                    {h.response?.status ? (
                      <span className={`rounded px-1 ${statusBadgeClass(h.response.status)}`}>
                        {h.response.status}
                      </span>
                    ) : (
                      <span className="rounded bg-orange-100 px-1 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300">
                        ERR
                      </span>
                    )}
                    <span className="truncate">{formatHistoryTime(h.createdAt)}</span>
                  </span>
                </button>
                <button
                  onClick={() => handleDeleteHistory(h.id)}
                  className="absolute right-1 top-1 hidden rounded p-0.5 text-muted-foreground/50 hover:text-red-500 group-hover:block"
                  title="删除该条"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))
          )}
        </div>
      </aside>

      <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="mb-1 flex items-center gap-2 border-b pb-1.5">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Send className="size-3.5" /> 接口调试
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={handleClear}
            className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent"
            title="清空请求配置与响应"
          >
            <RotateCcw className="size-3" /> 清空
          </button>
          <button
            onClick={handleSend}
            disabled={loading}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60"
          >
            <Send className="size-3" />
            {loading ? '请求中…' : '发送'}
          </button>
        </div>
      </div>

      <div className="shrink-0 space-y-2">
        <div className="flex gap-2">
          <Select
            value={state.method}
            onChange={(m) => updateState(TOOL_KEYS.api, { method: m })}
            options={METHODS.map((m) => ({ value: m, label: m }))}
            className="w-24 shrink-0"
          />
          <input
            value={state.url}
            onChange={(e) => updateState(TOOL_KEYS.api, { url: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) handleSend()
            }}
            placeholder="https://api.example.com/path"
            spellCheck={false}
            className="h-7 min-w-0 flex-1 rounded-md border border-input bg-transparent px-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>

        <div className="rounded-md border border-input">
          <button
            onClick={() => setShowHeaders((v) => !v)}
            className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {showHeaders ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            请求头
            {state.headers.some((h) => h.key.trim()) && (
              <span className="text-muted-foreground/60">
                （{state.headers.filter((h) => h.key.trim()).length} 项）
              </span>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setHeaders([...state.headers, { key: '', value: '' }])
              }}
              className="ml-auto flex items-center gap-0.5 rounded px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="添加请求头"
            >
              <Plus className="size-3" /> 添加
            </button>
          </button>
          {showHeaders && (
            <div className="max-h-28 overflow-y-auto border-t px-2 py-1.5">
              {state.headers.length === 0 && (
                <div className="py-1 text-[11px] text-muted-foreground/60">暂无请求头</div>
              )}
              {state.headers.map((h, i) => (
                <div key={i} className="mb-1 flex items-center gap-1.5 last:mb-0">
                  <input
                    value={h.key}
                    onChange={(e) => patchHeader(i, { key: e.target.value })}
                    placeholder="Header-Name"
                    spellCheck={false}
                    className="h-7 w-1/3 min-w-0 rounded border border-input bg-transparent px-2 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <input
                    value={h.value}
                    onChange={(e) => patchHeader(i, { value: e.target.value })}
                    placeholder="值"
                    spellCheck={false}
                    className="h-7 min-w-0 flex-1 rounded border border-input bg-transparent px-2 font-mono text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <button
                    onClick={() => setHeaders(state.headers.filter((_, k) => k !== i))}
                    disabled={state.headers.length <= 1}
                    className="shrink-0 rounded p-1 text-muted-foreground/50 hover:text-red-500 disabled:opacity-30"
                    title="删除"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="rounded-md border border-input">
          <button
            onClick={() => setShowBody((v) => !v)}
            className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-medium text-muted-foreground hover:text-foreground"
          >
            {showBody ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            请求体
            <button
              onClick={(e) => {
                e.stopPropagation()
                handleBeautifyBody()
              }}
              className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
              title="美化请求体（JSON 格式化）"
            >
              <Wand2 className="size-3" /> 美化
            </button>
          </button>
          {showBody && (
            <JsonEditor
              value={state.body}
              onChange={(body) => updateState(TOOL_KEYS.api, { body })}
              placeholder='JSON 或原始文本，如 {"name":"test"}'
              className="h-24 rounded-b-md border-t"
            />
          )}
        </div>
      </div>

      {error && (
        <div className="shrink-0 rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-xs text-orange-700 dark:border-orange-900 dark:bg-orange-950 dark:text-orange-300">
          {error}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 flex shrink-0 items-center gap-2 border-t pt-1.5">
          <span className="text-xs font-medium text-muted-foreground">响应</span>
          {response && (
            <>
              <span
                className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${statusBadgeClass(response.status ?? 0)}`}
              >
                {response.status} {response.statusText}
              </span>
              <span className="text-[11px] text-muted-foreground/70">
                {response.timeMs}ms · {formatSize(response.size ?? 0)}
              </span>
            </>
          )}
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setShowResponseHeaders((v) => !v)}
              disabled={!response || !response.headers || Object.keys(response.headers).length === 0}
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40"
            >
              {showResponseHeaders ? (
                <ChevronDown className="size-3" />
              ) : (
                <ChevronRight className="size-3" />
              )}
              响应头
            </button>
            <button
              onClick={async () => {
                const ok = await copyText(bodyText)
                toast(ok ? '已复制' : '复制失败')
              }}
              disabled={!bodyText}
              className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-40"
            >
              复制
            </button>
          </div>
        </div>

        {showResponseHeaders && response?.headers && Object.keys(response.headers).length > 0 && (
          <div className="mb-2 h-28 shrink-0 resize-y overflow-hidden rounded-md border border-input bg-muted/30 font-mono text-[11px]">
            <div className="h-full overflow-y-auto p-2">
              {Object.entries(response.headers).map(([k, v]) => (
                <div key={k} className="flex gap-2 whitespace-pre-wrap break-all leading-5">
                  <span className="shrink-0 font-medium text-muted-foreground">{k}:</span>
                  <span>{v}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1">
          {!response && !error ? (
            <div className="flex h-full items-center justify-center rounded-md border border-input bg-muted/30 text-xs text-muted-foreground">
              发送请求后，响应将显示在这里
            </div>
          ) : prettyJson ? (
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
                        <span
                          key={j}
                          className={
                            t.type === 'bracket'
                              ? BRACKET_COLORS[(t.depth ?? 0) % BRACKET_COLORS.length]
                              : t.type === 'key'
                                ? 'text-blue-600 dark:text-blue-300'
                                : t.type === 'string'
                                  ? 'text-green-700 dark:text-green-400'
                                  : t.type === 'number'
                                    ? 'text-orange-600 dark:text-orange-300'
                                    : t.type === 'boolean'
                                      ? 'text-violet-600 dark:text-violet-300'
                                      : t.type === 'null'
                                        ? 'text-red-600 dark:text-red-400'
                                        : 'text-muted-foreground'
                          }
                        >
                          {t.text}
                        </span>
                      ))}
                    </div>
                  )
                })}
              </div>
            </div>
          ) : bodyText ? (
            <textarea
              value={bodyText}
              readOnly
              spellCheck={false}
              className={`${TEXTAREA_CLS} h-full`}
            />
          ) : (
            <div className="flex h-full items-center justify-center rounded-md border border-input bg-muted/30 text-xs text-muted-foreground">
              无响应内容
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  )
}