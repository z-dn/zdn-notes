const MIN_GAP = 1e-12

export function generateBetween(
  before: number | null,
  after: number | null,
): number {
  if (before === null && after === null) {
    return 0
  }
  if (before === null) {
    return after! - 1
  }
  if (after === null) {
    return before + 1
  }

  const rank = (before + after) / 2

  if (Math.abs(rank - before) < MIN_GAP || Math.abs(after - rank) < MIN_GAP) {
    throw new Error('Lexorank precision exhausted, rebalance required')
  }

  return rank
}

export function needsRebalance(ranks: number[]): boolean {
  if (ranks.length < 2) return false
  const sorted = [...ranks].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i] - sorted[i - 1]) < MIN_GAP) {
      return true
    }
  }
  return false
}

export function rebalance(ranks: number[]): number[] {
  if (ranks.length === 0) return []
  if (ranks.length === 1) return [0]

  const sorted = [...ranks].sort((a, b) => a - b)
  const rankMap = new Map<number, number>()
  sorted.forEach((rank, i) => {
    rankMap.set(rank, i * 65536)
  })
  return ranks.map((rank) => rankMap.get(rank)!)
}
