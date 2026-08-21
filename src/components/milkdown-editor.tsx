import { useRef, useCallback, useEffect } from 'react'
import { Editor, rootCtx, defaultValueCtx, editorViewOptionsCtx, editorViewCtx } from '@milkdown/core'
import type { MilkdownPlugin } from '@milkdown/ctx'
import { Milkdown, MilkdownProvider, useEditor } from '@milkdown/react'
import { commonmark } from '@milkdown/preset-commonmark'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { TextSelection } from '@milkdown/prose/state'
import type { EditorView } from '@milkdown/prose/view'
import './milkdown-theme.css'

interface MilkdownEditorProps {
  content: string
  onChange: (markdown: string) => void
  extraPlugins?: MilkdownPlugin[]
  commonmarkPlugins?: MilkdownPlugin[]
  onEditorReady?: (editor: Editor | undefined) => void
}

function milkdownTheme(ctx: any) {
  ctx.update(editorViewOptionsCtx, (prev: any) => {
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

function MilkdownEditorInner({
  content,
  onChange,
  extraPlugins,
  commonmarkPlugins,
  onEditorReady,
}: MilkdownEditorProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const extraPluginsRef = useRef(extraPlugins)
  extraPluginsRef.current = extraPlugins
  const commonmarkPluginsRef = useRef(commonmarkPlugins)
  commonmarkPluginsRef.current = commonmarkPlugins
  const onEditorReadyRef = useRef(onEditorReady)
  onEditorReadyRef.current = onEditorReady
  const editorRef = useRef<Editor | undefined>(undefined)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(
    () => () => {
      onEditorReadyRef.current?.(undefined)
    },
    [],
  )

  const handlePasteImages = useCallback(async (view: EditorView, items: DataTransferItemList) => {
    const imageItems = Array.from(items).filter((item) => item.type.startsWith('image/'))
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue
      try {
        const dataUri = await fileToDataUrl(file)
        const url = await window.electronAPI.saveImageFromData(dataUri)
        insertImageNode(view, url, file.name.replace(/\.[^.]+$/, ''))
      } catch (err) {
        console.error('Failed to paste image:', err)
      }
    }
  }, [])

  const handleDropImages = useCallback(async (view: EditorView, files: FileList) => {
    const imageFiles = Array.from(files).filter((file) => file.type.startsWith('image/'))
    for (const file of imageFiles) {
      try {
        const dataUri = await fileToDataUrl(file)
        const url = await window.electronAPI.saveImageFromData(dataUri)
        insertImageNode(view, url, file.name.replace(/\.[^.]+$/, ''))
      } catch (err) {
        console.error('Failed to drop image:', err)
      }
    }
  }, [])

  // 兜底：点击 contenteditable 外部（padding 区域）时，把光标置到文档末尾。
  // 用 setTimeout(0) 延迟到当前 mousedown 事件处理完毕后再 focus，
  // 避免浏览器在 mousedown 阶段阻止 focus 生效。
  useEffect(() => {
    const el = wrapperRef.current?.parentElement
    if (!el) return
    const onDown = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('.milkdown-editor')) return
      const editor = editorRef.current
      if (!editor) return
      setTimeout(() => {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx)
          view.focus()
          view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)))
        })
      }, 0)
    }
    el.addEventListener('mousedown', onDown)
    return () => el.removeEventListener('mousedown', onDown)
  }, [])

  useEditor(
    (root) => {
      const editor = Editor.make()
        .config(milkdownTheme)
        .config((ctx) => {
          ctx.set(rootCtx, root)
          ctx.set(defaultValueCtx, content)
          ctx.update(editorViewOptionsCtx, (prev) => ({
            ...prev,
            handlePaste: (view, event) => {
              const items = event.clipboardData?.items
              if (!items) return false
              if (Array.from(items).some((item) => item.type.startsWith('image/'))) {
                event.preventDefault()
                void handlePasteImages(view, items)
                return true
              }
              return false
            },
            handleDrop: (view, event) => {
              const files = event.dataTransfer?.files
              if (!files) return false
              if (Array.from(files).some((file) => file.type.startsWith('image/'))) {
                event.preventDefault()
                void handleDropImages(view, files)
                return true
              }
              return false
            },
            handleKeyDown: (view, event) => {
              if (event.key !== 'Tab') return false
              const { $from } = view.state.selection
              for (let d = $from.depth; d > 0; d--) {
                const name = $from.node(d).type.name
                if (name === 'list_item' || name === 'bullet_list' || name === 'ordered_list') return false
              }
              event.preventDefault()
              return true
            },
            handleDOMEvents: {
              // 拦截 contenteditable 内部的空白区域点击
              mousedown: (view, event) => {
                const pos = view.posAtCoords({ left: event.clientX, top: event.clientY })
                if (!pos) {
                  // 不调 preventDefault — 让 ProseMirror 默认行为（focus）正常执行
                  setTimeout(() => {
                    view.focus()
                    view.dispatch(
                      view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)),
                    )
                  }, 0)
                  return true
                }
                return false
              },
            },
          }))
          ctx.get(listenerCtx).markdownUpdated((_ctx, markdown) => {
            onChangeRef.current(markdown)
          })
        })
      const cmPlugins = commonmarkPluginsRef.current ?? commonmark
      for (const p of cmPlugins) editor.use(p)
      for (const p of extraPluginsRef.current ?? []) editor.use(p)
      editor.use(listener)
      editorRef.current = editor
      onEditorReadyRef.current?.(editor)
      return editor
    },
    [handlePasteImages, handleDropImages],
  )

  return (
    <div ref={wrapperRef} className="h-full min-h-0">
      <Milkdown />
    </div>
  )
}

export function MilkdownEditor(props: MilkdownEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  )
}
