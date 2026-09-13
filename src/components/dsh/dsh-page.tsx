import { useEffect, useRef, useState } from 'react'
import { Power, Bot, Puzzle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { useDshUiStore } from '@/stores/dsh-ui-store'

// ===================================================================
// DshPage —— DSH 主区域，双形态：
//   未启动：居中空状态卡片（图标 + 说明 + 电源启动钮 + 管理插件入口）；
//   运行中：内容由主进程 WebContentsView 承载（本页不渲染它），本组件
//           只负责上报内容区矩形/可见性；控制入口在标题栏 DshStatusBadge。
//
// 关键协作：WebContentsView 恒绘制在窗口 DOM 之上，因此
//   - 视图可见性/矩形经 dshSetViewVisible 上报（DIP，getBoundingClientRect
//     坐标系）；插件对话框打开（含从标题栏徽标打开）时暂时隐藏视图；
//   - 切走 tab 时组件卸载、effect 清理上报 visible=false，切回重新上报即可
//     ——视图本体在主进程保活，无重载。
// 运行状态来源：useDshUiStore（dsh-status-badge 全局订阅写入）。
// ===================================================================

interface ViewRectFx {
  x: number
  y: number
  width: number
  height: number
}

function rectOf(el: HTMLElement): ViewRectFx {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

export function DshPage() {
  const running = useDshUiStore((s) => s.running)
  const port = useDshUiStore((s) => s.port)
  const webUrl = useDshUiStore((s) => s.webUrl)
  const pluginDialogOpen = useDshUiStore((s) => s.pluginDialogOpen)
  const setPluginDialogOpen = useDshUiStore((s) => s.setPluginDialogOpen)
  const badgeMenuOpen = useDshUiStore((s) => s.badgeMenuOpen)
  const [version, setVersion] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notReadyReason, setNotReadyReason] = useState('')

  useEffect(() => {
    let cancelled = false
    window.electronAPI.dshIsReady().then((r) => {
      if (!cancelled && !r.ready) setNotReadyReason(r.reason ?? '')
    })
    window.electronAPI.dshGetVersion().then((v) => {
      if (!cancelled && v) setVersion(v)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function handleStart() {
    setBusy(true)
    try {
      const res = (await window.electronAPI.dshStart()) as {
        ok: boolean
        port?: number
        error?: string
      }
      if (!res.ok) toast(`启动失败: ${res.error ?? '未知错误'}`)
    } finally {
      setBusy(false)
    }
  }

  // ---- 视图可见性/矩形上报（bounds = 整个内容区；插件面板/标题栏菜单打开时隐藏）----
  const contentRef = useRef<HTMLDivElement>(null)
  const visible = running && !!webUrl && !pluginDialogOpen && !badgeMenuOpen
  useEffect(() => {
    const el = contentRef.current
    if (!visible || !el) {
      window.electronAPI.dshSetViewVisible(false, { x: 0, y: 0, width: 0, height: 0 })
      return
    }
    window.electronAPI.dshSetViewVisible(true, rectOf(el))
    const ro = new ResizeObserver(() => {
      window.electronAPI.dshSetViewVisible(true, rectOf(el))
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      // 卸载（切走 tab）或条件变化时隐藏视图
      window.electronAPI.dshSetViewVisible(false, { x: 0, y: 0, width: 0, height: 0 })
    }
  }, [visible])

  return (
    <div className="relative h-full w-full bg-panel">
      {running && port ? (
        /* WebContentsView 绘制区域；视图未就绪（等待 token）时显示占位，
            视图弹出后即被其盖住。与空态互斥渲染，避免两个 h-full 子树叠加把
            卡片挤出视口（曾致 DSH 页白屏） */
        <>
          <div ref={contentRef} className="h-full w-full">
            {!webUrl && (
              <div className="flex h-full w-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
                <LoaderSpinner />
                <span>正在启动 DSH…</span>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-panel">
          <div className="animate-fade-slide-up flex w-72 flex-col items-center gap-4 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-divider bg-panel-header shadow-sm">
              <Bot className="size-7 text-muted-foreground" />
            </div>
            <div className="space-y-1">
              <h2 className="text-sm font-medium">DeepSeek Harness</h2>
              {version && (
                <p className="text-[11px] leading-relaxed text-muted-foreground">版本 {version}</p>
              )}
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {notReadyReason ? (
                  <>
                    运行时不可用：{notReadyReason}
                    <br />
                    请重新安装完整的 ZDNotes 安装包（开发环境可运行{' '}
                    <code>npm run build:dsh</code>）
                  </>
                ) : (
                  '内嵌官方 AI 编程助手 Web UI，本地运行、开箱即用。'
                )}
              </p>
            </div>
            {/* 电源启动按钮 */}
            <div className="flex flex-col items-center gap-1.5">
              <button
                onClick={handleStart}
                disabled={busy || !!notReadyReason}
                title={busy ? '正在启动…' : '启动 DeepSeek Harness'}
                className="group flex size-16 items-center justify-center rounded-full border border-divider bg-panel-header shadow-sm transition-all duration-200 ease-in-out hover:bg-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? (
                  <LoaderSpinner />
                ) : (
                  <Power className="size-6 text-muted-foreground transition-colors group-hover:text-foreground" />
                )}
              </button>
              <span className="text-[11px] text-muted-foreground">
                {busy ? '正在启动…' : notReadyReason ? '不可用' : '点击启动'}
              </span>
            </div>
            <button
              onClick={() => setPluginDialogOpen(true)}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              title="管理 DSH 插件（安装 / 卸载）"
            >
              <Puzzle className="size-3" />
              管理插件
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function LoaderSpinner() {
  return (
    <svg
      className="size-3.5 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  )
}
