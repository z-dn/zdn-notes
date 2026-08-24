import { useEffect } from 'react'

export interface TabMenuState {
  x: number
  y: number
  viewId: string
}

export function TabContextMenu({ menu, onClose }: { menu: TabMenuState; onClose: () => void }) {
  useEffect(() => {
    const close = () => onClose()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('click', close)
    window.addEventListener('pointerdown', close)
    window.addEventListener('blur', close)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  async function openInNewWindow() {
    await window.electronAPI.openViewWindow(menu.viewId)
    onClose()
  }

  return (
    <div
      className="animate-fade-slide-up fixed z-50 min-w-36 rounded-md border border-input bg-popover p-1 shadow-lg"
      style={{
        left: Math.max(0, Math.min(menu.x, window.innerWidth - 152)),
        top: Math.max(0, Math.min(menu.y, window.innerHeight - 48)),
      }}
      // 阻止冒泡到 window 的关闭监听，否则 pointerdown 先于 click 卸载菜单，按钮收不到点击
      onPointerDown={(e) => e.stopPropagation()}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          openInNewWindow()
        }}
        className="w-full rounded-sm px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        在新窗口打开
      </button>
    </div>
  )
}
