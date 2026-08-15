import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { EditorContextMenu } from '../src/components/toolbox/tools/editor-context-menu'

describe('EditorContextMenu', () => {
  it('renders the insert mindmap item', () => {
    render(<EditorContextMenu x={10} y={20} onClose={vi.fn()} onInsert={vi.fn()} />)
    expect(screen.getByText('插入思维图')).toBeInTheDocument()
  })

  it('calls onInsert and onClose when clicked', () => {
    const onInsert = vi.fn()
    const onClose = vi.fn()
    render(<EditorContextMenu x={10} y={20} onClose={onClose} onInsert={onInsert} />)
    fireEvent.click(screen.getByText('插入思维图'))
    expect(onInsert).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on Escape', () => {
    const onClose = vi.fn()
    render(<EditorContextMenu x={10} y={20} onClose={onClose} onInsert={vi.fn()} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on outside mousedown', () => {
    const onClose = vi.fn()
    render(<EditorContextMenu x={10} y={20} onClose={onClose} onInsert={vi.fn()} />)
    fireEvent.mouseDown(document.body)
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
