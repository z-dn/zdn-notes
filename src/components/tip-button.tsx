import type { ReactNode } from 'react'
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

// ===================================================================
// 应用风格 tooltip 原语：替代原生 title= 属性。
// TipButton —— 可交互元素（保持 asChild 透传，子元素自带事件），
//              或不传 children 时渲染原子化 lucide 图标按钮。
// Tip —— 非交互文本/块的悬停提示（如完整路径、状态信息）。
// ===================================================================

export function Tip({
  tip,
  children,
  side,
}: {
  tip: string
  children: ReactNode
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>{children}</TooltipTrigger>
        <TooltipContent side={side}>{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function TipButton({
  tip,
  children,
  onClick,
  className,
  disabled,
  side = 'top',
}: {
  tip: string
  children: ReactNode
  onClick?: () => void
  className?: string
  disabled?: boolean
  side?: 'top' | 'bottom' | 'left' | 'right'
}) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            disabled={disabled}
            className={cn(
              'rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:pointer-events-none disabled:opacity-50',
              className,
            )}
          >
            {children}
          </button>
        </TooltipTrigger>
        <TooltipContent side={side}>{tip}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
