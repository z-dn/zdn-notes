import { useCallback, useEffect, useState } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight, Clipboard, Eraser, FolderOpen, RefreshCw } from 'lucide-react'
import { toast } from '@/lib/toast'
import { Select } from '@/components/ui/select'
import { TipButton } from '@/components/tip-button'

type AppLogLevel = 'info' | 'warn' | 'error'

const LEVEL_OPTIONS: { value: '' | AppLogLevel; label: string }[] = [
  { value: '', label: '全部级别' },
  { value: 'error', label: '仅错误' },
  { value: 'warn', label: '仅警告' },
  { value: 'info', label: '仅信息' },
]

const SOURCE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部来源' },
  { value: 'dsh', label: 'DSH' },
]

const LEVEL_STYLES: Record<AppLogLevel, string> = {
  info: 'bg-muted text-muted-foreground',
  warn: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  error: 'bg-red-500/10 text-red-600 dark:text-red-400',
}

/** 设置页「运行日志」小节：落盘日志的查看/筛选/复制/清空 + 实时增量 */
export function LogViewer() {
  const [logs, setLogs] = useState<AppLogEntry[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [source, setSource] = useState('')
  const [level, setLevel] = useState<'' | AppLogLevel>('')

  const load = useCallback(async () => {
    const entries = await window.electronAPI.logsGet({
      source: source || undefined,
      level: level || undefined,
      limit: 500,
    })
    setLogs(entries)
  }, [source, level])

  useEffect(() => {
    void load().catch(() => setLogs([]))
  }, [load])

  useEffect(() => {
    const unsub = window.electronAPI.onLogAppended((entry) => {
      setLogs((prev) => [entry, ...prev].slice(0, 500))
    })
    return unsub
  }, [])

  function handleCopy() {
    const text = logs
      .map(
        (e) =>
          `[${format(new Date(e.ts), 'yyyy-MM-dd HH:mm:ss')}] ${e.level.toUpperCase()} ${e.source}: ${e.message}` +
          (e.detail ? `\n${e.detail}` : ''),
      )
      .join('\n\n')
    void navigator.clipboard
      .writeText(text)
      .then(() => toast('已复制到剪贴板'))
      .catch(() => toast('复制失败'))
  }

  async function handleClear() {
    await window.electronAPI.logsClear()
    setLogs([])
  }

  return (
    <div>
      <label className="mb-2 block text-xs font-medium text-muted-foreground">应用日志</label>
      <div className="mb-2 flex items-center gap-2">
        <Select
          value={source}
          onChange={setSource}
          options={SOURCE_OPTIONS}
          className="w-24 shrink-0"
        />
        <Select
          value={level}
          onChange={(v) => setLevel(v as '' | AppLogLevel)}
          options={LEVEL_OPTIONS}
          className="w-24 shrink-0"
        />
        <div className="ml-auto flex items-center gap-1">
          <TipButton tip="刷新" onClick={() => void load()} className="p-1.5">
            <RefreshCw className="size-3.5" />
          </TipButton>
          <TipButton tip="复制日志" onClick={handleCopy} className="p-1.5">
            <Clipboard className="size-3.5" />
          </TipButton>
          <TipButton
            tip="清空日志"
            onClick={() => void handleClear()}
            className="p-1.5 hover:text-destructive"
          >
            <Eraser className="size-3.5" />
          </TipButton>
          <TipButton
            tip="打开日志目录"
            onClick={() => void window.electronAPI.logsOpenDir()}
            className="p-1.5"
          >
            <FolderOpen className="size-3.5" />
          </TipButton>
        </div>
      </div>

      <div className="max-h-56 space-y-1 overflow-y-auto rounded-md border border-input bg-muted/30 p-2">
        {logs.length === 0 ? (
          <p className="text-[11px] text-muted-foreground">暂无日志。</p>
        ) : (
          logs.map((entry) => {
            const expanded = expandedId === entry.id
            return (
              <div key={entry.id}>
                <button
                  onClick={() => (entry.detail ? setExpandedId(expanded ? null : entry.id) : null)}
                  className={`flex w-full items-start gap-2 rounded px-1 py-0.5 text-left text-[11px] hover:bg-accent text-muted-foreground ${
                    entry.detail ? 'cursor-pointer' : 'cursor-default'
                  }`}
                >
                  {entry.detail ? (
                    expanded ? (
                      <ChevronDown className="mt-0.5 size-3 shrink-0" />
                    ) : (
                      <ChevronRight className="mt-0.5 size-3 shrink-0" />
                    )
                  ) : (
                    <span className="w-3 shrink-0" />
                  )}
                  <span className="shrink-0 tabular-nums text-muted-foreground/70">
                    {format(new Date(entry.ts), 'MM-dd HH:mm:ss')}
                  </span>
                  <span className={`shrink-0 rounded px-1 text-[10px] leading-4 ${LEVEL_STYLES[entry.level]}`}>
                    {entry.level.toUpperCase()}
                  </span>
                  <span className="shrink-0 text-muted-foreground/70">[{entry.source}]</span>
                  <span className="break-all text-foreground">{entry.message}</span>
                </button>
                {expanded && entry.detail && (
                  <pre className="ml-5 mr-1 mb-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-[10px] text-muted-foreground">
                    {entry.detail}
                  </pre>
                )}
              </div>
            )
          })
        )}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        异常与关键操作会自动记录（当前最多保留 2000 条）。
      </p>
    </div>
  )
}
