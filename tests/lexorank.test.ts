import { describe, it, expect } from 'vitest'
import { generateBetween, needsRebalance, rebalance } from '../src/lib/lexorank'

describe('generateBetween', () => {
  it('first item returns 0', () => {
    expect(generateBetween(null, null)).toBe(0)
  })

  it('insert at beginning', () => {
    expect(generateBetween(null, 10)).toBe(9)
  })

  it('insert at end', () => {
    expect(generateBetween(10, null)).toBe(11)
  })

  it('insert between two items', () => {
    expect(generateBetween(1, 3)).toBe(2)
  })

  it('insert between consecutive integers', () => {
    expect(generateBetween(0, 1)).toBe(0.5)
  })

  it('insert between successive middles', () => {
    let rank = generateBetween(0, 1)
    expect(rank).toBe(0.5)

    rank = generateBetween(0, rank)
    expect(rank).toBe(0.25)

    rank = generateBetween(0, rank)
    expect(rank).toBe(0.125)

    rank = generateBetween(0, rank)
    expect(rank).toBe(0.0625)
  })

  it('throws when precision exhausted', () => {
    let low = 0
    let high = 1
    for (let i = 0; i < 50; i++) {
      const mid = (low + high) / 2
      if (mid === low || mid === high) {
        expect(() => generateBetween(low, high)).toThrow('Lexorank precision exhausted')
        return
      }
      ;[low, high] = [low, mid]
      if (i === 49) {
        expect(() => generateBetween(low, high)).toThrow('Lexorank precision exhausted')
      }
    }
  })
})

describe('needsRebalance', () => {
  it('returns false for fewer than 2 items', () => {
    expect(needsRebalance([])).toBe(false)
    expect(needsRebalance([5])).toBe(false)
  })

  it('returns false when gaps are large enough', () => {
    expect(needsRebalance([0, 65536, 131072])).toBe(false)
  })

  it('returns true when items are too close', () => {
    expect(needsRebalance([0, 1e-13])).toBe(true)
  })
})

describe('rebalance', () => {
  it('returns empty for empty input', () => {
    expect(rebalance([])).toEqual([])
  })

  it('returns [0] for single item', () => {
    expect(rebalance([42])).toEqual([0])
  })

  it('distributes evenly preserving order', () => {
    const result = rebalance([0.1, 0.2, 0.3])
    expect(result).toEqual([0, 65536, 131072])
  })

  it('preserves original order for unsorted input', () => {
    const result = rebalance([100, 50, 200])
    expect(result).toEqual([65536, 0, 131072])
  })
})
