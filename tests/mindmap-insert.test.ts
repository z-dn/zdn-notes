import { beforeEach, describe, it, expect } from 'vitest'
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/core'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { getMarkdown } from '@milkdown/utils'
import { EditorView } from '@milkdown/prose/view'
import {
  mindmapNode,
  commonmarkForMindmap,
  insertMindmapBlock,
  registerMindmapEditor,
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

describe('insertMindmapBlock', () => {
  it('leaves a paragraph after the mindmap when inserted as the first block', async () => {
    const { editor, root } = await makeEditor('')
    registerMindmapEditor(editor)
    insertMindmapBlock(0)
    const out = editor.action((ctx) => blocks(ctx.get(editorViewCtx)))
    const md = editor.action(getMarkdown())
    expect(out).toBe('mindmap|paragraph')
    expect(md).toContain('```mindmap')
    expect(md).toContain('- 中心主题')
    await editor.destroy()
    root.remove()
  })

  it('does not duplicate a paragraph that already follows the mindmap', async () => {
    const { editor, root } = await makeEditor('# 标题\n\n正文\n')
    registerMindmapEditor(editor)
    insertMindmapBlock(1)
    const out = editor.action((ctx) => blocks(ctx.get(editorViewCtx)))
    expect(out).toContain('mindmap')
    expect(out).toContain('paragraph')
    expect(out.split('|').filter((b) => b.startsWith('paragraph')).length).toBeLessThanOrEqual(1)
    await editor.destroy()
    root.remove()
  })
})