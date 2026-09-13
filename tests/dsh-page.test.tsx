import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DshPage } from '../src/components/dsh/dsh-page'

// electronAPI mock（只含 DshPage 用到的通道）
const mock = vi.hoisted(() => ({
  dshIsReady: vi.fn().mockResolvedValue({ ready: true }),
  dshGetVersion: vi.fn().mockResolvedValue('0.1.5'),
  dshStart: vi.fn().mockResolvedValue({ ok: true, port: 3000, error: '' }),
  dshSetViewVisible: vi.fn().mockResolvedValue(undefined),
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
