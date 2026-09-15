import { describe, it, expect } from 'vitest'
import {
  buildTree,
  canDrop,
  collectExpandableIds,
  flattenTree,
  isDescendantOf,
  partitionByStatus,
  sortTasks,
} from '../src/components/task-list-view'
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

describe('partitionByStatus', () => {
  it('按状态分桶且保持原有顺序', () => {
    const tasks = [
      mk('a'),
      mk('b', { status: 'done' }),
      mk('c'),
      mk('d', { status: 'done' }),
    ]
    const { todo, done } = partitionByStatus(tasks)
    expect(todo.map((t) => t.id)).toEqual(['a', 'c'])
    expect(done.map((t) => t.id)).toEqual(['b', 'd'])
  })

  it('空列表返回空桶', () => {
    expect(partitionByStatus([])).toEqual({ todo: [], done: [] })
  })
})

describe('buildTree 跨桶孤儿提升', () => {
  it('done 父任务的 todo 子任务提升为待办区根节点', () => {
    const tasks = [
      mk('parent', { status: 'done' }),
      mk('child', { parentId: 'parent' }),
    ]
    const { todo, done } = partitionByStatus(tasks)
    const todoRoots = buildTree(todo)
    const doneRoots = buildTree(done)
    expect(todoRoots.map((n) => n.task.id)).toEqual(['child'])
    expect(doneRoots[0].children.map((n) => n.task.id)).toEqual([])
  })

  it('todo 父任务的 done 子任务进入已完成区，父任务保留', () => {
    const tasks = [
      mk('parent'),
      mk('child', { parentId: 'parent', status: 'done' }),
    ]
    const { todo, done } = partitionByStatus(tasks)
    const todoRoots = buildTree(todo)
    const doneRoots = buildTree(done)
    expect(todoRoots.map((n) => n.task.id)).toEqual(['parent'])
    expect(todoRoots[0].children.map((n) => n.task.id)).toEqual([])
    expect(doneRoots.map((n) => n.task.id)).toEqual(['child'])
  })
})

describe('flattenTree / collectExpandableIds', () => {
  it('按 expandedIds 展开子层级', () => {
    const tasks = [
      mk('p1', { orderIndex: 1 }),
      mk('p2', { orderIndex: 2 }),
      mk('c1', { parentId: 'p1', orderIndex: 1.1 }),
      mk('g1', { parentId: 'c1', orderIndex: 1.11 }),
    ]
    const roots = buildTree(tasks)

    const collapsed: { task: Task; depth: number }[] = []
    flattenTree(roots, 0, new Set(), collapsed)
    expect(collapsed.map((r) => [r.task.id, r.depth])).toEqual([
      ['p1', 0],
      ['p2', 0],
    ])

    const expanded: { task: Task; depth: number }[] = []
    flattenTree(roots, 0, new Set(['p1']), expanded)
    expect(expanded.map((r) => [r.task.id, r.depth])).toEqual([
      ['p1', 0],
      ['c1', 1],
      ['p2', 0],
    ])

    const all: { task: Task; depth: number }[] = []
    flattenTree(roots, 0, new Set(['p1', 'c1']), all)
    expect(all.map((r) => r.task.id)).toEqual(['p1', 'c1', 'g1', 'p2'])
  })

  it('collectExpandableIds 收集所有有子节点的节点', () => {
    const tasks = [
      mk('p1'),
      mk('c1', { parentId: 'p1' }),
      mk('g1', { parentId: 'c1' }),
      mk('p2'),
    ]
    const ids = collectExpandableIds(buildTree(tasks))
    expect(ids).toEqual(['p1', 'c1'])
  })
})

describe('isDescendantOf / canDrop 拖拽落点校验', () => {
  // 树结构：A → B → C（C 是孙级）
  const tasks = [
    mk('A'),
    mk('B', { parentId: 'A' }),
    mk('C', { parentId: 'B' }),
    mk('D'),
  ]

  it('isDescendantOf 基本方向', () => {
    expect(isDescendantOf('C', 'A', tasks)).toBe(true)
    expect(isDescendantOf('A', 'C', tasks)).toBe(false)
  })

  it('孙级拖到祖级下（提升层级）应放行', () => {
    expect(canDrop('C', 'A', tasks).ok).toBe(true)
  })

  it('同父级内兄弟排序应放行', () => {
    expect(canDrop('C', 'B', tasks).ok).toBe(true)
  })

  it('拖到无亲缘关系的分支下应放行', () => {
    expect(canDrop('C', 'D', tasks).ok).toBe(true)
  })

  it('拖到自身应拒绝', () => {
    const r = canDrop('C', 'C', tasks)
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
  })

  it('拖到自己的子树内应拒绝（防成环）', () => {
    expect(canDrop('A', 'C', tasks).ok).toBe(false)
    expect(canDrop('B', 'C', tasks).ok).toBe(false)
  })

  it('拖到根级应放行', () => {
    expect(canDrop('C', null, tasks).ok).toBe(true)
  })
})

describe('sortTasks', () => {
  it('按优先级排序且无日期任务排后', () => {
    const tasks = [
      mk('a', { priority: 'P2', dueDate: 300 }),
      mk('b', { priority: 'P0' }),
      mk('c', { priority: 'P1', dueDate: 100 }),
    ]
    const byPriority = sortTasks(tasks, 'priority', 'asc')
    expect(byPriority.map((t) => t.id)).toEqual(['b', 'c', 'a'])

    const byDue = sortTasks(tasks, 'dueDate', 'asc')
    expect(byDue.map((t) => t.id)).toEqual(['c', 'a', 'b'])
  })
})
