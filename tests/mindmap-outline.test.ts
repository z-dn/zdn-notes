import { describe, it, expect } from 'vitest'
import type { MindNode } from '../src/types/tool'
import {
  addMindSibling,
  indentSelection,
  outdentSelection,
  continuationEdit,
} from '../src/lib/mindmap-outline'

function node(id: string, text: string, children: MindNode[] = []): MindNode {
  return { id, text, children }
}

describe('addMindSibling', () => {
  it('inserts a sibling after a top-level node', () => {
    const tree = [node('a', 'A'), node('b', 'B')]
    const next = addMindSibling(tree, 'a', node('x', 'X'))
    expect(next.map((n) => n.text)).toEqual(['A', 'X', 'B'])
  })

  it('inserts a sibling after a nested node', () => {
    const tree = [node('a', 'A', [node('a1', 'A1'), node('a2', 'A2')])]
    const next = addMindSibling(tree, 'a1', node('x', 'X'))
    expect(next[0].children.map((n) => n.text)).toEqual(['A1', 'X', 'A2'])
  })

  it('leaves the tree unchanged when the node is missing', () => {
    const tree = [node('a', 'A')]
    const next = addMindSibling(tree, 'nope', node('x', 'X'))
    expect(next).toEqual(tree)
  })
})

describe('indentSelection', () => {
  it('indents the current line with two spaces', () => {
    const text = '- A\n- B'
    const sel = text.indexOf('B')
    const next = indentSelection({ text, selStart: sel, selEnd: sel })
    expect(next.text).toBe('- A\n  - B')
  })

  it('indents every line covered by the selection', () => {
    const text = '- A\n- B\n- C'
    const next = indentSelection({ text, selStart: 0, selEnd: text.length })
    expect(next.text).toBe('  - A\n  - B\n  - C')
  })

  it('skips empty lines', () => {
    const text = '- A\n\n- B'
    const next = indentSelection({ text, selStart: 0, selEnd: text.length })
    expect(next.text).toBe('  - A\n\n  - B')
  })
})

describe('outdentSelection', () => {
  it('removes two leading spaces', () => {
    const text = '  - A\n- B'
    const sel = text.indexOf('A')
    const next = outdentSelection({ text, selStart: sel, selEnd: sel })
    expect(next.text).toBe('- A\n- B')
  })

  it('leaves lines without indentation unchanged', () => {
    const text = '- A\n- B'
    const next = outdentSelection({ text, selStart: 0, selEnd: text.length })
    expect(next.text).toBe('- A\n- B')
  })
})

describe('continuationEdit', () => {
  it('continues a list item with same indent on Enter', () => {
    const text = '- A\n  - B'
    const sel = text.length
    const next = continuationEdit({ text, selStart: sel, selEnd: sel })!
    expect(next.text).toBe('- A\n  - B\n  - ')
    expect(next.selStart).toBe(text.length + 5)
  })

  it('returns null for a non-list line', () => {
    const text = 'plain text'
    expect(continuationEdit({ text, selStart: text.length, selEnd: text.length })).toBeNull()
  })

  it('returns null for an empty list item', () => {
    const text = '- '
    expect(continuationEdit({ text, selStart: text.length, selEnd: text.length })).toBeNull()
  })

  it('continues after `* ` markers too', () => {
    const text = '* A'
    const sel = text.length
    const next = continuationEdit({ text, selStart: sel, selEnd: sel })!
    expect(next.text).toBe('* A\n* ')
  })
})
