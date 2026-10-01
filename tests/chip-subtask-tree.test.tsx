import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { startOfDay } from 'date-fns'
import { ChipSubtaskTree } from '../src/components/chip-subtask-tree'
import { TaskCalendar } from '../src/components/task-calendar'
import { useTaskStore } from '../src/stores/task-store'
import type { Task } from '../src/types/task'

// store.deleteTask 自带确认弹窗（依赖 CSS transition，jsdom 无法触发），mock 为确认通过
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

const start = new Date(2026, 8, 10).getTime()
const due = new Date(2026, 8, 15, 23, 59).getTime()
const rootTask = mk('root-task', { categoryId: 'cat-1', startDate: start, dueDate: due })
const childA = mk('child-a', { parentId: 'root-task', orderIndex: 1 })
const childDone = mk('child-done', { parentId: 'root-task', status: 'done', orderIndex: 2 })
const grand = mk('grand-a', { parentId: 'child-a', orderIndex: 3 })

function renderTree(root: Task, over: Partial<Parameters<typeof ChipSubtaskTree>[0]> = {}) {
  const props = {
    root,
    style: {},
    onClose: vi.fn(),
    onReroot: vi.fn(),
    ...over,
  }
  render(<ChipSubtaskTree {...props} />)
  return props
}

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    value: mock,
    configurable: true,
    writable: true,
  })
  useTaskStore.setState({ tasks: [rootTask, childA, childDone, grand], selectedTask: null })
})

afterEach(() => {
  cleanup()
  useTaskStore.setState({ tasks: [], selectedTask: null, statusView: 'all' })
  vi.clearAllMocks()
})

describe('ChipSubtaskTree 多级树', () => {
  it('递归渲染子级与孙级，孙级缩进更深', () => {
    renderTree(rootTask)
    expect(screen.getByText('child-a')).toBeInTheDocument()
    expect(screen.getByText('child-done')).toBeInTheDocument()
    expect(screen.getByText('grand-a')).toBeInTheDocument()
    const childRow = screen.getByText('child-a').parentElement as HTMLElement
    const grandRow = screen.getByText('grand-a').parentElement as HTMLElement
    expect(parseFloat(grandRow.style.paddingLeft)).toBeGreaterThan(
      parseFloat(childRow.style.paddingLeft),
    )
  })

  it('头部进度只统计直系子任务', () => {
    renderTree(rootTask)
    expect(screen.getByText('1/2')).toBeInTheDocument()
    expect(screen.queryByText('1/3')).toBeNull()
  })

  it('点击头部标题跳选根任务', () => {
    renderTree(rootTask)
    fireEvent.click(screen.getByText('root-task'))
    expect(useTaskStore.getState().selectedTask?.id).toBe('root-task')
  })

  it('点子任务标题跳选该子任务', () => {
    renderTree(rootTask)
    fireEvent.click(screen.getByText('grand-a'))
    expect(useTaskStore.getState().selectedTask?.id).toBe('grand-a')
  })

  it('勾选子任务切换完成状态', async () => {
    renderTree(rootTask)
    const row = screen.getByText('child-a').closest('div.group') as HTMLElement
    fireEvent.click(row.querySelector('[role="checkbox"]') as HTMLElement)
    await waitFor(() => expect(mock.taskUpdateStatus).toHaveBeenCalledWith('child-a', 'done'))
  })

  it('有子树的行显示下钻按钮，点击改根到该行；无子树的行不显示', () => {
    const props = renderTree(rootTask)
    const buttons = screen.getAllByLabelText('展开子任务树')
    expect(buttons.length).toBe(1)
    fireEvent.click(buttons[0])
    expect(props.onReroot).toHaveBeenCalledWith(childA)
  })

  it('Enter 创建子任务：改根到浮层根、继承分类与日期、排在末尾', async () => {
    renderTree(rootTask)
    const input = screen.getByPlaceholderText('添加子任务...')
    fireEvent.change(input, { target: { value: '新子任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: '新子任务',
        parentId: 'root-task',
        categoryId: 'cat-1',
        startDate: start,
        dueDate: due,
      }),
    )
    const dto = mock.taskCreate.mock.calls[0][0]
    expect(dto.orderIndex).toBeGreaterThan(childDone.orderIndex)
  })

  it('根任务无日期时创建的子任务日期为 null', async () => {
    const noDateRoot = mk('no-date-root')
    useTaskStore.setState({ tasks: [noDateRoot] })
    renderTree(noDateRoot)
    const input = screen.getByPlaceholderText('添加子任务...')
    fireEvent.change(input, { target: { value: '无日期子任务' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => expect(mock.taskCreate).toHaveBeenCalledTimes(1))
    expect(mock.taskCreate).toHaveBeenCalledWith(
      expect.objectContaining({ startDate: null, dueDate: null }),
    )
  })

  it('删除子任务先走确认弹窗再执行', async () => {
    renderTree(rootTask)
    fireEvent.click(screen.getAllByLabelText('删除子任务')[0])
    await waitFor(() => expect(mock.taskDelete).toHaveBeenCalledWith('child-a'))
    const { showConfirm } = await import('../src/components/confirm-dialog')
    expect(showConfirm).toHaveBeenCalledWith('确认删除', expect.stringContaining('child-a'))
  })

  it('空态：无子任务时只有输入框、不显示进度', () => {
    const lonely = mk('lonely-root')
    useTaskStore.setState({ tasks: [lonely] })
    renderTree(lonely)
    expect(screen.getByPlaceholderText('添加子任务...')).toBeInTheDocument()
    expect(screen.queryByText('0/0')).toBeNull()
  })

  it('点浮层外部关闭，Esc 关闭', () => {
    const props = renderTree(rootTask)
    fireEvent.mouseDown(document.body)
    expect(props.onClose).toHaveBeenCalledTimes(1)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(props.onClose).toHaveBeenCalledTimes(2)
  })

  it('点入口按钮（data-subtree-entry）不触发外部关闭', () => {
    const props = renderTree(rootTask)
    const entry = document.createElement('button')
    entry.setAttribute('data-subtree-entry', '')
    document.body.appendChild(entry)
    fireEvent.mouseDown(entry)
    expect(props.onClose).not.toHaveBeenCalled()
    document.body.removeChild(entry)
  })
})

describe('TaskCalendar 子任务浮层入口', () => {
  it('点 m/n 徽标打开浮层，子任务 chip 仍留在顶层（不去重）', () => {
    const today = startOfDay(new Date()).getTime()
    useTaskStore.setState({
      tasks: [
        mk('parent-a', { dueDate: today + 12 * 3600 * 1000 }),
        mk('sub-a', { parentId: 'parent-a' }),
      ],
      loading: false,
    })
    render(<TaskCalendar categoryId={null} />)
    fireEvent.click(screen.getByText('0/1'))
    expect(screen.getByPlaceholderText('添加子任务...')).toBeInTheDocument()
    expect(screen.getAllByText('parent-a').length).toBe(2)
    expect(screen.getAllByText('sub-a').length).toBe(2)
  })

  it('再次点徽标收起浮层', () => {
    const today = startOfDay(new Date()).getTime()
    useTaskStore.setState({
      tasks: [
        mk('parent-a', { dueDate: today + 12 * 3600 * 1000 }),
        mk('sub-a', { parentId: 'parent-a' }),
      ],
      loading: false,
    })
    render(<TaskCalendar categoryId={null} />)
    fireEvent.click(screen.getAllByText('0/1')[0])
    expect(screen.getByPlaceholderText('添加子任务...')).toBeInTheDocument()
    fireEvent.click(screen.getAllByText('0/1')[0])
    expect(screen.queryByPlaceholderText('添加子任务...')).toBeNull()
  })

  it('无子任务的 chip 也能通过树按钮打开空态浮层', () => {
    const today = startOfDay(new Date()).getTime()
    useTaskStore.setState({
      tasks: [mk('lonely-chip', { dueDate: today + 12 * 3600 * 1000 })],
      loading: false,
    })
    render(<TaskCalendar categoryId={null} />)
    fireEvent.click(screen.getByLabelText('管理子任务'))
    expect(screen.getByPlaceholderText('添加子任务...')).toBeInTheDocument()
    expect(screen.getAllByText('lonely-chip').length).toBe(2)
  })

  it('点外部关闭浮层', () => {
    const today = startOfDay(new Date()).getTime()
    useTaskStore.setState({
      tasks: [
        mk('parent-a', { dueDate: today + 12 * 3600 * 1000 }),
        mk('sub-a', { parentId: 'parent-a' }),
      ],
      loading: false,
    })
    render(<TaskCalendar categoryId={null} />)
    fireEvent.click(screen.getByText('0/1'))
    expect(screen.getByPlaceholderText('添加子任务...')).toBeInTheDocument()
    fireEvent.mouseDown(document.body)
    expect(screen.queryByPlaceholderText('添加子任务...')).toBeNull()
  })

  it('m/n 徽标与树按钮都 stopPropagation，不触发 chip 选中', () => {
    const today = startOfDay(new Date()).getTime()
    useTaskStore.setState({
      tasks: [
        mk('parent-a', { dueDate: today + 12 * 3600 * 1000 }),
        mk('sub-a', { parentId: 'parent-a' }),
      ],
      selectedTask: null,
      loading: false,
    })
    render(<TaskCalendar categoryId={null} />)
    fireEvent.click(screen.getByText('0/1'))
    expect(useTaskStore.getState().selectedTask).toBeNull()
    expect(screen.getByPlaceholderText('添加子任务...')).toBeInTheDocument()
  })
})
