import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { addDays, format, startOfDay, startOfMonth } from 'date-fns'
import { TaskCalendar } from '../src/components/task-calendar'
import { useTaskStore } from '../src/stores/task-store'
import { buildMonthGrid, dayKey } from '../src/components/task-calendar-view'
import type { Task } from '../src/types/task'

const mock = vi.hoisted(() => ({
  taskUpdate: vi.fn().mockResolvedValue(null),
  taskUpdateStatus: vi.fn().mockResolvedValue(null),
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

function cellOf(el: HTMLElement): HTMLElement {
  const cell = el.closest('.border-r')
  expect(cell).not.toBeNull()
  return cell as HTMLElement
}

function dateElOf(cell: HTMLElement): HTMLElement {
  const row = cell.firstElementChild as HTMLElement
  return row.querySelector('span, button') as HTMLElement
}

function setTasks(tasks: Task[]) {
  useTaskStore.setState({ tasks, statusView: 'all', selectedTask: null, loading: false })
}

beforeEach(() => {
  Object.defineProperty(window, 'electronAPI', {
    value: mock,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  useTaskStore.setState({ tasks: [], statusView: 'all', selectedTask: null })
  vi.clearAllMocks()
})

describe('TaskCalendar 逾期与今天', () => {
  it('逾期任务标题为 destructive 色，且所在过去日期格日期变红', () => {
    const yesterday = startOfDay(addDays(new Date(), -1))
    setTasks([mk('overdue-task', { dueDate: yesterday.getTime() + 23 * 3600 * 1000 + 59 * 60000 })])
    render(<TaskCalendar categoryId={null} />)
    const title = screen.getByText('overdue-task')
    expect(title.className).toContain('text-destructive')
    const cell = cellOf(title)
    expect(dateElOf(cell).className).toContain('text-destructive')
  })

  it('今天到期的任务不算逾期，今天格有高亮', () => {
    const today = startOfDay(new Date())
    setTasks([mk('today-task', { dueDate: today.getTime() + 23 * 3600 * 1000 + 59 * 60000 })])
    render(<TaskCalendar categoryId={null} />)
    const title = screen.getByText('today-task')
    expect(title.className).not.toContain('text-destructive')
    const dateEl = dateElOf(cellOf(title))
    expect(dateEl.className).toContain('bg-accent')
    expect(dateEl.className).toContain('ring-1')
  })

  it('statusView=all 时已完成任务混排显示且淡化', () => {
    const today = startOfDay(new Date())
    setTasks([
      mk('done-task', { status: 'done', dueDate: today.getTime() + 12 * 3600 * 1000 }),
      mk('todo-task', { dueDate: today.getTime() + 12 * 3600 * 1000 }),
    ])
    render(<TaskCalendar categoryId={null} />)
    const chip = screen.getByText('done-task').parentElement as HTMLElement
    expect(chip.className).toContain('line-through')
    expect(chip.className).toContain('opacity-60')
    const todo = screen.getByText('todo-task').parentElement as HTMLElement
    expect(todo.className).not.toContain('opacity-60')
  })
})

describe('TaskCalendar 提醒与区间', () => {
  it('未完成且有提醒的任务显示铃铛图标', () => {
    const today = startOfDay(new Date())
    setTasks([
      mk('reminded', { dueDate: today.getTime(), reminderTime: today.getTime() + 3600000 }),
    ])
    render(<TaskCalendar categoryId={null} />)
    const chip = screen.getByText('reminded').parentElement as HTMLElement
    expect(chip.querySelector('svg')).not.toBeNull()
  })

  it('跨天任务在区间内每一格都出现', () => {
    const start = startOfDay(new Date())
    const due = addDays(start, 2)
    setTasks([mk('range-task', { startDate: start.getTime(), dueDate: due.getTime() })])
    render(<TaskCalendar categoryId={null} />)
    const keys = buildMonthGrid(startOfMonth(new Date())).map((c) => c.key)
    const expected = keys.filter((k) => k >= dayKey(start) && k <= dayKey(due)).length
    expect(expected).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('range-task').length).toBe(expected)
  })
})

describe('TaskCalendar 格子信息', () => {
  it('当日超过 3 条时显示 +N 并可展开', () => {
    const today = startOfDay(new Date())
    const tasks = ['a', 'b', 'c', 'd'].map((id) =>
      mk(id, { dueDate: today.getTime() + 12 * 3600 * 1000 }),
    )
    setTasks(tasks)
    render(<TaskCalendar categoryId={null} />)
    expect(screen.queryByText('a')).not.toBeNull()
    expect(screen.queryByText('d')).toBeNull()
    fireEvent.click(screen.getByText('+1'))
    expect(screen.queryByText('d')).not.toBeNull()
    expect(screen.getByText('收起')).toBeInTheDocument()
  })

  it('相邻月补位日期可点击跳转到该月', () => {
    setTasks([])
    const { container } = render(<TaskCalendar categoryId={null} />)
    const header = screen.getByText(format(startOfMonth(new Date()), 'yyyy年M月'))
    const oldLabel = header.textContent!
    const outOfMonth = buildMonthGrid(startOfMonth(new Date())).filter((c) => !c.inMonth)
    const dateButtons = Array.from(container.querySelectorAll('button')).filter((b) =>
      /^\d+$/.test(b.textContent ?? ''),
    )
    expect(dateButtons.length).toBe(outOfMonth.length)
    if (outOfMonth.length === 0) return
    const target = outOfMonth[0]
    fireEvent.click(dateButtons[0])
    expect(screen.getByText(format(new Date(target.date), 'yyyy年M月'))).toBeInTheDocument()
    expect(screen.queryByText(oldLabel)).toBeNull()
  })

  it('未设置日期的任务进底部折叠区', () => {
    setTasks([mk('nodate')])
    render(<TaskCalendar categoryId={null} />)
    const panel = screen.getByText('未设置日期 (1)').nextElementSibling as HTMLElement
    expect(panel.style.height).toBe('0px')
    fireEvent.click(screen.getByText('未设置日期 (1)'))
    expect(panel.style.height).toBe('')
    expect(screen.getByText('nodate')).toBeInTheDocument()
  })
})

describe('TaskCalendar 完成与子任务', () => {
  function chipOf(title: string): HTMLElement {
    return screen.getByText(title).closest('[data-cal-task-id]') as HTMLElement
  }

  it('未完成 chip 悬停前显示圆点、勾选框隐藏，点击勾选框完成任务', async () => {
    const today = startOfDay(new Date())
    setTasks([mk('todo-task', { dueDate: today.getTime() + 12 * 3600 * 1000 })])
    render(<TaskCalendar categoryId={null} />)
    const chip = chipOf('todo-task')
    const dot = chip.querySelector('span[aria-hidden]') as HTMLElement
    expect(dot.className).toContain('group-hover:invisible')
    const box = chip.querySelector('[role="checkbox"]') as HTMLElement
    expect(box.className).toContain('opacity-0')
    fireEvent.click(box)
    await waitFor(() => expect(mock.taskUpdateStatus).toHaveBeenCalledWith('todo-task', 'done'))
  })

  it('已完成 chip 常驻勾选框，点击可重新打开', async () => {
    const today = startOfDay(new Date())
    setTasks([mk('done-task', { status: 'done', dueDate: today.getTime() + 12 * 3600 * 1000 })])
    render(<TaskCalendar categoryId={null} />)
    const chip = chipOf('done-task')
    const box = chip.querySelector('[role="checkbox"]') as HTMLElement
    expect(box.className).not.toContain('opacity-0')
    fireEvent.click(box)
    await waitFor(() => expect(mock.taskUpdateStatus).toHaveBeenCalledWith('done-task', 'todo'))
  })

  it('有子任务的 chip 显示 m/n 进度', () => {
    const today = startOfDay(new Date())
    setTasks([
      mk('parent-task', { dueDate: today.getTime() + 12 * 3600 * 1000 }),
      mk('child-done', { status: 'done', parentId: 'parent-task' }),
      mk('child-todo', { parentId: 'parent-task' }),
    ])
    render(<TaskCalendar categoryId={null} />)
    expect(screen.getByText('1/2')).toBeInTheDocument()
  })

  it('右键菜单标记完成待办任务', async () => {
    const today = startOfDay(new Date())
    setTasks([mk('menu-task', { dueDate: today.getTime() + 12 * 3600 * 1000 })])
    render(<TaskCalendar categoryId={null} />)
    fireEvent.contextMenu(chipOf('menu-task'))
    fireEvent.click(screen.getByText('标记完成'))
    await waitFor(() => expect(mock.taskUpdateStatus).toHaveBeenCalledWith('menu-task', 'done'))
  })

  it('右键菜单重新打开已完成任务', async () => {
    const today = startOfDay(new Date())
    setTasks([mk('menu-task', { status: 'done', dueDate: today.getTime() + 12 * 3600 * 1000 })])
    render(<TaskCalendar categoryId={null} />)
    fireEvent.contextMenu(chipOf('menu-task'))
    fireEvent.click(screen.getByText('重新打开'))
    await waitFor(() => expect(mock.taskUpdateStatus).toHaveBeenCalledWith('menu-task', 'todo'))
  })
})

describe('TaskCalendar 跨天连贯', () => {
  function chipsOf(title: string): HTMLElement[] {
    return screen.getAllByText(title).map((el) => el.closest('[data-cal-task-id]') as HTMLElement)
  }

  it('跨天任务段通栏，首/中/末段圆角正确且中段不变暗', () => {
    const grid = buildMonthGrid(startOfMonth(new Date()))
    const start = startOfDay(grid[1].date)
    const due = addDays(start, 2)
    setTasks([
      mk('seg-task', {
        startDate: start.getTime(),
        dueDate: due.getTime() + 23 * 3600 * 1000 + 59 * 60000,
      }),
    ])
    render(<TaskCalendar categoryId={null} />)
    const chips = chipsOf('seg-task')
    expect(chips.length).toBe(3)
    expect(chips.map((c) => c.dataset.rangeSeg)).toEqual(['l', 'm', 'r'])
    for (const c of chips) expect(c.className).toContain('-mx-1')
    expect(chips[1].className).toContain('rounded-l-none')
    expect(chips[1].className).toContain('rounded-r-none')
    expect(chips[0].className).not.toContain('rounded-l-none')
    expect(chips[2].className).not.toContain('rounded-r-none')
    expect(chips[1].className).not.toContain('opacity-60')
  })

  it('跨周任务在行尾/行首自动补圆角续接', () => {
    const grid = buildMonthGrid(startOfMonth(new Date()))
    const start = startOfDay(grid[5].date)
    const due = addDays(start, 2)
    setTasks([
      mk('week-task', {
        startDate: start.getTime(),
        dueDate: due.getTime() + 23 * 3600 * 1000 + 59 * 60000,
      }),
    ])
    render(<TaskCalendar categoryId={null} />)
    const chips = chipsOf('week-task')
    expect(chips.length).toBe(3)
    expect(chips.map((c) => c.dataset.rangeSeg)).toEqual(['l', 'r', 'lr'])
  })

  it('单日任务不带段标记，无通栏样式', () => {
    const today = startOfDay(new Date())
    setTasks([mk('single-task', { dueDate: today.getTime() + 12 * 3600 * 1000 })])
    render(<TaskCalendar categoryId={null} />)
    const chip = screen.getByText('single-task').closest('[data-cal-task-id]') as HTMLElement
    expect(chip.dataset.rangeSeg).toBeUndefined()
    expect(chip.className).not.toContain('-mx-1')
    expect(chip.className).not.toContain('rounded-l-none')
    expect(chip.className).not.toContain('rounded-r-none')
  })

  it('已完成的跨天任务整条仍淡化', () => {
    const grid = buildMonthGrid(startOfMonth(new Date()))
    const start = startOfDay(grid[1].date)
    const due = addDays(start, 1)
    setTasks([
      mk('done-range', {
        status: 'done',
        startDate: start.getTime(),
        dueDate: due.getTime() + 23 * 3600 * 1000 + 59 * 60000,
      }),
    ])
    render(<TaskCalendar categoryId={null} />)
    for (const chip of chipsOf('done-range')) {
      expect(chip.className).toContain('opacity-60')
      expect(chip.className).toContain('line-through')
    }
  })
})

describe('TaskCalendar 改期', () => {
  const dt = { setData: vi.fn(), getData: vi.fn(), dropEffect: '', effectAllowed: '' }

  it('拖拽到别的日期格改期', async () => {
    const today = startOfDay(new Date())
    setTasks([mk('drag-me', { dueDate: today.getTime() + 12 * 3600 * 1000 })])
    render(<TaskCalendar categoryId={null} />)
    const chip = screen.getByText('drag-me').parentElement as HTMLElement
    const fromCell = cellOf(chip)
    const next = fromCell.nextElementSibling as HTMLElement | null
    const toCell = next ?? (fromCell.previousElementSibling as HTMLElement)
    const delta = next ? 1 : -1
    fireEvent.dragStart(chip, { dataTransfer: dt })
    fireEvent.dragOver(toCell, { dataTransfer: dt })
    fireEvent.drop(toCell, { dataTransfer: dt })
    await waitFor(() => expect(mock.taskUpdate).toHaveBeenCalledTimes(1))
    const expected = startOfDay(addDays(new Date(), delta)).getTime() + 12 * 3600 * 1000
    expect(mock.taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'drag-me', dueDate: expected }),
    )
  })

  it('右键菜单可快速改期到今天', async () => {
    const yesterday = startOfDay(addDays(new Date(), -1))
    setTasks([mk('menu-me', { dueDate: yesterday.getTime() + 12 * 3600 * 1000 })])
    render(<TaskCalendar categoryId={null} />)
    const chip = screen.getByText('menu-me').parentElement as HTMLElement
    fireEvent.contextMenu(chip)
    fireEvent.click(screen.getByText('移到今天'))
    await waitFor(() => expect(mock.taskUpdate).toHaveBeenCalledTimes(1))
    const expected = startOfDay(new Date()).getTime() + 12 * 3600 * 1000
    expect(mock.taskUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'menu-me', dueDate: expected }),
    )
  })

  it('右键清除日期把任务移入未设置日期', async () => {
    const today = startOfDay(new Date())
    setTasks([mk('clear-me', { dueDate: today.getTime() + 12 * 3600 * 1000 })])
    render(<TaskCalendar categoryId={null} />)
    const chip = screen.getByText('clear-me').parentElement as HTMLElement
    fireEvent.contextMenu(chip)
    fireEvent.click(screen.getByText('清除日期'))
    await waitFor(() => expect(mock.taskUpdate).toHaveBeenCalledTimes(1))
    expect(mock.taskUpdate).toHaveBeenCalledWith({
      id: 'clear-me',
      dueDate: null,
      startDate: null,
    })
  })
})
