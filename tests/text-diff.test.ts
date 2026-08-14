import { describe, it, expect } from 'vitest'
import { computeDiffRows, countDiffStats } from '../src/lib/text-diff'

describe('computeDiffRows', () => {
  it('returns empty for identical empty inputs', () => {
    expect(computeDiffRows('', '')).toEqual([])
  })

  it('marks identical lines as common on both sides', () => {
    const rows = computeDiffRows('a\nb\n', 'a\nb\n')
    expect(rows).toHaveLength(2)
    expect(rows[0].left).toEqual({ text: 'a', type: 'common', segments: null })
    expect(rows[0].right).toEqual({ text: 'a', type: 'common', segments: null })
    expect(rows[1].left).toEqual({ text: 'b', type: 'common', segments: null })
    expect(rows[1].right).toEqual({ text: 'b', type: 'common', segments: null })
  })

  it('pairs a replaced line into a single row with char segments', () => {
    const rows = computeDiffRows('a\nx\n', 'a\ny\n')
    expect(rows).toHaveLength(2)
    expect(rows[1].left?.text).toBe('x')
    expect(rows[1].left?.type).toBe('removed')
    expect(rows[1].right?.text).toBe('y')
    expect(rows[1].right?.type).toBe('added')
  })

  it('marks an added line on the right side only', () => {
    const rows = computeDiffRows('a\n', 'a\nb\n')
    expect(rows).toHaveLength(2)
    expect(rows[1].left).toBeNull()
    expect(rows[1].right).toEqual({ text: 'b', type: 'added', segments: null })
  })

  it('marks a removed line on the left side only', () => {
    const rows = computeDiffRows('a\nb\n', 'a\n')
    expect(rows).toHaveLength(2)
    expect(rows[1].left).toEqual({ text: 'b', type: 'removed', segments: null })
    expect(rows[1].right).toBeNull()
  })

  it('pairs multiple removed lines with fewer added lines, keeping extras on the left', () => {
    const rows = computeDiffRows('a\nb\nc\n', 'a\nd\n')
    expect(rows).toHaveLength(3)
    expect(rows[0].left?.text).toBe('a')
    expect(rows[1].left?.text).toBe('b')
    expect(rows[1].right?.text).toBe('d')
    expect(rows[2].left?.text).toBe('c')
    expect(rows[2].right).toBeNull()
  })
})

describe('character-level segments', () => {
  it('highlights only the changed characters within a paired line', () => {
    const rows = computeDiffRows('foobar\n', 'foobaz\n')
    const segs = rows[0].right!.segments!
    expect(segs.map((s) => s.text).join('')).toBe('foobaz')
    expect(segs).toContainEqual({ text: 'fooba', type: 'common' })
    expect(segs).toContainEqual({ text: 'z', type: 'added' })
  })

  it('left side keeps removed characters as removed segments', () => {
    const rows = computeDiffRows('foobar\n', 'foobaz\n')
    const segs = rows[0].left!.segments!
    expect(segs).toContainEqual({ text: 'fooba', type: 'common' })
    expect(segs).toContainEqual({ text: 'r', type: 'removed' })
  })

  it('sets segments to null for unpaired lines', () => {
    const rows = computeDiffRows('a\n', 'a\nb\n')
    expect(rows[1].right!.segments).toBeNull()
  })
})

describe('countDiffStats', () => {
  it('counts added and removed lines', () => {
    const rows = computeDiffRows('a\nb\nc\n', 'a\nd\n')
    expect(countDiffStats(rows)).toEqual({ added: 1, removed: 2 })
  })

  it('returns zero for identical inputs', () => {
    expect(countDiffStats(computeDiffRows('x\n', 'x\n'))).toEqual({ added: 0, removed: 0 })
  })
})
