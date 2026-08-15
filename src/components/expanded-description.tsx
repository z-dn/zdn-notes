import { useState, useEffect, useRef } from 'react'
import { useTaskStore } from '@/stores/task-store'
import { useSettingsStore } from '@/stores/settings-store'
import { MilkdownEditor } from '@/components/milkdown-editor'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { renderMarkdown } from '@/lib/markdown'
import { setMinimapSource, publishMinimapContent } from '@/lib/minimap-bus'
import { FadeBlock } from '@/components/fade'

export function ExpandedDescription() {
  const selectedTask = useTaskStore((s) => s.selectedTask)
  const updateTask = useTaskStore((s) => s.updateTask)
  const setExpandedDesc = useTaskStore((s) => s.setExpandedDesc)
  const expandedDescId = useTaskStore((s) => s.expandedDescId)
  const origin = useTaskStore((s) => s.expandedDescOrigin)
  const descriptionMode = useSettingsStore((s) => s.saved.descriptionMode)
  const [description, setDescription] = useState('')
  const [previewMode, setPreviewMode] = useState(false)
  const [renderedDesc, setRenderedDesc] = useState('')
  const descTimer = useRef<number>(undefined)
  const elRef = useRef<HTMLDivElement>(null)
  const originRef = useRef(origin)
  originRef.current = origin

  const updateDescription = (md: string) => {
    setDescription(md)
    publishMinimapContent(md)
  }

  const registerScroll = (el: HTMLElement | null) => {
    setMinimapSource(el)
  }

  useEffect(() => {
    if (selectedTask) {
      setDescription(selectedTask.description || '')
      publishMinimapContent(selectedTask.description || '')
      setPreviewMode(false)
    }
  }, [selectedTask])

  useEffect(() => {
    renderMarkdown(description).then(setRenderedDesc)
  }, [description])

  const prevId = useRef<string | null>(null)

  useEffect(() => {
    const el = elRef.current
    if (!el) return

    const entering = expandedDescId && !prevId.current
    const exiting = !expandedDescId && prevId.current
    prevId.current = expandedDescId

    if (entering) {
      const o = originRef.current
      const parent = el.parentElement
      if (!o || !parent) { el.style.opacity = '1'; return }

      const cr = parent.getBoundingClientRect()
      const tx = o.x - cr.left
      const ty = o.y - cr.top
      const sx = o.width / cr.width
      const sy = o.height / cr.height

      el.style.transition = 'none'
      el.style.transformOrigin = '0 0'
      el.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`
      el.style.opacity = '0'

      void el.offsetHeight

      el.style.transition =
        'transform var(--duration-medium) var(--ease-out), opacity var(--duration-base) var(--ease-out)'
      el.style.transform = 'translate(0, 0) scale(1, 1)'
      el.style.opacity = '1'
    } else if (exiting) {
      const o = originRef.current
      const parent = el.parentElement
      if (!o || !parent) { el.style.opacity = '0'; return }

      const cr = parent.getBoundingClientRect()
      const tx = o.x - cr.left
      const ty = o.y - cr.top
      const sx = o.width / cr.width
      const sy = o.height / cr.height

      el.style.transition =
        'transform var(--duration-medium) var(--ease-in), opacity var(--duration-base) var(--ease-in)'
      el.style.transform = `translate(${tx}px, ${ty}px) scale(${sx}, ${sy})`
      el.style.opacity = '0'
    } else if (!expandedDescId) {
      el.style.transition = 'none'
      el.style.opacity = '0'
    }
  }, [expandedDescId])

  if (!selectedTask) {
    return (
      <div ref={elRef} className="flex h-full items-center justify-center text-sm text-muted-foreground" style={{ opacity: 0 }}>
        未选择任务
      </div>
    )
  }

  return (
    <div ref={elRef} className="flex h-full flex-col" style={{ opacity: expandedDescId ? undefined : 0 }}>
      <div className="flex h-11 items-center justify-between border-b border-divider px-4">
        <div className="flex items-center gap-2 min-w-0">
          <Tooltip>
            <TooltipTrigger asChild>
              <h2 className="truncate text-sm font-semibold">{selectedTask.title}</h2>
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start">
              <p className="max-w-xs break-words">{selectedTask.title}</p>
            </TooltipContent>
          </Tooltip>
          <span className="shrink-0 text-[11px] text-muted-foreground/50">描述</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {descriptionMode === 'toggle' && (
            <button
              onClick={() => setPreviewMode((p) => !p)}
              className="rounded px-2 py-1 text-[11px] text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
            >
              {previewMode ? '编辑' : '预览'}
            </button>
          )}
          <button
            onClick={() => setExpandedDesc(null)}
            className="flex items-center gap-1 rounded px-2 py-1 text-[11px] text-muted-foreground/50 transition-colors hover:bg-accent hover:text-foreground"
          >
            ✕ 收起
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-4">
        <FadeBlock show={descriptionMode === 'edit'} className="h-full">
          <div ref={registerScroll} className="h-full overflow-y-auto rounded-md border border-input p-4">
            <MilkdownEditor key={selectedTask.id} content={selectedTask.description || ''} onChange={(markdown) => {
                updateDescription(markdown)
                clearTimeout(descTimer.current)
                descTimer.current = setTimeout(() => {
                  updateTask({ id: selectedTask.id, description: markdown })
                }, 500)
              }}
            />
          </div>
        </FadeBlock>
        <FadeBlock show={descriptionMode === 'toggle' && previewMode} className="h-full w-full">
          <div
            ref={registerScroll}
            className="h-full w-full overflow-auto break-words rounded-md border border-input bg-transparent p-4 text-sm
              [&_ul]:list-disc [&_ul]:pl-4
              [&_ol]:list-decimal [&_ol]:pl-4
              [&_code]:rounded [&_code]:bg-muted [&_code]:px-1
              [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs
              [&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground
              [&_h1]:text-lg [&_h1]:font-bold
              [&_h2]:text-base [&_h2]:font-semibold
              [&_h3]:text-sm [&_h3]:font-medium"
            dangerouslySetInnerHTML={{ __html: renderedDesc }}
          />
        </FadeBlock>
        <FadeBlock show={descriptionMode === 'toggle' && !previewMode} className="h-full w-full">
          <textarea
            ref={registerScroll}
            value={description}
            onChange={(e) => {
              updateDescription(e.target.value)
              clearTimeout(descTimer.current)
              descTimer.current = setTimeout(() => {
                updateTask({ id: selectedTask.id, description: e.target.value })
              }, 500)
            }}
            onBlur={() => {
              clearTimeout(descTimer.current)
              if (description !== selectedTask.description) {
                updateTask({ id: selectedTask.id, description })
              }
            }}
            onKeyDown={(e) => {
              if (e.key === 'Tab') {
                e.preventDefault()
                const el = e.currentTarget
                const start = el.selectionStart ?? 0
                const end = el.selectionEnd ?? start
                const next = description.slice(0, start) + '\t' + description.slice(end)
                updateDescription(next)
                clearTimeout(descTimer.current)
                descTimer.current = setTimeout(() => {
                  updateTask({ id: selectedTask.id, description: next })
                }, 500)
                requestAnimationFrame(() => {
                  el.selectionStart = el.selectionEnd = start + 1
                })
              }
            }}
            placeholder="支持 Markdown 格式..."
            className="h-full w-full resize-none rounded-md border border-input bg-transparent p-4 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </FadeBlock>
      </div>
    </div>
  )
}
