import { render, screen, cleanup, act, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DshPage } from '../src/components/dsh/dsh-page'
import { useDshUiStore } from '../src/stores/dsh-ui-store'

// electronAPI mock（只含 DshPage / DshWebviewLayer 用到的通道）
const mock = vi.hoisted(() => ({
  dshIsReady: vi.fn().mockResolvedValue({ ready: true }),
  dshGetVersion: vi.fn().mockResolvedValue('0.1.5'),
  dshGetStatus: vi.fn().mockResolvedValue({ running: false }),
  dshStart: vi.fn().mockResolvedValue({ ok: true, port: 3000, error: '' }),
  dshStop: vi.fn().mockResolvedValue(true),
  onDshStatusChanged: vi.fn().mockReturnValue(() => {}),
}))

beforeEach(() => {
  localStorage.clear()
  mock.dshIsReady.mockResolvedValue({ ready: true })
  mock.dshGetVersion.mockResolvedValue('0.1.5')
  mock.dshStart.mockReset().mockResolvedValue({ ok: true, port: 3000, error: '' })
  mock.dshStop.mockReset().mockResolvedValue(true)
  Object.defineProperty(window, 'electronAPI', {
    value: mock,
    configurable: true,
    writable: true,
  })
})

afterEach(() => {
  cleanup()
  act(() => {
    useDshUiStore.setState({
      running: false,
      port: null,
      webUrl: null,
      pluginDialogOpen: false,
    })
  })
  vi.clearAllMocks()
})

describe('DshPage 空态渲染', () => {
  it('未启动时显示空状态卡片（含启动按钮）', () => {
    render(<DshPage />)
    expect(document.body.innerHTML.length).toBeGreaterThan(0)
    expect(screen.getByText('DeepSeek Harness')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '启动 DeepSeek Harness' })).toBeInTheDocument()
  })
})

describe('DshPage 胶囊（运行中）', () => {
  it('运行中显示状态胶囊（插件 / 重启 / 收起 / 关闭入口）', async () => {
    act(() => {
      useDshUiStore.setState({ running: true, port: 3000, webUrl: null })
    })
    render(<DshPage />)
    expect(await screen.findByRole('button', { name: '管理插件' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '重启 DSH' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '收起为小圆点' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '关闭 DSH' })).toBeInTheDocument()
    // token 未到（webUrl 空）：显示"正在启动"占位
    expect(screen.getByText('正在启动 DSH…')).toBeInTheDocument()
  })

  it('光点随状态变色：未就绪为黄色，就绪为绿色', async () => {
    act(() => {
      useDshUiStore.setState({ running: true, port: 3000, webUrl: null })
    })
    const { container } = render(<DshPage />)
    await screen.findByRole('button', { name: '管理插件' })
    expect(container.querySelector('.bg-yellow-500')).toBeInTheDocument()
    expect(container.querySelector('.bg-green-500')).toBeNull()

    act(() => {
      useDshUiStore.setState({
        running: true,
        port: 3000,
        webUrl: 'http://127.0.0.1:3000/?token=x',
      })
    })
    expect(container.querySelector('.bg-green-500')).toBeInTheDocument()
    expect(container.querySelector('.bg-yellow-500')).toBeNull()
  })

  it('收起按钮在最右侧（左向箭头），收起后容器收窄为圆点宽', async () => {
    act(() => {
      useDshUiStore.setState({
        running: true,
        port: 3000,
        webUrl: 'http://127.0.0.1:3000/?token=x',
      })
    })
    render(<DshPage />)
    const collapseBtn = await screen.findByRole('button', { name: '收起为小圆点' })
    const closeBtn = screen.getByRole('button', { name: '关闭 DSH' })
    // 收起按钮位于胶囊最右（排在关闭按钮之后）
    expect(
      closeBtn.compareDocumentPosition(collapseBtn) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()
    expect(collapseBtn.querySelector('svg.lucide-chevron-left')).not.toBeNull()
    // 单元素常驻：展开态宽度 ≠ 收起态；点击收起后宽度切为20px（左边缘锚定收拢）
    const pillEl = collapseBtn.closest('[class*="overflow-hidden"]') as HTMLElement
    expect(pillEl.style.width).not.toBe('20px')
    fireEvent.click(collapseBtn)
    expect(pillEl.style.width).toBe('20px')
    // 收起后按钮行不可聚焦（inert）
    expect(closeBtn.closest('[inert]')).not.toBeNull()
  })

  it('重启按钮 stop→start，重启期间胶囊保留并显示重启占位', async () => {
    act(() => {
      useDshUiStore.setState({
        running: true,
        port: 3000,
        webUrl: 'http://127.0.0.1:3000/?token=x',
      })
    })
    const { container } = render(<DshPage />)

    let resolveStart!: (r: { ok: boolean; port?: number; error?: string }) => void
    mock.dshStop.mockImplementationOnce(async () => {
      // 模拟主进程 stop 后回写状态：running=false
      act(() => {
        useDshUiStore.setState({ running: false, port: null, webUrl: null })
      })
      return true
    })
    mock.dshStart.mockImplementationOnce(
      () =>
        new Promise<{ ok: boolean; port?: number; error?: string }>((r) => {
          resolveStart = r
        }),
    )

    fireEvent.click(screen.getByRole('button', { name: '重启 DSH' }))
    await waitFor(() => expect(mock.dshStart).toHaveBeenCalledTimes(1))
    // running 已回写 false，但 restarting 保持胶囊挂载（黄点 + 重启占位）
    expect(screen.getByText('正在重启 DSH…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '管理插件' })).toBeInTheDocument()
    expect(container.querySelector('.bg-yellow-500')).toBeInTheDocument()

    await act(async () => {
      resolveStart({ ok: true, port: 3000 })
    })
    expect(mock.dshStop).toHaveBeenCalledTimes(1)
  })
})
