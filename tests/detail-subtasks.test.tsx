import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DetailSubtasks } from '../src/components/detail-subtasks'
import { useTaskStore } from '../src/stores/task-store'
import type { Task } from '../src/types/task'

// store.deleteTask 自带确认弹窗（useFlipDialog 依赖 CSS transition，jsdom 无法触发），直接 mock 为确认通过
vi.mock('../src/components/confirm-dialog', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/components/confirm-dialog')>()
  return { ...actual, showConfirm: vi.fn().mockResolvedValue(true) }
})

const mock = vi.hoisted(() => ({
  taskCreate: vi.fn().mockImplementation((dto: Record<string, unknown>) =>
    Promise.resolve({
      id: 'created-1',
      title: String(dto.title ?? ''),
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
      ...dto,
    }),
  ),
  taskUpdateStatus: vi.fn().mockResolvedValue(null),
  taskDelete: vi.fn().mockResolvedValue(undefined),
  taskGetAll: vi.fn().mockResolvedValue([]),
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

const parent = mk('parent', { categoryId: 'cat-1' })
const childDone = mk('child-done', { status: 'done', parentId: 'parent', orderIndex: 1 })
const childTodo = mk('child-todo', { parentId: 'parent', orderIndex: 2 })

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    value: mock,
    configurable: true,
    writable: true,
  })
  useTaskStore.setState({ tasks: [parent, childDone, childTodo], selectedTask: parent })
})

afterEach(() => {
  cleanup()
  useTaskStore.setState({ tasks: [], selectedTask: null })
  vi.clearAllMocks()
})

describe('DetailSubtasks', () => {
  it('渲染子任务行并显示进度 1/2', () => {
    render(<DetailSubtasks task={parent} />)
    expect(screen.getByText('child-done')).toBeInTheDocument()
    expect(screen.getByText('child-todo')).toBeInTheDocument()
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('无子任务时只显示输入框、不显示进度', () => {
    render(<DetailSubtasks task={mk('lonely')} />)
    expect(screen.queryByText('0/0')).toBeNull()
    expect(screen.getByPlaceholderText('添加子任务...')).toBeInTheDocument()
  })

  it('点击子任务标题跳选该子任务', () => {
    render(<DetailSubtasks task={parent} />)
    fireEvent.click(screen.getByText('child-todo'))
    expect(useTaskStore.getState().selectedTask?.id).toBe('child-todo')
  })

  it('点击勾选框切换子任务完成状态', async () => {
    render(<DetailSubtasks task={parent} />)
    const row = screen.getByText('child-todo').closest('.group') as HTMLElement
    fireEvent.click(row.querySelector('[role="checkbox"]') as HTMLElement)
    await waitFor(() => expect(mock.taskUpdateStatus).toHaveBeenCalledWith('child-todo', 'done'))
  })

  it('Enter 创建子任务：继承父分类、排在末尾', async () => {
    render(<DetailSubtasks task={parent} />)
    const input = screen.getByPlaceholderText('添加子任务...')
    fireEvent.change(input, { target: { value: '新子任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '新子任务',
        parentId: 'parent',
        categoryId: 'cat-1',
      }),
    )
    const dto = mock.taskCreate.mock.calls[0][0]
    expect(dto.orderIndex).toBeGreaterThan(childTodo.orderIndex)
  })

  it('父任务带日期时创建子任务继承 startDate/dueDate', async () => {
    const start = new Date(2026, 8, 10).getTime()
    const due = new Date(2026, 8, 15, 23, 59).getTime()
    const dated = mk('dated', { categoryId: 'cat-1', startDate: start, dueDate: due })
    useTaskStore.setState({ tasks: [dated], selectedTask: dated })
    render(<DetailSubtasks task={dated} />)
    const input = screen.getByPlaceholderText('添加子任务...')
    fireEvent.change(input, { target: { value: '带日期子任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        parentId: 'dated',
        startDate: start,
        dueDate: due,
      }),
    )
  })

  it('父任务无日期时子任务日期为 null', async () => {
    render(<DetailSubtasks task={parent} />)
    const input = screen.getByPlaceholderText('添加子任务...')
    fireEvent.change(input, { target: { value: '无日期子任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: null, dueDate: null }),
    )
  })

  it('删除子任务先走确认弹窗再执行', async () => {
    render(<DetailSubtasks task={parent} />)
    fireEvent.click(screen.getAllByLabelText('删除子任务')[0])
    await waitFor(() => expect(mock.taskDelete).toHaveBeenCalledWith('child-done'))
    const { showConfirm } = await import('../src/components/confirm-dialog')
    expect(showConfirm).toHaveBeenCalledWith('确认删除', expect.stringContaining('child-done'))
  })
})
