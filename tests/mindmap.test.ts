import { describe, it, expect } from 'vitest'
import type { MindNode } from '../src/types/tool'
import {
  layoutMindmap,
  addMindChild,
  removeMindNode,
  updateMindText,
  findMindNode,
  mindmapToMarkdown,
  createEmptyMindmap,
  parseMindmap,
  stripEmptyMindmapBlocks,
} from '../src/lib/mindmap'

function node(id: string, text: string, children: MindNode[] = []): MindNode {
  return { id, text, children }
}

describe('layoutMindmap', () => {
  it('lays out a single root with no children', () => {
    const root = node('r', 'root')
    const layout = layoutMindmap(root)
    expect(layout.nodes).toHaveLength(1)
    expect(layout.edges).toHaveLength(0)
    expect(layout.width).toBeGreaterThan(0)
    expect(layout.height).toBeGreaterThan(0)
  })

  it('connects parent and children', () => {
    const root = node('r', 'root', [node('a', 'A'), node('b', 'B')])
    const layout = layoutMindmap(root)
    expect(layout.nodes).toHaveLength(3)
    expect(layout.edges).toHaveLength(2)
    const a = layout.nodes.find((n) => n.id === 'a')!
    const b = layout.nodes.find((n) => n.id === 'b')!
    expect(a.y).not.toBe(b.y)
    expect(a.x).toBe(b.x)
  })

  it('separates sibling y positions at same depth', () => {
    const root = node('r', 'root', [
      node('a', 'A', [node('a1', 'A1')]),
      node('b', 'B'),
      node('c', 'C'),
    ])
    const layout = layoutMindmap(root)
    const ys = layout.nodes
      .filter((n) => n.node.text === 'A' || n.node.text === 'B' || n.node.text === 'C')
      .map((n) => n.y)
    expect(new Set(ys).size).toBe(3)
  })
})

describe('tree operations', () => {
  const root = node('r', 'root', [node('a', 'A', [node('a1', 'A1')]), node('b', 'B')])

  it('adds a child under a node', () => {
    const child = node('x', 'X')
    const next = addMindChild(root.children, 'b', child)
    expect(next[1].children).toContain(child)
  })

  it('removes a node and its subtree', () => {
    const next = removeMindNode(root.children, 'a')
    expect(next.map((n) => n.id)).toEqual(['b'])
  })

  it('updates text immutably', () => {
    const next = updateMindText(root.children, 'a1', 'renamed')
    const a1 = findMindNode(next, 'a1')!
    expect(a1.text).toBe('renamed')
    expect(findMindNode(root.children, 'a1')!.text).toBe('A1')
  })

  it('finds nested nodes', () => {
    expect(findMindNode(root.children, 'a1')?.text).toBe('A1')
    expect(findMindNode(root.children, 'nope')).toBeNull()
  })

  it('produces nested markdown outline', () => {
    const md = mindmapToMarkdown(root.children)
    expect(md).toContain('- A\n  - A1')
    expect(md).toContain('- B')
  })

  it('creates an empty mindmap with a single root', () => {
    const nodes = createEmptyMindmap()
    expect(nodes).toHaveLength(1)
    expect(nodes[0].children).toEqual([])
  })
})

describe('parseMindmap', () => {
  it('parses a flat list', () => {
    const nodes = parseMindmap('- A\n- B\n- C')
    expect(nodes.map((n) => n.text)).toEqual(['A', 'B', 'C'])
  })

  it('parses nested indentation into a tree', () => {
    const nodes = parseMindmap('- A\n  - A1\n    - A1a\n  - A2\n- B')
    expect(nodes.map((n) => n.text)).toEqual(['A', 'B'])
    expect(nodes[0].children.map((n) => n.text)).toEqual(['A1', 'A2'])
    expect(nodes[0].children[0].children.map((n) => n.text)).toEqual(['A1a'])
  })

  it('round-trips with mindmapToMarkdown', () => {
    const original = '- 中心\n  - 甲\n    - 甲1\n  - 乙\n- 尾巴'
    const nodes = parseMindmap(original)
    expect(mindmapToMarkdown(nodes)).toBe(original)
  })

  it('ignores non-list lines and empty entries', () => {
    const nodes = parseMindmap('hello\n- A\n\n  - A1\n-  ')
    expect(nodes.map((n) => n.text)).toEqual(['A'])
    expect(nodes[0].children.map((n) => n.text)).toEqual(['A1'])
  })
})

describe('stripEmptyMindmapBlocks', () => {
  it('removes an empty mindmap fence', () => {
    expect(stripEmptyMindmapBlocks('```mindmap\n```\n')).toBe('')
  })

  it('keeps a mindmap fence with content', () => {
    const md = '```mindmap\n- 中心主题\n```\n'
    expect(stripEmptyMindmapBlocks(md)).toBe(md)
  })

  it('removes an empty block but keeps surrounding text', () => {
    const md = '# 标题\n\n```mindmap\n```\n\n结尾\n'
    expect(stripEmptyMindmapBlocks(md)).toBe('# 标题\n\n结尾\n')
  })
})
