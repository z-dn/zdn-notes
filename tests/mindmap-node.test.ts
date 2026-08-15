import { describe, it, expect } from 'vitest'
import { Editor, rootCtx, defaultValueCtx } from '@milkdown/core'
import { listener, listenerCtx } from '@milkdown/plugin-listener'
import { getMarkdown } from '@milkdown/utils'
import {
  mindmapNode,
  commonmarkForMindmap,
} from '../src/components/toolbox/tools/mindmap-node'

async function serialize(markdown: string): Promise<string> {
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
  const out = editor.action(getMarkdown())
  await editor.destroy()
  root.remove()
  return out
}

describe('mindmap Milkdown node', () => {
  it('does not inject a mindmap block into empty content', async () => {
    expect(await serialize('')).toBe('')
    expect(await serialize('\n')).toBe('')
  })

  it('serializes a plain document unchanged', async () => {
    const md = await serialize('# 标题\n\n正文内容\n')
    expect(md).toContain('# 标题')
    expect(md).toContain('正文内容')
  })

  it('keeps a mindmap fenced block intact on round-trip', async () => {
    const source = '- 中心主题\n  - 子节点 A\n    - A1\n  - 子节点 B'
    const md = await serialize(`# 标题\n\n\`\`\`mindmap\n${source}\n\`\`\`\n\n结尾\n`)
    expect(md).toContain('```mindmap')
    expect(md).toContain(source)
    expect(md).toContain('# 标题')
    expect(md).toContain('结尾')
  })

  it('does not convert plain code blocks to mindmaps', async () => {
    const md = await serialize('```js\nconst a = 1\n```\n')
    expect(md).toContain('```js')
    expect(md).toContain('const a = 1')
  })
})
