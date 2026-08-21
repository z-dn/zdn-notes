import type { Ctx, MilkdownPlugin } from '@milkdown/ctx'
import { $inputRule, $nodeSchema, $view } from '@milkdown/utils'
import { editorViewCtx, schemaCtx } from '@milkdown/core'
import { insert } from '@milkdown/utils'
import type { Editor } from '@milkdown/core'
import type { NodeViewConstructor } from '@milkdown/prose/view'
import type { EditorView } from '@milkdown/prose/view'
import type { Node } from '@milkdown/prose/model'
import { TextSelection } from '@milkdown/prose/state'
import { InputRule, textblockTypeInputRule } from '@milkdown/prose/inputrules'
import { createRoot } from 'react-dom/client'
import { commonmark, codeBlockSchema, createCodeBlockInputRule } from '@milkdown/preset-commonmark'
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

// 输入 ```mindmap 时默认会被 code_block 的 input rule 命中生成普通代码块。
// 这里替换掉原版 input rule（负向先行断言跳过 mindmap），
// 让 ```js 等仍生成代码块，```mindmap 则落到 mindmapInputRule 生成思维图。
const patchedCodeBlockInputRule = $inputRule((ctx) =>
  textblockTypeInputRule(
    /^```(?<language>(?!mindmap)[a-z]*)?[\s\n]$/,
    codeBlockSchema.type(ctx),
    (match) => ({ language: match.groups?.language ?? '' }),
  ),
)

export const commonmarkForMindmap: MilkdownPlugin[] = [
  ...commonmark.filter((p) => p !== createCodeBlockInputRule),
  patchedCodeBlockInputRule,
  ...patchedCodeBlock,
]

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

// 输入 ```mindmap + 空格/回车 时把输入标记替换为思维图节点 + 后续空段落，
// 否则它只会被当成普通代码块。
const mindmapInputRule = $inputRule((ctx) =>
  new InputRule(/^```mindmap[\s\n]$/, (state, _match, start, _end) => {
    const $start = state.doc.resolve(start)
    if ($start.parent.type.name !== 'paragraph') return null
    const schema = ctx.get(schemaCtx)
    const mindmap = schema.nodes.mindmap.create({ source: MINDMAP_EMPTY_OUTLINE })
    const para = schema.nodes.paragraph.create()
    const from = $start.before()
    const to = from + $start.parent.nodeSize
    const tr = state.tr.replaceWith(from, to, mindmap)
    tr.insert(from + 1, para)
    tr.setSelection(TextSelection.near(tr.doc.resolve(tr.doc.content.size)))
    return tr
  }),
)

export const mindmapNode: MilkdownPlugin[] = [
  ...mindmapSchema,
  mindmapInputRule,
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
    ensureParagraphAfterMindmap(view)
  })
}

// atom 块本身没有可输入的位置：当思维图恰好是文档末尾（或唯一）的块时，
// 在后面补一个空段落，否则用户无法继续输入文本。
function ensureParagraphAfterMindmap(view: EditorView) {
  const doc = view.state.doc
  const last = doc.lastChild
  if (!last || last.type.name !== 'mindmap') return
  const end = doc.content.size
  view.dispatch(view.state.tr.insert(end, doc.type.schema.nodes.paragraph.create()))
}
