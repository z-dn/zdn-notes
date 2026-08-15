import type { MindNode } from '@/types/tool'

export const MIND_NODE_W = 160
export const MIND_NODE_H = 36
export const MIND_LEVEL_GAP = 56
export const MIND_ROW_GAP = 16
export const MIND_PADDING = 24

export interface MindPosition {
  id: string
  x: number
  y: number
  node: MindNode
}

export interface MindLayout {
  width: number
  height: number
  nodes: MindPosition[]
  edges: { from: MindPosition; to: MindPosition }[]
}

function leafSlots(root: MindNode): Map<MindNode, number> {
  const slots = new Map<MindNode, number>()
  let next = 0
  const stack: MindNode[] = [...root.children].reverse()
  while (stack.length) {
    const node = stack.pop()!
    if (node.children.length === 0) {
      slots.set(node, next++)
    } else {
      for (const child of [...node.children].reverse()) stack.push(child)
    }
  }
  return slots
}

function assignY(node: MindNode, slots: Map<MindNode, number>): number {
  if (node.children.length === 0) return slots.get(node)!
  const ys = node.children.map((c) => assignY(c, slots))
  return (ys[0] + ys[ys.length - 1]) / 2
}

export function layoutMindmap(root: MindNode): MindLayout {
  const slots = leafSlots(root)
  const positions = new Map<string, { x: number; y: number }>()

  const assign = (node: MindNode, depth: number): void => {
    const y = assignY(node, slots)
    positions.set(node.id, {
      x: MIND_PADDING + depth * (MIND_NODE_W + MIND_LEVEL_GAP),
      y: MIND_PADDING + y * (MIND_NODE_H + MIND_ROW_GAP),
    })
    node.children.forEach((c) => assign(c, depth + 1))
  }
  assign(root, 0)

  const nodes: MindPosition[] = []
  const edges: { from: MindPosition; to: MindPosition }[] = []
  const walk = (node: MindNode, parent: MindNode | null): void => {
    const pos = positions.get(node.id)!
    nodes.push({ id: node.id, x: pos.x, y: pos.y, node })
    if (parent) {
      const ppos = positions.get(parent.id)!
      edges.push({ from: { id: parent.id, ...ppos, node: parent }, to: { id: node.id, ...pos, node } })
    }
    node.children.forEach((c) => walk(c, node))
  }
  walk(root, null)

  const maxDepth = Math.max(...root.children.map((n) => depthOf(n)), 0)
  const width = MIND_PADDING * 2 + (maxDepth + 1) * (MIND_NODE_W + MIND_LEVEL_GAP)
  const height = MIND_PADDING * 2 + Math.max(slots.size, 1) * (MIND_NODE_H + MIND_ROW_GAP)

  return { width, height, nodes, edges }
}

function depthOf(node: MindNode): number {
  let max = 0
  for (const c of node.children) max = Math.max(max, 1 + depthOf(c))
  return max
}

export function createMindNode(text: string, id?: string): MindNode {
  return { id: id ?? crypto.randomUUID(), text, children: [] }
}

export function createEmptyMindmap(): MindNode[] {
  return [createMindNode('中心主题')]
}

export function findMindNode(nodes: MindNode[], id: string): MindNode | null {
  for (const n of nodes) {
    if (n.id === id) return n
    const found = findMindNode(n.children, id)
    if (found) return found
  }
  return null
}

export function addMindChild(nodes: MindNode[], parentId: string, child: MindNode): MindNode[] {
  return nodes.map((n) => {
    if (n.id === parentId) {
      return { ...n, children: [...n.children, child] }
    }
    if (n.children.length) return { ...n, children: addMindChild(n.children, parentId, child) }
    return n
  })
}

export function removeMindNode(nodes: MindNode[], targetId: string): MindNode[] {
  const result: MindNode[] = []
  for (const n of nodes) {
    if (n.id === targetId) continue
    if (n.children.length) {
      result.push({ ...n, children: removeMindNode(n.children, targetId) })
    } else {
      result.push(n)
    }
  }
  return result
}

export function updateMindText(nodes: MindNode[], id: string, text: string): MindNode[] {
  return nodes.map((n) => {
    if (n.id === id) return { ...n, text }
    if (n.children.length) return { ...n, children: updateMindText(n.children, id, text) }
    return n
  })
}

export function mindmapToMarkdown(nodes: MindNode[], depth = 0): string {
  const indent = '  '.repeat(depth)
  return nodes
    .map((n) => {
      const children = n.children.length ? '\n' + mindmapToMarkdown(n.children, depth + 1) : ''
      return `${indent}- ${n.text}${children}`
    })
    .join('\n')
}

export function parseMindmap(text: string): MindNode[] {
  const nodes: MindNode[] = []
  const stack: { indent: number; node: MindNode }[] = []
  for (const rawLine of text.split('\n')) {
    const match = rawLine.replace(/\t/g, '  ').match(/^(\s*)[-*]\s+(.*)$/)
    if (!match) continue
    const indent = match[1].length
    const content = match[2].trim()
    if (!content) continue
    const node = createMindNode(content)
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop()
    if (stack.length) stack[stack.length - 1].node.children.push(node)
    else nodes.push(node)
    stack.push({ indent, node })
  }
  return nodes
}

export const MINDMAP_EMPTY_OUTLINE = '- 中心主题'

export function stripEmptyMindmapBlocks(markdown: string): string {
  const cleaned = markdown.replace(/```mindmap[^\n]*\n([\s\S]*?)```\n?/g, (match, inner: string) =>
    inner.trim() ? match : '',
  )
  return cleaned.replace(/\n{3,}/g, '\n\n')
}
