import { useEffect, useRef, useState } from 'react'
import { List, Network, Trash2 } from 'lucide-react'
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
  const lastEmitted = useRef(source)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const taRef = useRef<HTMLTextAreaElement>(null)

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
    <div className="flex min-h-56 flex-col overflow-hidden rounded-md border border-input bg-muted/30">
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
      <div className="min-h-0 flex-1">
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
    </div>
  )
}
