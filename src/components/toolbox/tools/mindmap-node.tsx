import type { Ctx, MilkdownPlugin } from '@milkdown/ctx'
import { $nodeSchema, $view } from '@milkdown/utils'
import { editorViewCtx } from '@milkdown/core'
import { insert } from '@milkdown/utils'
import type { Editor } from '@milkdown/core'
import type { NodeViewConstructor } from '@milkdown/prose/view'
import type { Node } from '@milkdown/prose/model'
import { TextSelection } from '@milkdown/prose/state'
import { createRoot } from 'react-dom/client'
import { commonmark, codeBlockSchema } from '@milkdown/preset-commonmark'
import { MindMapBlock } from './mindmap-block'
import { MINDMAP_EMPTY_OUTLINE } from '@/lib/mindmap'

// commonmark 的 code_block 会匹配所有 fenced code，导致 ```mindmap 无法被解析为思维图。
// 这里在 commonmark 之后追加一个打过补丁的 code_block（跳过 mindmap 语言），
// 后注册的 $ctx 会覆盖原版 schema factory；同时思维图节点放在 commonmark 之后注册，
// 让 paragraph 成为首个 block，空文档不会被思维图节点自动填充。
const patchedCodeBlock = codeBlockSchema.extendSchema((prev) => (ctx) => {
  const prevSchema = prev(ctx)
  return {
    ...prevSchema,
    parseMarkdown: {
      ...prevSchema.parseMarkdown,
      match: (node) =>
        prevSchema.parseMarkdown.match(node) &&
        (node as { lang?: string | null }).lang !== 'mindmap',
    },
  }
})

export const commonmarkForMindmap: MilkdownPlugin[] = [...commonmark, ...patchedCodeBlock]

export const mindmapSchema = $nodeSchema('mindmap', () => ({
  group: 'block',
  atom: true,
  attrs: { source: { default: '' } },
  parseDOM: [
    {
      tag: 'div[data-mindmap]',
      getAttrs: (dom) => {
        if (!(dom instanceof HTMLElement)) return {}
        return { source: dom.dataset.source ?? '' }
      },
    },
  ],
  toDOM: (node: Node) => [
    'div',
    { 'data-mindmap': 'true', 'data-source': String(node.attrs.source ?? '') },
  ],
  parseMarkdown: {
    match: ({ type, lang }: { type: string; lang?: string | null }) =>
      type === 'code' && lang === 'mindmap',
    runner: (state, node, type) => {
      state.addNode(type, { source: String(node.value ?? '') })
    },
  },
  toMarkdown: {
    match: (node: Node) => node.type.name === 'mindmap',
    runner: (state, node: Node) => {
      state.addNode('code', undefined, String(node.attrs.source ?? ''), { lang: 'mindmap' })
    },
  },
}))

const mindmapViewFactory = (): NodeViewConstructor => {
  return (node, view, getPos) => {
    const dom = document.createElement('div')
    dom.className = 'mindmap-block'
    const root = createRoot(dom)
    let current = node

    const render = () => {
      root.render(
        <MindMapBlock
          source={String(current.attrs.source ?? '')}
          onSourceChange={(source) => {
            const pos = getPos()
            if (typeof pos !== 'number') return
            view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { source }))
          }}
          onDelete={() => {
            const pos = getPos()
            if (typeof pos !== 'number') return
            const target = view.state.doc.nodeAt(pos)
            if (!target) return
            view.dispatch(view.state.tr.delete(pos, pos + target.nodeSize))
          }}
        />,
      )
    }
    render()

    return {
      dom,
      update: (newNode) => {
        if (newNode.type.name !== 'mindmap') return false
        if (newNode.attrs.source !== current.attrs.source) {
          current = newNode
          render()
        }
        return true
      },
      destroy: () => root.unmount(),
      stopEvent: () => true,
      ignoreMutation: (m) => (m.type === 'selection' ? false : true),
    }
  }
}

export const mindmapNode: MilkdownPlugin[] = [
  ...mindmapSchema,
  $view(mindmapSchema.node, mindmapViewFactory),
]

let activeEditor: Editor | undefined

export function registerMindmapEditor(editor: Editor | undefined) {
  activeEditor = editor
}

export function unregisterMindmapEditor(editor: Editor | undefined) {
  if (activeEditor === editor) activeEditor = undefined
}

export function insertMindmapBlock(pos?: number) {
  if (!activeEditor) return
  activeEditor.action((ctx: Ctx) => {
    const view = ctx.get(editorViewCtx)
    if (typeof pos === 'number') {
      const size = view.state.doc.content.size
      const $pos = view.state.doc.resolve(Math.max(0, Math.min(pos, size)))
      view.dispatch(view.state.tr.setSelection(TextSelection.near($pos)))
    }
    view.focus()
    insert(`\`\`\`mindmap\n${MINDMAP_EMPTY_OUTLINE}\n\`\`\`\n`, false)(ctx)
  })
}
