import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { TaskInput } from '../src/components/task-input'
import { InlineTaskInput } from '../src/components/inline-task-input'
import { TooltipProvider } from '../src/components/ui/tooltip'
import { useTaskStore } from '../src/stores/task-store'
import type { Task } from '../src/types/task'

function renderTaskInput() {
  return render(
    <TooltipProvider>
      <TaskInput />
    </TooltipProvider>,
  )
}

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
  taskGetAll: vi.fn().mockResolvedValue([]),
  taskUpdate: vi.fn().mockResolvedValue(null),
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
const datedParent = mk('p1', { startDate: parentStart, dueDate: parentDue })

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    value: mock,
    configurable: true,
    writable: true,
  })
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  useTaskStore.setState({ tasks: [], selectedTask: null })
})

describe('TaskInput 创建子任务继承父日期', () => {
  it('选中带日期任务时继承 startDate/dueDate', async () => {
    useTaskStore.setState({ tasks: [datedParent], selectedTask: datedParent })
    renderTaskInput()
    const input = screen.getByPlaceholderText('添加任务，按回车确认')
    fireEvent.change(input, { target: { value: '子任务A' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '子任务A',
        parentId: 'p1',
        startDate: parentStart,
        dueDate: parentDue,
      }),
    )
  })

  it('无选中任务时创建顶级任务，日期为 null', async () => {
    useTaskStore.setState({ tasks: [datedParent], selectedTask: null })
    renderTaskInput()
    const input = screen.getByPlaceholderText('添加任务，按回车确认')
    fireEvent.change(input, { target: { value: '顶级任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '顶级任务',
        parentId: null,
        startDate: null,
        dueDate: null,
      }),
    )
  })

  it('选中无日期任务时子任务日期为 null', async () => {
    const bare = mk('p2')
    useTaskStore.setState({ tasks: [bare], selectedTask: bare })
    renderTaskInput()
    const input = screen.getByPlaceholderText('添加任务，按回车确认')
    fireEvent.change(input, { target: { value: '子任务B' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'p2', startDate: null, dueDate: null }),
    )
  })
})

describe('InlineTaskInput 创建子任务继承父日期', () => {
  it('父任务带日期时继承 startDate/dueDate', async () => {
    useTaskStore.setState({ tasks: [datedParent], selectedTask: null })
    render(<InlineTaskInput parentId="p1" orderIndex={1} depth={0} onClose={() => {}} />)
    const input = screen.getByPlaceholderText('输入任务名称，按回车添加')
    fireEvent.change(input, { target: { value: '行内子任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '行内子任务',
        parentId: 'p1',
        startDate: parentStart,
        dueDate: parentDue,
      }),
    )
  })

  it('父任务无日期时日期为 null', async () => {
    useTaskStore.setState({ tasks: [mk('p3')], selectedTask: null })
    render(<InlineTaskInput parentId="p3" orderIndex={1} depth={0} onClose={() => {}} />)
    const input = screen.getByPlaceholderText('输入任务名称，按回车添加')
    fireEvent.change(input, { target: { value: '行内子任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'p3', startDate: null, dueDate: null }),
    )
  })

  it('父任务不在列表中时日期为 null', async () => {
    useTaskStore.setState({ tasks: [], selectedTask: null })
    render(<InlineTaskInput parentId="missing" orderIndex={1} depth={0} onClose={() => {}} />)
    const input = screen.getByPlaceholderText('输入任务名称，按回车添加')
    fireEvent.change(input, { target: { value: '孤儿任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ parentId: 'missing', startDate: null, dueDate: null }),
    )
  })
})
