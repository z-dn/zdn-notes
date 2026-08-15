import { describe, it, expect } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MilkdownEditor } from '../src/components/milkdown-editor'
import { mindmapNode, commonmarkForMindmap } from '../src/components/toolbox/tools/mindmap-node'

describe('scratchpad editor fresh load', () => {
  it('renders an empty editable editor without any mindmap block', async () => {
    const { container } = render(
      <MilkdownEditor
        content=""
        onChange={() => {}}
        extraPlugins={mindmapNode}
        commonmarkPlugins={commonmarkForMindmap}
      />,
    )

    await waitFor(
      () => {
        expect(container.querySelector('[contenteditable="true"]')).toBeTruthy()
      },
      { timeout: 5000 },
    )

    expect(container.querySelector('.mindmap-block')).toBeNull()
  })

  it('renders a mindmap block only when content contains a non-empty mindmap fence', async () => {
    const { container } = render(
      <MilkdownEditor
        content={'```mindmap\n- 中心主题\n```\n'}
        onChange={() => {}}
        extraPlugins={mindmapNode}
        commonmarkPlugins={commonmarkForMindmap}
      />,
    )

    await waitFor(
      () => {
        expect(container.querySelector('.mindmap-block')).toBeTruthy()
      },
      { timeout: 5000 },
    )
  })
})
