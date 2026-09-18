import { render, screen, cleanup, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DshPage } from '../src/components/dsh/dsh-page'
import { useDshUiStore } from '../src/stores/dsh-ui-store'

// electronAPI mock（只含 DshPage / DshWebviewLayer 用到的通道）
const mock = vi.hoisted(() => ({
  dshIsReady: vi.fn().mockResolvedValue({ ready: true }),
  dshGetVersion: vi.fn().mockResolvedValue('0.1.5'),
  dshGetStatus: vi.fn().mockResolvedValue({ running: false }),
  dshStart: vi.fn().mockResolvedValue({ ok: true, port: 3000, error: '' }),
  onDshStatusChanged: vi.fn().mockReturnValue(() => {}),
}))

beforeEach(() => {
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
    expect(screen.getByTitle('启动 DeepSeek Harness')).toBeInTheDocument()
  })
})

describe('DshPage 胶囊（运行中）', () => {
  it('运行中显示状态胶囊（插件 / 收起 / 关闭入口）', async () => {
    act(() => {
      useDshUiStore.setState({ running: true, port: 3000, webUrl: null })
    })
    render(<DshPage />)
    expect(await screen.findByTitle('管理插件')).toBeInTheDocument()
    expect(screen.getByTitle('收起为小圆点')).toBeInTheDocument()
    expect(screen.getByTitle('关闭 DSH')).toBeInTheDocument()
    // token 未到（webUrl 空）：显示"正在启动"占位
    expect(screen.getByText('正在启动 DSH…')).toBeInTheDocument()
  })
})
