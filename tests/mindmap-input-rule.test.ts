import { beforeEach, describe, it, expect } from 'vitest'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/core'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { EditorView } from '@milkdown/prose/view'
import { TextSelection } from '@milkdown/prose/state'
import { getMarkdown } from '@milkdown/utils'
import {
  mindmapNode,
  commonmarkForMindmap,
} from '../src/components/toolbox/tools/mindmap-node'

beforeEach(() => {
  const emptyRects = (): unknown =>
    ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} }) as DOMRectList
  Object.defineProperty(Element.prototype, 'getClientRects', { value: emptyRects, configurable: true })
  Object.defineProperty(Text.prototype, 'getClientRects', { value: emptyRects, configurable: true })
  Object.defineProperty(EditorView.prototype, 'scrollToSelection', {
    value: () => undefined,
    configurable: true,
  })
})

async function makeEditor(markdown: string) {
  const root = document.createElement('div')
  document.body.appendChild(root)
  const editor = Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root)
      ctx.set(defaultValueCtx, markdown)
      ctx.get(listenerCtx).markdownUpdated(() => {})
    })
  for (const p of commonmarkForMindmap) editor.use(p)
  for (const p of mindmapNode) editor.use(p)
  editor.use(listener)
  await editor.create()
  return { editor, root }
}

function blocks(view: import('@milkdown/prose/view').EditorView): string {
  const list: string[] = []
  view.state.doc.forEach((node) => {
    list.push(node.type.name + (node.textContent ? `:"${node.textContent}"` : ''))
  })
  return list.join('|')
}

// tr.insertText 不会触发 prosemirror-inputrules 的 handleTextInput；
// 这里经 view.someProp 走真实输入路径，模拟键盘输入。
function typeText(view: import('@milkdown/prose/view').EditorView, text: string) {
  const from = view.state.selection.from
  const to = view.state.selection.to
  const handled = view.someProp('handleTextInput', (f) => f(view, from, to, text))
  if (!handled) view.dispatch(view.state.tr.insertText(text, from, to))
}

function getView(editor: Editor) {
  return editor.action((ctx) => ctx.get(editorViewCtx))
}

describe('mindmap fenced-code input rule', () => {
  it('converts ```mindmap into a mindmap block, not a code block', async () => {
    const { editor, root } = await makeEditor('')
    const view = getView(editor)
    for (const ch of '```mindmap ') typeText(view, ch)
    const out = blocks(view)
    expect(out).toBe('mindmap|paragraph')
    expect(editor.action(getMarkdown())).toContain('```mindmap')
    await editor.destroy()
    root.remove()
  })

  it('still converts ```js into a plain code block', async () => {
    const { editor, root } = await makeEditor('')
    const view = getView(editor)
    for (const ch of '```js ') typeText(view, ch)
    const out = blocks(view)
    expect(out).toBe('code_block')
    expect(out).not.toContain('mindmap')
    await editor.destroy()
    root.remove()
  })

  it('deleting a leading mindmap lets plain text be typed instead of a code block', async () => {
    const { editor, root } = await makeEditor('')
    const view = getView(editor)
    for (const ch of '```mindmap ') typeText(view, ch)
    // 删除思维图块（首块 + 其后空段落），剩一个空段落
    const first = view.state.doc.firstChild
    if (first) view.dispatch(view.state.tr.delete(0, first.nodeSize))
    view.dispatch(view.state.tr.setSelection(TextSelection.atStart(view.state.doc)))
    for (const ch of 'hello') typeText(view, ch)
    const out = blocks(view)
    expect(out).toBe('paragraph:"hello"')
    expect(out).not.toContain('code_block')
    expect(out).not.toContain('mindmap')
    await editor.destroy()
    root.remove()
  })

  it('inserts a mindmap at the start of a non-first paragraph', async () => {
    const { editor, root } = await makeEditor('第一段\n\n第二段')
    const view = getView(editor)
    // 将光标移到「第二段」行首
    const secondStart = view.state.doc.content.size - 3
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(secondStart))))
    for (const ch of '```mindmap ') typeText(view, ch)
    const out = blocks(view)
    const parts = out.split('|')
    expect(parts[0]).toContain('第一段')
    expect(parts[1]).toContain('mindmap')
    await editor.destroy()
    root.remove()
  })
})
