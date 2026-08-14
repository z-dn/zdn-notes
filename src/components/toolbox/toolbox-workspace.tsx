import { useToolStore } from '@/stores/tool-store'
import { TOOLS } from './tools'

export function ToolboxWorkspace() {
  const activeToolId = useToolStore((s) => s.activeToolId)
  const tool = TOOLS.find((t) => t.id === activeToolId) ?? TOOLS[0]
  const Comp = tool.component

  return <Comp key={tool.id} />
}
