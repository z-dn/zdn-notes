import { useToolStore } from '@/stores/tool-store'
import { TOOLS } from './tools'
import { Tip } from '@/components/tip-button'

export function ToolboxSidebar() {
  const activeToolId = useToolStore((s) => s.activeToolId)
  const setActiveToolId = useToolStore((s) => s.setActiveToolId)

  return (
    <div className="group relative flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {TOOLS.map((tool) => {
          const Icon = tool.icon
          const active = activeToolId === tool.id
          return (
            <Tip key={tool.id} tip={tool.description} side="right">
              <button
                onClick={() => setActiveToolId(tool.id)}
                className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                  active
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                }`}
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1 truncate">{tool.name}</span>
              </button>
            </Tip>
          )
        })}
      </div>
    </div>
  )
}
