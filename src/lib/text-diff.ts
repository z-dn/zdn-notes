import { diffLines, diffChars } from 'diff'

export type DiffRowType = 'added' | 'removed' | 'common'

export interface CharSegment {
  text: string
  type: DiffRowType
}

export interface DiffCell {
  text: string
  type: DiffRowType
  segments: CharSegment[] | null
}

export interface DiffRow {
  left: DiffCell | null
  right: DiffCell | null
}

function splitLines(value: string): string[] {
  const lines = value.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

function charSegments(a: string, b: string): { left: CharSegment[]; right: CharSegment[] } {
  const changes = diffChars(a, b)
  const left: CharSegment[] = []
  const right: CharSegment[] = []
  for (const change of changes) {
    if (change.removed) {
      left.push({ text: change.value, type: 'removed' })
    } else if (change.added) {
      right.push({ text: change.value, type: 'added' })
    } else if (change.value) {
      left.push({ text: change.value, type: 'common' })
      right.push({ text: change.value, type: 'common' })
    }
  }
  return { left, right }
}

export function computeDiffRows(original: string, modified: string): DiffRow[] {
  const changes = diffLines(original, modified)
  const rows: DiffRow[] = []
  const pendingRemoved: string[] = []
  const pendingAdded: string[] = []

  const flush = () => {
    const n = Math.max(pendingRemoved.length, pendingAdded.length)
    for (let i = 0; i < n; i++) {
      const removed = i < pendingRemoved.length ? pendingRemoved[i] : null
      const added = i < pendingAdded.length ? pendingAdded[i] : null
      let left: DiffCell | null = null
      let right: DiffCell | null = null
      if (removed !== null && added !== null) {
        const segs = charSegments(removed, added)
        left = { text: removed, type: 'removed', segments: segs.left }
        right = { text: added, type: 'added', segments: segs.right }
      } else if (removed !== null) {
        left = { text: removed, type: 'removed', segments: null }
      } else if (added !== null) {
        right = { text: added, type: 'added', segments: null }
      }
      rows.push({ left, right })
    }
    pendingRemoved.length = 0
    pendingAdded.length = 0
  }

  for (const change of changes) {
    const lines = splitLines(change.value)
    if (change.added) {
      pendingAdded.push(...lines)
    } else if (change.removed) {
      pendingRemoved.push(...lines)
    } else {
      flush()
      for (const line of lines) {
        rows.push({
          left: { text: line, type: 'common', segments: null },
          right: { text: line, type: 'common', segments: null },
        })
      }
    }
  }
  flush()

  return rows
}

export function countDiffStats(rows: DiffRow[]): { added: number; removed: number } {
  let added = 0
  let removed = 0
  for (const row of rows) {
    if (row.right?.type === 'added') added++
    if (row.left?.type === 'removed') removed++
  }
  return { added, removed }
}
