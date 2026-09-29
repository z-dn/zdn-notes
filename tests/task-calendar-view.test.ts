import { describe, it, expect } from 'vitest'
import {
  buildMonthGrid,
  dayKey,
  groupTasksByDueDay,
  isOverdue,
  parentBounds,
  taskDropUpdate,
  taskRange,
  violatesParentRange,
  RANGE_DAY_LIMIT,
} from '../src/components/task-calendar-view'
import type { Task } from '../src/types/task'

function mk(id: string, over: Partial<Task> = {}): Task {
  return {
    id,
    title: id,
    description: '',
    status: 'todo',
    priority: 'P2',
    dueDate: null,
    startDate: null,
    reminderTime: null,
    parentId: null,
    orderIndex: 0,
    tags: [],
    owner: '',
    categoryId: null,
    meta: {},
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

describe('dayKey', () => {
  it('时间戳按本地时区归入 yyyy-MM-dd', () => {
    const d = new Date(2026, 8, 15, 23, 59, 59)
    expect(dayKey(d.getTime())).toBe('2026-09-15')
    expect(dayKey(d)).toBe('2026-09-15')
  })

  it('月初月末边界正确', () => {
    expect(dayKey(new Date(2026, 0, 1, 0, 0, 0).getTime())).toBe('2026-01-01')
    expect(dayKey(new Date(2026, 11, 31, 12).getTime())).toBe('2026-12-31')
  })
})

describe('groupTasksByDueDay', () => {
  it('按 dueDate 归格，无日期进 unscheduled', () => {
    const d1 = new Date(2026, 8, 15, 10).getTime()
    const d2 = new Date(2026, 8, 15, 22).getTime()
    const d3 = new Date(2026, 8, 16, 9).getTime()
    const { byDay, unscheduled } = groupTasksByDueDay([
      mk('a', { dueDate: d1 }),
      mk('b', { dueDate: d2 }),
      mk('c', { dueDate: d3 }),
      mk('d', { dueDate: null }),
    ])
    expect(byDay.get('2026-09-15')?.map((t) => t.id)).toEqual(['a', 'b'])
    expect(byDay.get('2026-09-16')?.map((t) => t.id)).toEqual(['c'])
    expect(unscheduled.map((t) => t.id)).toEqual(['d'])
  })

  it('同日按优先级排序，同优先级按标题', () => {
    const due = new Date(2026, 8, 20, 12).getTime()
    const { byDay } = groupTasksByDueDay([
      mk('t1', { dueDate: due, priority: 'P2', title: 'beta' }),
      mk('t2', { dueDate: due, priority: 'P0', title: 'zeta' }),
      mk('t3', { dueDate: due, priority: 'P2', title: 'alpha' }),
    ])
    expect(byDay.get('2026-09-20')?.map((t) => t.id)).toEqual(['t2', 't3', 't1'])
  })

  it('空输入返回空结构', () => {
    const { byDay, unscheduled } = groupTasksByDueDay([])
    expect(byDay.size).toBe(0)
    expect(unscheduled).toEqual([])
  })
})

describe('buildMonthGrid', () => {
  it('2026-09 从周一 8/31 到周日 10/4，共 5 周', () => {
    const grid = buildMonthGrid(new Date(2026, 8, 15))
    expect(grid.length).toBe(35)
    expect(grid[0].key).toBe('2026-08-31')
    expect(grid[grid.length - 1].key).toBe('2026-10-04')
    expect(grid[0].date.getDay()).toBe(1)
    expect(grid.filter((c) => c.inMonth).length).toBe(30)
  })

  it('2026-08（周六起始）需要 6 周', () => {
    const grid = buildMonthGrid(new Date(2026, 7, 15))
    expect(grid.length).toBe(42)
    expect(grid[0].key).toBe('2026-07-27')
    expect(grid[grid.length - 1].key).toBe('2026-09-06')
  })

  it('长度恒为 7 的倍数且 key 唯一', () => {
    const grid = buildMonthGrid(new Date(2026, 1, 1))
    expect(grid.length % 7).toBe(0)
    expect(new Set(grid.map((c) => c.key)).size).toBe(grid.length)
  })
})

describe('taskRange', () => {
  it('两者皆空返回 null', () => {
    expect(taskRange(mk('a'))).toBeNull()
  })

  it('只有 dueDate/只有 startDate 时起止相同', () => {
    const due = new Date(2026, 8, 15, 23, 59).getTime()
    expect(taskRange(mk('a', { dueDate: due }))).toEqual({ start: due, end: due })
    const start = new Date(2026, 8, 10, 0, 0).getTime()
    expect(taskRange(mk('b', { startDate: start }))).toEqual({ start, end: start })
  })

  it('区间为 startDate → dueDate', () => {
    const s = new Date(2026, 8, 10).getTime()
    const d = new Date(2026, 8, 12).getTime()
    expect(taskRange(mk('a', { startDate: s, dueDate: d }))).toEqual({ start: s, end: d })
  })

  it('脏数据 start > due 时自动交换', () => {
    const s = new Date(2026, 8, 12).getTime()
    const d = new Date(2026, 8, 10).getTime()
    expect(taskRange(mk('a', { startDate: s, dueDate: d }))).toEqual({ start: d, end: s })
  })
})

describe('isOverdue', () => {
  const now = new Date(2026, 8, 15, 12).getTime()

  it('待办且早于今天 → 逾期', () => {
    const t = mk('a', { dueDate: new Date(2026, 8, 14, 23, 59).getTime() })
    expect(isOverdue(t, now)).toBe(true)
  })

  it('今天到期不算逾期', () => {
    const t = mk('a', { dueDate: new Date(2026, 8, 15, 23, 59).getTime() })
    expect(isOverdue(t, now)).toBe(false)
  })

  it('已完成不算逾期', () => {
    const t = mk('a', { status: 'done', dueDate: new Date(2026, 8, 14, 23, 59).getTime() })
    expect(isOverdue(t, now)).toBe(false)
  })

  it('无截止日期不算逾期', () => {
    expect(isOverdue(mk('a'), now)).toBe(false)
  })
})

describe('taskDropUpdate', () => {
  it('从未设置日期拖入 → 设为当天 23:59', () => {
    const patch = taskDropUpdate(mk('a'), null, '2026-09-20')
    expect(patch.dueDate).toBe(new Date(2026, 8, 20, 23, 59).getTime())
    expect(patch.startDate).toBeUndefined()
  })

  it('整体平移区间，保留时分', () => {
    const t = mk('a', {
      startDate: new Date(2026, 8, 10, 0, 0).getTime(),
      dueDate: new Date(2026, 8, 12, 23, 59).getTime(),
    })
    const patch = taskDropUpdate(t, '2026-09-11', '2026-09-13')
    expect(patch.startDate).toBe(new Date(2026, 8, 12, 0, 0).getTime())
    expect(patch.dueDate).toBe(new Date(2026, 8, 14, 23, 59).getTime())
  })

  it('只有 dueDate 时只平移 dueDate', () => {
    const t = mk('a', { dueDate: new Date(2026, 8, 12, 23, 59).getTime() })
    const patch = taskDropUpdate(t, '2026-09-12', '2026-09-10')
    expect(patch.dueDate).toBe(new Date(2026, 8, 10, 23, 59).getTime())
    expect(patch.startDate).toBeUndefined()
  })

  it('原地放下返回空对象', () => {
    const t = mk('a', { dueDate: new Date(2026, 8, 12, 23, 59).getTime() })
    expect(taskDropUpdate(t, '2026-09-12', '2026-09-12')).toEqual({})
  })
})

describe('parentBounds', () => {
  it('父只设 startDate → 只有下界', () => {
    const s = new Date(2026, 8, 10).getTime()
    expect(parentBounds(mk('p', { startDate: s }))).toEqual({ lower: s, upper: null })
  })

  it('父只设 dueDate → 只有上界', () => {
    const d = new Date(2026, 8, 15, 23, 59).getTime()
    expect(parentBounds(mk('p', { dueDate: d }))).toEqual({ lower: null, upper: d })
  })

  it('父两者都设 → 双边界', () => {
    const s = new Date(2026, 8, 10).getTime()
    const d = new Date(2026, 8, 15, 23, 59).getTime()
    expect(parentBounds(mk('p', { startDate: s, dueDate: d }))).toEqual({ lower: s, upper: d })
  })

  it('父无任何日期 → 无约束', () => {
    expect(parentBounds(mk('p'))).toEqual({ lower: null, upper: null })
  })
})

describe('violatesParentRange', () => {
  const lower = new Date(2026, 8, 10).getTime()
  const upper = new Date(2026, 8, 15, 23, 59).getTime()
  const parent = mk('p', { startDate: lower, dueDate: upper })

  it('子任务无日期 → 永不违反', () => {
    expect(violatesParentRange(mk('c'), parent)).toBe(false)
  })

  it('无父任务（null/undefined）→ 不约束', () => {
    const c = mk('c', { dueDate: new Date(2026, 11, 31).getTime() })
    expect(violatesParentRange(c, null)).toBe(false)
    expect(violatesParentRange(c, undefined)).toBe(false)
  })

  it('子范围在界内 → 不违反', () => {
    const c = mk('c', {
      startDate: new Date(2026, 8, 11).getTime(),
      dueDate: new Date(2026, 8, 14, 23, 59).getTime(),
    })
    expect(violatesParentRange(c, parent)).toBe(false)
  })

  it('子范围贴着父两端 → 不违反', () => {
    const c = mk('c', { startDate: lower, dueDate: upper })
    expect(violatesParentRange(c, parent)).toBe(false)
  })

  it('子早于父 startDate → 违反', () => {
    const c = mk('c', { startDate: new Date(2026, 8, 9).getTime() })
    expect(violatesParentRange(c, parent)).toBe(true)
  })

  it('子晚于父 dueDate → 违反', () => {
    const c = mk('c', { dueDate: new Date(2026, 8, 16, 23, 59).getTime() })
    expect(violatesParentRange(c, parent)).toBe(true)
  })

  it('父只有截止：子更早不受限，子更晚违反', () => {
    const p = mk('p', { dueDate: upper })
    expect(violatesParentRange(mk('c', { dueDate: new Date(2026, 8, 1).getTime() }), p)).toBe(false)
    expect(violatesParentRange(mk('c', { startDate: new Date(2026, 8, 20).getTime() }), p)).toBe(
      true,
    )
  })

  it('父只有开始：子更晚不受限，子更早违反', () => {
    const p = mk('p', { startDate: lower })
    expect(violatesParentRange(mk('c', { dueDate: new Date(2026, 11, 31).getTime() }), p)).toBe(
      false,
    )
    expect(violatesParentRange(mk('c', { startDate: new Date(2026, 8, 9).getTime() }), p)).toBe(
      true,
    )
  })

  it('父无任何日期 → 不约束子任务', () => {
    const p = mk('p')
    expect(violatesParentRange(mk('c', { dueDate: new Date(2027, 0, 1).getTime() }), p)).toBe(false)
  })
})

describe('taskDropUpdate 父任务范围夹紧', () => {
  const lower = new Date(2026, 8, 10).getTime()
  const upper = new Date(2026, 8, 14, 23, 59).getTime()
  const bounds = { lower, upper }

  it('平移超出上界 → 收窄 delta 保时长停在边界，clamped=true', () => {
    const t = mk('a', {
      startDate: new Date(2026, 8, 10).getTime(),
      dueDate: new Date(2026, 8, 12, 23, 59).getTime(),
    })
    const patch = taskDropUpdate(t, '2026-09-12', '2026-09-16', bounds)
    expect(patch.dueDate).toBe(upper)
    expect(patch.startDate).toBe(new Date(2026, 8, 12).getTime())
    expect(patch.clamped).toBe(true)
  })

  it('平移早于下界 → 收窄 delta 停在下界，clamped=true', () => {
    const t = mk('a', {
      startDate: new Date(2026, 8, 10).getTime(),
      dueDate: new Date(2026, 8, 12, 23, 59).getTime(),
    })
    const patch = taskDropUpdate(t, '2026-09-10', '2026-09-08', bounds)
    expect(patch.startDate).toBe(lower)
    expect(patch.dueDate).toBe(new Date(2026, 8, 12, 23, 59).getTime())
    expect(patch.clamped).toBe(true)
  })

  it('界内平移不受影响，无 clamped 标记', () => {
    const t = mk('a', { dueDate: new Date(2026, 8, 12, 23, 59).getTime() })
    const patch = taskDropUpdate(t, '2026-09-12', '2026-09-13', bounds)
    expect(patch.dueDate).toBe(new Date(2026, 8, 13, 23, 59).getTime())
    expect(patch.clamped).toBeUndefined()
  })

  it('未设日期拖入晚于上界 → 夹到父截止', () => {
    const patch = taskDropUpdate(mk('a'), null, '2026-09-20', bounds)
    expect(patch.dueDate).toBe(upper)
    expect(patch.clamped).toBe(true)
  })

  it('未设日期拖入早于下界 → 夹到父开始', () => {
    const patch = taskDropUpdate(mk('a'), null, '2026-09-05', bounds)
    expect(patch.dueDate).toBe(lower)
    expect(patch.clamped).toBe(true)
  })

  it('子范围宽于父（存量脏数据）→ 端点夹进界内，clamped=true', () => {
    const t = mk('a', {
      startDate: new Date(2026, 8, 10).getTime(),
      dueDate: new Date(2026, 8, 20, 23, 59).getTime(),
    })
    const patch = taskDropUpdate(t, '2026-09-10', '2026-09-11', bounds)
    expect(patch.startDate).toBeGreaterThanOrEqual(lower)
    expect(patch.dueDate!).toBeLessThanOrEqual(upper)
    expect(patch.clamped).toBe(true)
  })

  it('不传 bounds 时行为与原来完全一致', () => {
    const t = mk('a', {
      startDate: new Date(2026, 8, 10).getTime(),
      dueDate: new Date(2026, 8, 12, 23, 59).getTime(),
    })
    expect(taskDropUpdate(t, '2026-09-12', '2026-09-16')).toEqual(
      taskDropUpdate(t, '2026-09-12', '2026-09-16', null),
    )
    expect(taskDropUpdate(t, '2026-09-12', '2026-09-16').clamped).toBeUndefined()
  })
})

describe('groupTasksByDueDay 区间归格', () => {
  it('跨天任务在区间内每一天都入桶', () => {
    const s = new Date(2026, 8, 10, 0, 0).getTime()
    const d = new Date(2026, 8, 12, 23, 59).getTime()
    const { byDay, unscheduled } = groupTasksByDueDay([mk('a', { startDate: s, dueDate: d })])
    expect(unscheduled).toEqual([])
    expect(byDay.get('2026-09-10')?.map((t) => t.id)).toEqual(['a'])
    expect(byDay.get('2026-09-11')?.map((t) => t.id)).toEqual(['a'])
    expect(byDay.get('2026-09-12')?.map((t) => t.id)).toEqual(['a'])
    expect(byDay.size).toBe(3)
  })

  it('只有 startDate 时归入单日且不算未设置', () => {
    const s = new Date(2026, 8, 15, 9, 0).getTime()
    const { byDay, unscheduled } = groupTasksByDueDay([mk('a', { startDate: s })])
    expect(unscheduled).toEqual([])
    expect(byDay.get('2026-09-15')?.map((t) => t.id)).toEqual(['a'])
    expect(byDay.size).toBe(1)
  })

  it(`超过 ${RANGE_DAY_LIMIT} 天的区间只归入首尾两天`, () => {
    const s = new Date(2026, 0, 1, 0, 0).getTime()
    const d = new Date(2026, 0, 1 + RANGE_DAY_LIMIT + 10, 23, 59).getTime()
    const { byDay } = groupTasksByDueDay([mk('a', { startDate: s, dueDate: d })])
    expect(byDay.size).toBe(2)
    expect(byDay.get('2026-01-01')?.map((t) => t.id)).toEqual(['a'])
    expect(byDay.get(dayKey(d))?.map((t) => t.id)).toEqual(['a'])
  })

  it('完全无日期的任务进 unscheduled', () => {
    const { byDay, unscheduled } = groupTasksByDueDay([mk('a')])
    expect(byDay.size).toBe(0)
    expect(unscheduled.map((t) => t.id)).toEqual(['a'])
  })

  it('区间任务与单日任务混排时桶内仍按优先级、标题排序', () => {
    const s = new Date(2026, 8, 20, 0, 0).getTime()
    const d = new Date(2026, 8, 22, 23, 59).getTime()
    const { byDay } = groupTasksByDueDay([
      mk('r1', { startDate: s, dueDate: d, priority: 'P2', title: 'beta' }),
      mk('t1', { dueDate: s, priority: 'P0', title: 'zeta' }),
      mk('t2', { dueDate: s, priority: 'P2', title: 'alpha' }),
    ])
    expect(byDay.get('2026-09-20')?.map((t) => t.id)).toEqual(['t1', 't2', 'r1'])
  })
})
