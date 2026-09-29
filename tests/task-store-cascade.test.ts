import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useTaskStore } from '../src/stores/task-store'
import type { Task } from '../src/types/task'

// showConfirm 依赖 useFlipDialog 的 CSS transition，jsdom 无法触发，mock 为可控返回值
vi.mock('../src/components/confirm-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/confirm-dialog')>()
  return { ...actual, showConfirm: vi.fn() }
})

const mock = vi.hoisted(() => ({
  taskUpdate: vi.fn().mockResolvedValue(null),
  taskCreate: vi.fn().mockResolvedValue(null),
  taskGetAll: vi.fn().mockResolvedValue([]),
  taskDelete: vi.fn().mockResolvedValue(undefined),
  taskUpdateStatus: vi.fn().mockResolvedValue(null),
  categoryGetAll: vi.fn().mockResolvedValue([]),
  categoryGetTaskCounts: vi.fn().mockResolvedValue({}),
}))

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

const parentStart = new Date(2026, 8, 10).getTime()
const parentDue = new Date(2026, 8, 15, 23, 59).getTime()
const childInRange = new Date(2026, 8, 11, 23, 59).getTime()
const childOutOfRange = new Date(2026, 8, 18, 23, 59).getTime()
const newDue = new Date(2026, 8, 12, 23, 59).getTime()

async function showConfirmMock() {
  return (await import('../src/components/confirm-dialog')).showConfirm as ReturnType<typeof vi.fn>
}

describe('updateTask 父改期级联清子任务日期', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'electronAPI', {
      value: mock,
      configurable: true,
      writable: true,
    })
    vi.clearAllMocks()
  })

  afterEach(() => {
    useTaskStore.setState({ tasks: [], selectedTask: null })
  })

  it('确认 → 父更新 + 越界子任务日期清空', async () => {
    const parent = mk('p', { startDate: parentStart, dueDate: parentDue })
    const child = mk('c', { parentId: 'p', dueDate: childOutOfRange })
    const ok = await showConfirmMock()
    ok.mockResolvedValue(true)
    useTaskStore.setState({ tasks: [parent, child], selectedTask: parent })

    await useTaskStore.getState().updateTask({ id: 'p', dueDate: newDue })

    const confirm = await showConfirmMock()
    expect(confirm).toHaveBeenCalledWith('日期联动', expect.stringContaining('1 个子任务'))
    expect(mock.taskUpdate).toHaveBeenCalledTimes(2)
    expect(mock.taskUpdate).toHaveBeenNthCalledWith(1, { id: 'p', dueDate: newDue })
    expect(mock.taskUpdate).toHaveBeenNthCalledWith(2, {
      id: 'c',
      startDate: null,
      dueDate: null,
    })
    const tasks = useTaskStore.getState().tasks
    expect(tasks.find((t) => t.id === 'p')?.dueDate).toBe(newDue)
    expect(tasks.find((t) => t.id === 'c')?.dueDate).toBeNull()
    expect(tasks.find((t) => t.id === 'c')?.startDate).toBeNull()
  })

  it('取消 → 父子都不动，不发任何更新请求', async () => {
    const parent = mk('p', { startDate: parentStart, dueDate: parentDue })
    const child = mk('c', { parentId: 'p', dueDate: childOutOfRange })
    const ok = await showConfirmMock()
    ok.mockResolvedValue(false)
    useTaskStore.setState({ tasks: [parent, child], selectedTask: parent })

    await useTaskStore.getState().updateTask({ id: 'p', dueDate: newDue })

    expect(mock.taskUpdate).not.toHaveBeenCalled()
    const tasks = useTaskStore.getState().tasks
    expect(tasks.find((t) => t.id === 'p')?.dueDate).toBe(parentDue)
    expect(tasks.find((t) => t.id === 'c')?.dueDate).toBe(childOutOfRange)
  })

  it('子任务都在新范围内 → 不弹确认，只更新父任务', async () => {
    const parent = mk('p', { startDate: parentStart, dueDate: parentDue })
    const child = mk('c', { parentId: 'p', dueDate: childInRange })
    const ok = await showConfirmMock()
    ok.mockResolvedValue(true)
    useTaskStore.setState({ tasks: [parent, child], selectedTask: parent })

    await useTaskStore.getState().updateTask({ id: 'p', dueDate: newDue })

    const confirm = await showConfirmMock()
    expect(confirm).not.toHaveBeenCalled()
    expect(mock.taskUpdate).toHaveBeenCalledTimes(1)
    expect(mock.taskUpdate).toHaveBeenCalledWith({ id: 'p', dueDate: newDue })
    expect(useTaskStore.getState().tasks.find((t) => t.id === 'c')?.dueDate).toBe(childInRange)
  })

  it('清除父任务全部日期 → 约束解除，子任务日期保留，不弹确认', async () => {
    const parent = mk('p', { startDate: parentStart, dueDate: parentDue })
    const child = mk('c', { parentId: 'p', dueDate: childOutOfRange })
    const ok = await showConfirmMock()
    ok.mockResolvedValue(true)
    useTaskStore.setState({ tasks: [parent, child], selectedTask: parent })

    await useTaskStore.getState().updateTask({ id: 'p', dueDate: null, startDate: null })

    const confirm = await showConfirmMock()
    expect(confirm).not.toHaveBeenCalled()
    expect(mock.taskUpdate).toHaveBeenCalledTimes(1)
    expect(useTaskStore.getState().tasks.find((t) => t.id === 'c')?.dueDate).toBe(childOutOfRange)
  })

  it('非日期更新（标题）不触发确认', async () => {
    const parent = mk('p', { startDate: parentStart, dueDate: parentDue })
    const child = mk('c', { parentId: 'p', dueDate: childOutOfRange })
    const ok = await showConfirmMock()
    ok.mockResolvedValue(true)
    useTaskStore.setState({ tasks: [parent, child], selectedTask: parent })

    await useTaskStore.getState().updateTask({ id: 'p', title: 'renamed' })

    const confirm = await showConfirmMock()
    expect(confirm).not.toHaveBeenCalled()
    expect(mock.taskUpdate).toHaveBeenCalledTimes(1)
    expect(mock.taskUpdate).toHaveBeenCalledWith({ id: 'p', title: 'renamed' })
    expect(useTaskStore.getState().tasks.find((t) => t.id === 'c')?.dueDate).toBe(childOutOfRange)
  })

  it('无日期子任务越界检查中被跳过，不弹确认', async () => {
    const parent = mk('p', { startDate: parentStart, dueDate: parentDue })
    const child = mk('c', { parentId: 'p' })
    const ok = await showConfirmMock()
    ok.mockResolvedValue(true)
    useTaskStore.setState({ tasks: [parent, child], selectedTask: parent })

    await useTaskStore.getState().updateTask({ id: 'p', dueDate: newDue })

    const confirm = await showConfirmMock()
    expect(confirm).not.toHaveBeenCalled()
    expect(mock.taskUpdate).toHaveBeenCalledTimes(1)
    expect(useTaskStore.getState().tasks.find((t) => t.id === 'c')?.dueDate).toBeNull()
  })

  it('孙任务按直接父子关系独立校验，父改期不越界时孙任务不动', async () => {
    const parent = mk('p', { startDate: parentStart, dueDate: parentDue })
    const child = mk('c', { parentId: 'p', dueDate: childInRange })
    const grand = mk('g', { parentId: 'c', dueDate: childInRange })
    const ok = await showConfirmMock()
    ok.mockResolvedValue(true)
    useTaskStore.setState({ tasks: [parent, child, grand], selectedTask: parent })

    await useTaskStore.getState().updateTask({ id: 'p', dueDate: newDue })

    expect(mock.taskUpdate).toHaveBeenCalledTimes(1)
    expect(useTaskStore.getState().tasks.find((t) => t.id === 'g')?.dueDate).toBe(childInRange)
  })
})
