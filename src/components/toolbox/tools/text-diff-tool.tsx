import { useMemo, type ReactNode } from 'react'
import { FileDiff, PanelTopClose, PanelTopOpen } from 'lucide-react'
import { useToolStore } from '@/stores/tool-store'
import { TOOL_KEYS, TOOL_DEFAULTS, type TextDiffToolState } from '@/types/tool'
import { computeDiffRows, countDiffStats, type DiffCell, type DiffRow } from '@/lib/text-diff'
import { copyText } from '@/lib/copy'
import { toast } from '@/lib/toast'

const TEXTAREA_CLS =
  'min-h-0 w-full flex-1 resize-none rounded-md border border-input bg-transparent p-2 font-mono text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'

function cellClass(cell: DiffCell | null): string {
  if (!cell) return ''
  if (cell.type === 'removed') return 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300'
  if (cell.type === 'added')
    return 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-300'
  return 'text-foreground'
}

function renderContent(cell: DiffCell): ReactNode {
  const { segments, text } = cell
  if (!segments || !segments.some((s) => s.type !== 'common')) return text
  return segments.map((seg, i) => {
    if (seg.type === 'removed')
      return (
        <span key={i} className="rounded-sm bg-red-200/70 dark:bg-red-900/60">
          {seg.text}
        </span>
      )
    if (seg.type === 'added')
      return (
        <span key={i} className="rounded-sm bg-green-200/70 dark:bg-green-900/60">
          {seg.text}
        </span>
      )
    return <span key={i}>{seg.text}</span>
  })
}

export function TextDiffTool() {
  const state =
    (useToolStore((s) => s.states[TOOL_KEYS.textDiff]) as TextDiffToolState | undefined) ??
    TOOL_DEFAULTS[TOOL_KEYS.textDiff]
  const updateState = useToolStore((s) => s.updateState)

  const rows = useMemo(
    () => computeDiffRows(state.original, state.modified),
    [state.original, state.modified],
  )
  const stats = useMemo(() => countDiffStats(rows), [rows])

  let leftNo = 0
  let rightNo = 0

  return (
    <div className="animate-fade-slide-up flex h-full flex-col gap-3">
      <div className="mb-2 flex items-center gap-2 border-b pb-1.5">
        <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <FileDiff className="size-3.5" /> 文本比较
        </span>
        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="text-green-700 dark:text-green-300">新增 {stats.added}</span>
          <span className="text-red-700 dark:text-red-300">删除 {stats.removed}</span>
        </div>
        <button
          onClick={() => updateState(TOOL_KEYS.textDiff, { inputCollapsed: !state.inputCollapsed })}
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
          onClick={() => updateState(TOOL_KEYS.textDiff, { original: '', modified: '' })}
          disabled={!state.original && !state.modified}
          className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
        >
          清空
        </button>
      </div>

      {state.inputCollapsed ? (
        <div className="rounded-md border border-dashed border-input px-3 py-1.5 text-xs text-muted-foreground">
          输入区已收起，点击上方「展开输入」恢复
        </div>
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-2 gap-2">
          <div className="flex min-h-0 flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">原文本</label>
              <button
                onClick={async () => {
                  const ok = await copyText(state.original)
                  toast(ok ? '已复制' : '复制失败')
                }}
                disabled={!state.original}
                className="text-[10px] text-muted-foreground/50 hover:text-foreground disabled:opacity-50"
              >
                复制
              </button>
            </div>
            <textarea
              value={state.original}
              onChange={(e) => updateState(TOOL_KEYS.textDiff, { original: e.target.value })}
              placeholder="粘贴原文本..."
              spellCheck={false}
              className={TEXTAREA_CLS}
            />
          </div>
          <div className="flex min-h-0 flex-col gap-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">新文本</label>
              <button
                onClick={async () => {
                  const ok = await copyText(state.modified)
                  toast(ok ? '已复制' : '复制失败')
                }}
                disabled={!state.modified}
                className="text-[10px] text-muted-foreground/50 hover:text-foreground disabled:opacity-50"
              >
                复制
              </button>
            </div>
            <textarea
              value={state.modified}
              onChange={(e) => updateState(TOOL_KEYS.textDiff, { modified: e.target.value })}
              placeholder="粘贴新文本..."
              spellCheck={false}
              className={TEXTAREA_CLS}
            />
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-1 flex items-center gap-3 text-xs text-muted-foreground">
          <span className="font-medium">比较结果</span>
          <span className="text-green-700 dark:text-green-300">新增 {stats.added}</span>
          <span className="text-red-700 dark:text-red-300">删除 {stats.removed}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-input">
          {rows.length === 0 ? (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              输入内容后自动比较
            </div>
          ) : (
            <div className="min-w-[640px] font-mono text-xs">
              {rows.map((row: DiffRow, i) => {
                const lno = row.left ? ++leftNo : ''
                const rno = row.right ? ++rightNo : ''
                return (
                  <div key={i} className="flex leading-5">
                    <div className="w-10 shrink-0 select-none border-r border-border/50 pr-1.5 text-right text-muted-foreground/40">
                      {lno}
                    </div>
                    <div
                      className={`min-h-5 flex-1 whitespace-pre-wrap break-all border-r border-border/50 px-2 ${cellClass(row.left)}`}
                    >
                      {row.left ? renderContent(row.left) : ''}
                    </div>
                    <div className="w-10 shrink-0 select-none border-r border-border/50 pr-1.5 text-right text-muted-foreground/40">
                      {rno}
                    </div>
                    <div
                      className={`min-h-5 flex-1 whitespace-pre-wrap break-all px-2 ${cellClass(row.right)}`}
                    >
                      {row.right ? renderContent(row.right) : ''}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
