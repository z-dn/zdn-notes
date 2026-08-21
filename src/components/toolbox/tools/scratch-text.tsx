import { useRef, useState } from 'react'
import type { Editor } from '@milkdown/core'
import { editorViewCtx } from '@milkdown/core'
import { MilkdownEditor } from '@/components/milkdown-editor'
import { useToolStore } from '@/stores/tool-store'
import { TOOL_KEYS, TOOL_DEFAULTS, type ScratchPage, type ScratchToolState } from '@/types/tool'
import { stripEmptyMindmapBlocks } from '@/lib/mindmap'
import { EditorContextMenu } from './editor-context-menu'
import {
  mindmapNode,
  registerMindmapEditor,
  unregisterMindmapEditor,
  insertMindmapBlock,
  commonmarkForMindmap,
} from './mindmap-node'

interface MenuState {
  x: number
  y: number
  pos: number
}

export function ScratchText({ page }: { page: ScratchPage }) {
  const updateState = useToolStore((s) => s.updateState)
  const mine = useRef<Editor | undefined>(undefined)
  const containerRef = useRef<HTMLDivElement>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [content] = useState(() => stripEmptyMindmapBlocks(page.markdown))
  const [mountKey] = useState(() => crypto.randomUUID())

  function handleChange(markdown: string) {
    const cleaned = stripEmptyMindmapBlocks(markdown)
    const scratch = (useToolStore.getState().states[TOOL_KEYS.scratch] ??
      TOOL_DEFAULTS[TOOL_KEYS.scratch]) as ScratchToolState
    const current = scratch.pages.find((p) => p.id === page.id)
    if (current && cleaned === current.markdown) return
    updateState(TOOL_KEYS.scratch, {
      pages: scratch.pages.map((p) =>
        p.id === page.id ? { ...p, markdown: cleaned, updatedAt: Date.now() } : p,
      ),
    })
  }

  function handleContextMenu(e: React.MouseEvent) {
    if ((e.target as HTMLElement).closest('.mindmap-block')) return
    e.preventDefault()
    const editor = mine.current
    if (!editor) return
    const pos = editor.action((ctx) => {
      const view = ctx.get(editorViewCtx)
      const coords = view.posAtCoords({ left: e.clientX, top: e.clientY })
      if (coords?.pos != null) return coords.pos
      return view.state.doc.content.size
    })
    const rect = containerRef.current?.getBoundingClientRect() ?? { left: 0, top: 0 }
    setMenu({ x: e.clientX - rect.left, y: e.clientY - rect.top, pos })
  }

  return (
    <div
      ref={containerRef}
      className="scratchpad-editor relative h-full min-h-0 overflow-auto rounded-md border border-input px-4 py-3"
      onContextMenu={handleContextMenu}
    >
      <MilkdownEditor
        key={mountKey}
        content={content}
        onChange={handleChange}
        extraPlugins={mindmapNode}
        commonmarkPlugins={commonmarkForMindmap}
        onEditorReady={(editor) => {
          if (editor) {
            if (mine.current && mine.current !== editor) unregisterMindmapEditor(mine.current)
            mine.current = editor
            registerMindmapEditor(editor)
          } else if (mine.current) {
            unregisterMindmapEditor(mine.current)
            mine.current = undefined
          }
        }}
      />
      {menu && (
        <EditorContextMenu
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onInsert={() => insertMindmapBlock(menu.pos)}
        />
      )}
    </div>
  )
}
