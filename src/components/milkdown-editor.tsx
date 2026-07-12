import { useRef } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/core'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { commonmark } from '@milkdown/preset-commonmark'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import './milkdown-theme.css'

interface MilkdownEditorProps {
  content: string
  onChange: (markdown: string) => void
}

function milkdownTheme(ctx: any) {
  ctx.update(editorViewOptionsCtx, (prev) => {
    const prevClass = prev.attributes
    return {
      ...prev,
      attributes: (state: any) => {
        const attrs = typeof prevClass === 'function' ? prevClass(state) : prevClass
        return {
          ...attrs,
          class: ['milkdown-editor', attrs?.class || ''].filter(Boolean).join(' '),
        }
      },
    }
  })
}

function MilkdownEditorInner({ content, onChange }: MilkdownEditorProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEditor(
    (root) => {
      return Editor.make()
        .config(milkdownTheme)
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, content)
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            onChangeRef.current(markdown)
          })
        })
        .use(commonmark)
        .use(listener)
    },
    [],
  )

  return <Milkdown />
}

export function MilkdownEditor(props: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  )
}
