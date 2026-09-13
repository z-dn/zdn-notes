import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Power, Puzzle } from 'lucide-react'
import { useDshUiStore } from '@/stores/dsh-ui-store'

// ===================================================================
// DshStatusBadge —— 标题栏 DSH 状态徽标 + 控制菜单。
// DSH 运行中在标题栏右侧显示入口（DOM 区，位于内容区 WebContentsView
// 之外，交互不受视图层级影响）。组件同时充当全局运行状态的单订阅源，
// 状态写入 useDshUiStore 供 DshPage / PluginDialog 消费。
// ===================================================================

interface DshStatus {
  running: boolean
  port?: number
  url?: string
}

interface DshStatusBadgeProps {
  /** 点击菜单内「切换到 DSH 页」的回调（App 层切 sidebarTab） */
  onOpenDsh?: () => void
}

export function DshStatusBadge({ onOpenDsh }: DshStatusBadgeProps) {
  const running = useDshUiStore((s) => s.running)
  const port = useDshUiStore((s) => s.port)
  const webUrl = useDshUiStore((s) => s.webUrl)
  const setStatus = useDshUiStore((s) => s.setStatus)
  const setPluginDialogOpen = useDshUiStore((s) => s.setPluginDialogOpen)
  const menuOpen = useDshUiStore((s) => s.badgeMenuOpen)
  const setMenuOpen = useDshUiStore((s) => s.setBadgeMenuOpen)
  const [version, setVersion] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // 全局单订阅：状态 → store（DshPage 与徽标共用）
  useEffect(() => {
    window.electronAPI.dshGetStatus().then((s: DshStatus) => setStatus(s))
    const unsub = window.electronAPI.onDshStatusChanged((s: DshStatus) => {
      setStatus(s)
    })
    return () => unsub()
  }, [setStatus])

  useEffect(() => {
    window.electronAPI.dshGetVersion().then((v) => {
      if (v) setVersion(v)
    })
  }, [])

  // 点击外部关闭菜单
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [menuOpen])

  if (!running || !port) return null

  const menuItems = (
    <>
      <button
        onClick={() => {
          setMenuOpen(false)
          onOpenDsh?.()
        }}
        className="w-full truncate rounded px-2 py-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        title={version ? `DeepSeek Harness v${version} · 前往 DSH 页` : '前往 DSH 页'}
      >
        {webUrl ?? `http://127.0.0.1:${port}`}
      </button>
      <button
        onClick={() => {
          setMenuOpen(false)
          setPluginDialogOpen(true)
        }}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent"
      >
        <Puzzle className="size-3" />
        管理插件
      </button>
      <div className="mx-1 h-px bg-border" />
      <button
        onClick={async () => {
          setMenuOpen(false)
          await window.electronAPI.dshStop()
        }}
        className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs text-foreground transition-colors hover:bg-accent hover:text-destructive"
      >
        <Power className="size-3" />
        关闭 DSH
      </button>
    </>
  )

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setMenuOpen(!menuOpen)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs transition-colors hover:bg-accent"
        title={
          version ? `DeepSeek Harness v${version} · http://127.0.0.1:${port}` : 'DSH 运行中'
        }
      >
        <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
        DSH
        <ChevronDown
          className={`size-3 text-muted-foreground transition-transform ${menuOpen ? 'rotate-180' : ''}`}
        />
      </button>
      {menuOpen && (
        <div
          className={`absolute right-0 top-full z-50 mt-1 w-64 rounded-md border border-divider bg-panel p-1 shadow-lg ${'animate-fade-slide-up'}`}
        >
          {menuItems}
        </div>
      )}
    </div>
  )
}
