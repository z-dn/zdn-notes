import { useRef, useCallback } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx } from '@milkdown/core'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { commonmark } from '@milkdown/preset-commonmark'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import type { EditorView } from '@milkdown/prose/view'
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

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function insertImageNode(view: EditorView, src: string, alt: string) {
  const imageNode = view.state.schema.nodes.image.create({ src, alt })
  const tr = view.state.tr.replaceSelectionWith(imageNode)
  view.dispatch(tr)
  view.focus()
}

function MilkdownEditorInner({ content, onChange }: MilkdownEditorProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  const handlePasteImage = useCallback(async (view: EditorView, item: DataTransferItem) => {
    const file = item.getAsFile()
    if (!file) return
    try {
      const dataUri = await fileToDataUrl(file)
      const url = await window.electronAPI.saveImageFromData(dataUri)
      insertImageNode(view, url, file.name.replace(/\.[^.]+$/, ''))
    } catch (err) {
      console.error('Failed to paste image:', err)
    }
  }, [])

  const handleDropImage = useCallback(async (view: EditorView, file: File) => {
    try {
      const dataUri = await fileToDataUrl(file)
      const url = await window.electronAPI.saveImageFromData(dataUri)
      insertImageNode(view, url, file.name.replace(/\.[^.]+$/, ''))
    } catch (err) {
      console.error('Failed to drop image:', err)
    }
  }, [])

  useEditor(
    (root) => {
      return Editor.make()
        .config(milkdownTheme)
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, content)
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            handlePaste: (view, event) => {
              const items = event.clipboardData?.items
              if (!items) return false
              for (const item of items) {
                if (item.type.startsWith('image/')) {
                  event.preventDefault()
                  handlePasteImage(view, item)
                  return true
                }
              }
              return false
            },
            handleDrop: (view, event) => {
              const files = event.dataTransfer?.files
              if (!files) return false
              for (const file of files) {
                if (file.type.startsWith('image/')) {
                  event.preventDefault()
                  handleDropImage(view, file)
                  return true
                }
              }
              return false
            },
          }))
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            onChangeRef.current(markdown)
          })
        })
        .use(commonmark)
        .use(listener)
    },
    [handlePasteImage, handleDropImage],
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
