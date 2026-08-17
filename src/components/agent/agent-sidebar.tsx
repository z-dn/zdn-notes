import { Boxes, FileText } from 'lucide-react'

export type AgentMenuKey = 'plugins' | 'docs'

const MENUS: { id: AgentMenuKey; label: string; icon: typeof Boxes }[] = [
  { id: 'plugins', label: '插件', icon: Boxes },
  { id: 'docs', label: '插件开发文档', icon: FileText },
]

interface AgentSidebarProps {
  menu: AgentMenuKey
  onMenuChange: (menu: AgentMenuKey) => void
}

export function AgentSidebar({ menu, onMenuChange }: AgentSidebarProps) {
  return (
    <div className="group relative flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-0.5 overflow-y-auto p-2">
        {MENUS.map((item) => {
          const Icon = item.icon
          const active = menu === item.id
          return (
            <button
              key={item.id}
              onClick={() => onMenuChange(item.id)}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                active
                  ? 'bg-primary/10 font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon className="size-4 shrink-0" />
              <span className="truncate">{item.label}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
