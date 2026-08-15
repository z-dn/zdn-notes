import type { MindNode } from '@/types/tool'

export interface OutlineEdit {
  text: string
  selStart: number
  selEnd: number
}

export function addMindSibling(
  nodes: MindNode[],
  nodeId: string,
  sibling: MindNode,
): MindNode[] {
  const insertAfter = (list: MindNode[]): MindNode[] => {
    const out: MindNode[] = []
    for (const n of list) {
      out.push(n)
      if (n.id === nodeId) out.push(sibling)
    }
    return out
  }
  if (nodes.some((n) => n.id === nodeId)) return insertAfter(nodes)
  return nodes.map((n) => {
    if (n.children.some((c) => c.id === nodeId)) return { ...n, children: insertAfter(n.children) }
    if (n.children.length) return { ...n, children: addMindSibling(n.children, nodeId, sibling) }
    return n
  })
}

function lineRange(text: string, selStart: number, selEnd: number): { start: number; end: number } {
  const start = text.lastIndexOf('\n', selStart - 1) + 1
  let end = text.indexOf('\n', selEnd)
  if (end === -1) end = text.length
  return { start, end }
}

export function indentSelection(edit: OutlineEdit): OutlineEdit {
  const { text, selStart, selEnd } = edit
  const { start, end } = lineRange(text, selStart, selEnd)
  const segment = text.slice(start, end)
  const next = segment
    .split('\n')
    .map((line) => (line.length ? '  ' + line : line))
    .join('\n')
  const delta = next.length - segment.length
  return {
    text: text.slice(0, start) + next + text.slice(end),
    selStart,
    selEnd: selEnd + delta,
  }
}

export function outdentSelection(edit: OutlineEdit): OutlineEdit {
  const { text, selStart, selEnd } = edit
  const { start, end } = lineRange(text, selStart, selEnd)
  const segment = text.slice(start, end)
  const next = segment
    .split('\n')
    .map((line) => line.replace(/^ {2}/, ''))
    .join('\n')
  const delta = next.length - segment.length
  return {
    text: text.slice(0, start) + next + text.slice(end),
    selStart,
    selEnd: Math.max(selStart, selEnd + delta),
  }
}

export function continuationEdit(edit: OutlineEdit): OutlineEdit | null {
  const { text, selStart } = edit
  const { start } = lineRange(text, selStart, selStart)
  const before = text.slice(start, selStart)
  const match = before.match(/^(\s*)([-*])\s+(.+)$/)
  if (!match) return null
  const insert = '\n' + match[1] + match[2] + ' '
  const next = text.slice(0, selStart) + insert + text.slice(selStart)
  const pos = selStart + insert.length
  return { text: next, selStart: pos, selEnd: pos }
}
