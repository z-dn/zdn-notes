import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DetailPanel } from '../src/components/detail-panel'
import { useTaskStore } from '../src/stores/task-store'
import type { Task } from '../src/types/task'

vi.mock('../src/components/confirm-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/confirm-dialog')>()
  return { ...actual, showConfirm: vi.fn().mockResolvedValue(true) }
})

const mock = vi.hoisted(() => ({
  taskCreate: vi.fn().mockResolvedValue(null),
  taskUpdate: vi.fn().mockResolvedValue(null),
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

const parent = mk('p', {
  startDate: new Date(2026, 8, 10).getTime(),
  dueDate: new Date(2026, 8, 15, 23, 59).getTime(),
})
const child = mk('c', { parentId: 'p' })

function dayButton(date: Date): HTMLElement | null {
  return document.querySelector(`[data-day="${date.toLocaleDateString()}"]`)
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 20))
  Object.defineProperty(window, 'electronAPI', {
    value: mock,
    configurable: true,
    writable: true,
  })
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  useTaskStore.setState({ tasks: [], selectedTask: null })
})

describe('DetailPanel 子任务日期选择器越界置灰', () => {
  it('打开子任务截止日期选择器：父范围外日期禁用、界内可用', async () => {
    useTaskStore.setState({ tasks: [parent, child], selectedTask: child })
    render(<DetailPanel />)

    const pickers = await screen.findAllByText('选择日期')
    expect(pickers.length).toBe(2)
    fireEvent.click(pickers[1])
    await waitFor(() => expect(screen.getByRole('grid')).toBeInTheDocument())

    await waitFor(() => {
      expect(dayButton(new Date(2026, 8, 16))).not.toBeNull()
    })
    const outside = dayButton(new Date(2026, 8, 16)) as HTMLElement
    const inside = dayButton(new Date(2026, 8, 14)) as HTMLElement
    expect(outside).toBeDisabled()
    expect(inside).not.toBeDisabled()
  })

  it('开始日期选择器同样受父范围约束', async () => {
    useTaskStore.setState({ tasks: [parent, child], selectedTask: child })
    render(<DetailPanel />)

    const pickers = await screen.findAllByText('选择日期')
    fireEvent.click(pickers[0])
    await waitFor(() => expect(screen.getByRole('grid')).toBeInTheDocument())
    await waitFor(() => {
      expect(dayButton(new Date(2026, 8, 8))).not.toBeNull()
    })
    const beforeStart = dayButton(new Date(2026, 8, 8)) as HTMLElement
    const inside = dayButton(new Date(2026, 8, 11)) as HTMLElement
    expect(beforeStart).toBeDisabled()
    expect(inside).not.toBeDisabled()
  })

  it('顶级任务（无父任务）日期选择器不置灰', async () => {
    const bare = mk('t')
    useTaskStore.setState({ tasks: [bare], selectedTask: bare })
    render(<DetailPanel />)

    const pickers = await screen.findAllByText('选择日期')
    fireEvent.click(pickers[1])
    await waitFor(() => expect(screen.getByRole('grid')).toBeInTheDocument())
    await waitFor(() => {
      expect(dayButton(new Date(2026, 8, 30))).not.toBeNull()
    })
    const far = dayButton(new Date(2026, 8, 30)) as HTMLElement
    expect(far).not.toBeDisabled()
  })
})
