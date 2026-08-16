import { useEffect, useRef, useState } from 'react'
import { List, Network, RotateCcw, Trash2 } from 'lucide-react'
import type { MindNode } from '@/types/tool'
import { parseMindmap, mindmapToMarkdown } from '@/lib/mindmap'
import {
  indentSelection,
  outdentSelection,
  continuationEdit,
  type OutlineEdit,
} from '@/lib/mindmap-outline'
import { cn } from '@/lib/utils'
import { MindMapCanvas } from './mindmap-canvas'

const DEFAULT_HEIGHT = 240
const MIN_HEIGHT = 160
const MAX_HEIGHT = 640

export function MindMapBlock({
  source,
  onSourceChange,
  onDelete,
}: {
  source: string
  onSourceChange: (source: string) => void
  onDelete?: () => void
}) {
  const [view, setView] = useState<'outline' | 'canvas'>('outline')
  const [sourceText, setSourceText] = useState(source)
  const [nodes, setNodes] = useState<MindNode[]>(() => parseMindmap(source))
  const [height, setHeight] = useState(DEFAULT_HEIGHT)
  const lastEmitted = useRef(source)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const taRef = useRef<HTMLTextAreaElement>(null)

  function startResize(e: React.MouseEvent) {
    e.preventDefault()
    const startY = e.clientY
    const startH = height
    const prevSelect = document.body.style.userSelect
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => {
      setHeight(Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, startH + ev.clientY - startY)))
    }
    const onUp = () => {
      document.body.style.userSelect = prevSelect
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  useEffect(() => {
    if (source !== lastEmitted.current) {
      lastEmitted.current = source
      setSourceText(source)
      setNodes(parseMindmap(source))
    }
  }, [source])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  function emit(text: string) {
    if (timer.current) clearTimeout(timer.current)
    if (!text.trim()) {
      onDelete?.()
      return
    }
    if (text === lastEmitted.current) return
    lastEmitted.current = text
    timer.current = setTimeout(() => onSourceChange(text), 300)
  }

  function applyEdit(fn: (e: OutlineEdit) => OutlineEdit | null) {
    const ta = taRef.current
    if (!ta) return
    const next = fn({ text: ta.value, selStart: ta.selectionStart, selEnd: ta.selectionEnd })
    if (!next) return
    setSourceText(next.text)
    setNodes(parseMindmap(next.text))
    emit(next.text)
    requestAnimationFrame(() => {
      ta.selectionStart = next.selStart
      ta.selectionEnd = next.selEnd
    })
  }

  function handleTextChange(text: string) {
    setSourceText(text)
    setNodes(parseMindmap(text))
    emit(text)
  }

  function handleCanvasChange(next: MindNode[]) {
    setNodes(next)
    const text = next.length ? mindmapToMarkdown(next) : ''
    setSourceText(text)
    emit(text)
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-md border border-input bg-muted/30">
      <div className="flex items-center justify-between border-b border-divider px-2 py-1">
        <span className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
          <Network className="size-3" /> 思维图
        </span>
        <div className="flex items-center gap-1">
          <div className="flex gap-0.5 rounded-md bg-muted/50 p-0.5">
            {(['outline', 'canvas'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setView(m)}
                title={m === 'outline' ? '大纲编辑' : '思维图视图'}
                className={cn(
                  'flex items-center gap-1 rounded px-2 py-0.5 text-[11px] transition-colors',
                  view === m
                    ? 'bg-accent text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {m === 'outline' ? <List className="size-3" /> : <Network className="size-3" />}
                {m === 'outline' ? '大纲' : '图'}
              </button>
            ))}
          </div>
          {height !== DEFAULT_HEIGHT && (
            <button
              onClick={() => setHeight(DEFAULT_HEIGHT)}
              title="重置高度"
              className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <RotateCcw className="size-3" />
            </button>
          )}
          {onDelete && (
            <button
              onClick={onDelete}
              title="删除思维图"
              className="flex size-4 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </div>
      </div>
      <div className="min-h-40" style={{ height }}>
        {view === 'outline' ? (
          <textarea
            ref={taRef}
            value={sourceText}
            onChange={(e) => handleTextChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault()
                applyEdit(e.shiftKey ? outdentSelection : indentSelection)
              } else if (e.key === 'Enter') {
                const ta = taRef.current
                if (!ta) return
                const next = continuationEdit({
                  text: ta.value,
                  selStart: ta.selectionStart,
                  selEnd: ta.selectionEnd,
                })
                if (next) {
                  e.preventDefault()
                  setSourceText(next.text)
                  setNodes(parseMindmap(next.text))
                  emit(next.text)
                  requestAnimationFrame(() => {
                    ta.selectionStart = next.selStart
                    ta.selectionEnd = next.selEnd
                  })
                }
              }
            }}
            spellCheck={false}
            placeholder="- 中心主题"
            className="h-full w-full resize-none bg-transparent p-3 font-mono text-sm leading-relaxed focus:outline-none"
          />
        ) : (
          <MindMapCanvas nodes={nodes} onChange={handleCanvasChange} />
        )}
      </div>
      <div
        className="flex h-1.5 shrink-0 cursor-ns-resize items-center justify-center hover:bg-accent/50"
        onMouseDown={startResize}
        onDoubleClick={() => setHeight(DEFAULT_HEIGHT)}
        title="拖拽调整高度，双击复原"
      >
        <div className="h-0.5 w-8 rounded-full bg-border/70" />
      </div>
    </div>
  )
}
