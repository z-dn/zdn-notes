import { useToolStore } from '@/stores/tool-store'
import { TOOLS } from './tools'
import { FadeSwitch } from '@/components/fade'

export function ToolboxWorkspace() {
  const activeToolId = useToolStore((s) => s.activeToolId)

  return (
    <FadeSwitch
      current={activeToolId}
      className="h-full"
      render={(id) => {
        const tool = TOOLS.find((t) => t.id === id) ?? TOOLS[0]
        const Comp = tool.component
        return <Comp key={tool.id} />
      }}
    />
  )
}
