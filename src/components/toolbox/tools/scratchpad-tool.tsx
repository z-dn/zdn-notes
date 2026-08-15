import { useEffect, useRef, useState } from 'react'
import { ClipboardCopy, Eraser, NotebookPen, Pencil, Plus, X } from 'lucide-react'
import { useToolStore } from '@/stores/tool-store'
import {
  TOOL_KEYS,
  TOOL_DEFAULTS,
  type ScratchPage,
  type ScratchToolState,
} from '@/types/tool'
import { copyText } from '@/lib/copy'
import { toast } from '@/lib/toast'
import { showConfirm } from '@/components/confirm-dialog'
import { cn } from '@/lib/utils'
import { ScratchText } from './scratch-text'

function createPage(pages: ScratchPage[]): ScratchPage {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title: `草稿 ${pages.length + 1}`,
    markdown: '',
    createdAt: now,
    updatedAt: now,
  }
}

export function ScratchpadTool() {
  const scratch = useToolStore((s) => s.states[TOOL_KEYS.scratch]) as
    | ScratchToolState
    | undefined
  const loaded = useToolStore((s) => s.loaded)
  const updateState = useToolStore((s) => s.updateState)

  const state = scratch ?? TOOL_DEFAULTS[TOOL_KEYS.scratch]
  const pages = state.pages
  const activePage = pages.find((p) => p.id === state.activePageId) ?? pages[0] ?? null

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameText, setRenameText] = useState('')
  const renameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (loaded && pages.length === 0) {
      const page = createPage([])
      updateState(TOOL_KEYS.scratch, { pages: [page], activePageId: page.id })
    }
  }, [loaded, pages.length, updateState])

  function patchPages(next: ScratchPage[]) {
    updateState(TOOL_KEYS.scratch, { pages: next })
  }

  function switchPage(id: string) {
    if (id !== state.activePageId) updateState(TOOL_KEYS.scratch, { activePageId: id })
  }

  function addPage() {
    const next = createPage(pages)
    patchPages([...pages, next])
    updateState(TOOL_KEYS.scratch, { activePageId: next.id })
  }

  function commitRename() {
    if (renamingId && renameText.trim()) {
      patchPages(
        pages.map((p) =>
          p.id === renamingId ? { ...p, title: renameText.trim(), updatedAt: Date.now() } : p,
        ),
      )
    }
    setRenamingId(null)
  }

  async function deletePage(page: ScratchPage) {
    const ok = await showConfirm('删除草稿', `确定删除「${page.title}」吗？内容将无法恢复。`)
    if (!ok) return
    const remaining = pages.filter((p) => p.id !== page.id)
    const nextState: Partial<ScratchToolState> = { pages: remaining }
    if (page.id === state.activePageId) {
      nextState.activePageId = remaining[0]?.id ?? ''
    }
    updateState(TOOL_KEYS.scratch, nextState)
  }

  async function handleCopy() {
    if (!activePage) return
    const ok = await copyText(activePage.markdown.trim())
    toast(ok ? '已复制' : '复制失败')
  }

  async function handleClear() {
    if (!activePage) return
    const ok = await showConfirm(
      '清空内容',
      `确定清空「${activePage.title}」的全部内容吗？`,
    )
    if (!ok) return
    patchPages(
      pages.map((p) =>
        p.id === activePage.id ? { ...p, markdown: '', updatedAt: Date.now() } : p,
      ),
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="mb-2 border-b border-divider pb-1.5">
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
            <NotebookPen className="size-3.5" /> 草稿纸
          </span>
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={handleCopy}
              disabled={!activePage}
              title="复制内容"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
            >
              <ClipboardCopy className="size-3" />
            </button>
            <button
              onClick={handleClear}
              disabled={!activePage}
              title="清空内容"
              className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent disabled:opacity-50"
            >
              <Eraser className="size-3" />
            </button>
          </div>
        </div>

        <div className="mt-2 flex items-center gap-1 overflow-x-auto">
          {pages.map((page) => (
            <div
              key={page.id}
              className={cn(
                'group flex max-w-40 items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors',
                page.id === activePage?.id
                  ? 'bg-accent font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {renamingId === page.id ? (
                <input
                  ref={renameInputRef}
                  value={renameText}
                  autoFocus
                  onChange={(e) => setRenameText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename()
                    if (e.key === 'Escape') setRenamingId(null)
                  }}
                  onBlur={commitRename}
                  className="w-20 rounded border border-input bg-background px-1 text-[11px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              ) : (
                <button
                  className="max-w-28 flex-1 truncate"
                  onClick={() => switchPage(page.id)}
                  onDoubleClick={() => {
                    setRenamingId(page.id)
                    setRenameText(page.title)
                    requestAnimationFrame(() => renameInputRef.current?.focus())
                  }}
                  title={page.title}
                >
                  {page.title}
                </button>
              )}
              <button
                className="hidden text-muted-foreground hover:text-foreground group-hover:block"
                title="重命名"
                onClick={() => {
                  setRenamingId(page.id)
                  setRenameText(page.title)
                  requestAnimationFrame(() => renameInputRef.current?.focus())
                }}
              >
                <Pencil className="size-3" />
              </button>
              <button
                className="hidden text-muted-foreground hover:text-destructive group-hover:block"
                title="删除草稿"
                onClick={() => void deletePage(page)}
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
          <button
            onClick={addPage}
            title="新建草稿"
            className="flex items-center gap-0.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="size-3" />
          </button>
        </div>
      </div>

      {activePage ? (
        <div className="min-h-0 flex-1">
          <ScratchText key={activePage.id} page={activePage} />
        </div>
      ) : (
        <div className="flex h-full items-center justify-center rounded-md border border-input bg-muted/30 text-xs text-muted-foreground">
          <button
            onClick={addPage}
            className="flex items-center gap-1 rounded px-3 py-1.5 text-primary hover:bg-accent"
          >
            <Plus className="size-3.5" /> 新建草稿
          </button>
        </div>
      )}
    </div>
  )
}
