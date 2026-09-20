import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bot, Minus, Power, Puzzle } from 'lucide-react'
import { toast } from '@/lib/toast'
import { useDshUiStore } from '@/stores/dsh-ui-store'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Tip } from '@/components/tip-button'

// ===================================================================
// DshPage —— DSH 主区域，双形态：
//   未启动：居中空状态卡片（图标 + 说明 + 电源启动钮 + 管理插件入口）；
//   运行中：内容由 DshWebviewLayer（App 层常驻 iframe）承载，本组件只
//           负责空态/占位与一枚可拖拽状态胶囊（唯一控制入口）。
//
// 胶囊交互（2bbb779 胶囊时代回归）：
//   - 拖拽：Pointer Events + setPointerCapture，实时 clamp 在内容区边界内；
//     拖拽中禁用过渡动画
//   - 点击 vs 拖拽：位移 < DRAG_THRESHOLD_PX 视为点击（收缩态点击展开）；
//     带 .js-nodrag 的按钮（插件/收起/关闭）不进入拖拽流程
//   - 持久化：{x, y, collapsed} 存 localStorage（渲染层本地 UI 偏好），
//     恢复时按容器边界 clamp 校验
// 运行状态来源：useDshUiStore（dsh:statusChanged 全局单源）。
// ===================================================================

interface PillPos {
  x: number
  y: number
}

interface PillState {
  pos: PillPos | null
  collapsed: boolean
}

const PILL_STORAGE_KEY = 'zdn.dshPill'
const DRAG_THRESHOLD_PX = 5
const PILL_MARGIN_PX = 4

function loadPillState(): PillState {
  try {
    const raw = localStorage.getItem(PILL_STORAGE_KEY)
    if (!raw) return { pos: null, collapsed: false }
    const s = JSON.parse(raw) as { x?: unknown; y?: unknown; collapsed?: unknown }
    return {
      pos: typeof s.x === 'number' && typeof s.y === 'number' ? { x: s.x, y: s.y } : null,
      collapsed: !!s.collapsed,
    }
  } catch {
    return { pos: null, collapsed: false }
  }
}

export function DshPage() {
  const running = useDshUiStore((s) => s.running)
  const port = useDshUiStore((s) => s.port)
  const webUrl = useDshUiStore((s) => s.webUrl)
  const setPluginDialogOpen = useDshUiStore((s) => s.setPluginDialogOpen)
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

  // ---- 胶囊：拖拽 + 收缩 + 持久化 ----

  const containerRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<PillState>(loadPillState)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    startX: number
    startY: number
    baseX: number
    baseY: number
    moved: boolean
  } | null>(null)

  function clampToContainer(x: number, y: number): PillPos {
    const c = containerRef.current
    const el = pillRef.current
    if (!c || !el) return { x, y }
    const maxX = Math.max(PILL_MARGIN_PX, c.clientWidth - el.offsetWidth - PILL_MARGIN_PX)
    const maxY = Math.max(PILL_MARGIN_PX, c.clientHeight - el.offsetHeight - PILL_MARGIN_PX)
    return {
      x: Math.min(Math.max(x, PILL_MARGIN_PX), maxX),
      y: Math.min(Math.max(y, PILL_MARGIN_PX), maxY),
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    // 按钮自身处理点击，不进入拖拽流程
    if ((e.target as HTMLElement).closest('.js-nodrag')) return
    const el = pillRef.current
    const c = containerRef.current
    if (!el || !c) return
    const r = el.getBoundingClientRect()
    const cr = c.getBoundingClientRect()
    const base = pill.pos ?? { x: r.left - cr.left, y: r.top - cr.top }
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      baseX: base.x,
      baseY: base.y,
      moved: false,
    }
    el.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.startX
    const dy = e.clientY - d.startY
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
    d.moved = true
    if (!dragging) setDragging(true)
    setPill((p) => ({ ...p, pos: clampToContainer(d.baseX + dx, d.baseY + dy) }))
  }

  function onPointerUp() {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    if (!d.moved && pill.collapsed) {
      // 收缩态点击 → 展开（展开态点击无操作，避免误触）
      setPill((p) => ({ ...p, collapsed: false }))
    }
    setDragging(false)
  }

  // 持久化：非拖拽中的每次变化落盘
  useEffect(() => {
    if (dragging) return
    try {
      localStorage.setItem(
        PILL_STORAGE_KEY,
        JSON.stringify({ x: pill.pos?.x, y: pill.pos?.y, collapsed: pill.collapsed }),
      )
    } catch {
      /* 存储不可用时忽略 */
    }
  }, [pill, dragging])

  // 恢复的位置做一次边界校验（窗口尺寸可能已变）
  useLayoutEffect(() => {
    if (!pill.pos) return
    const clamped = clampToContainer(pill.pos.x, pill.pos.y)
    if (clamped.x !== pill.pos.x || clamped.y !== pill.pos.y) {
      setPill((p) => ({ ...p, pos: clamped }))
    }
  }, [pill.pos?.x, pill.pos?.y])

  if (running && port) {
    const posStyle = pill.pos ? { left: pill.pos.x, top: pill.pos.y } : undefined
    const posClass = pill.pos ? '' : 'bottom-3 right-3'
    const dragClass = dragging ? 'cursor-grabbing select-none' : 'cursor-grab'
    const hoverTitle = `DSH 运行中 · 127.0.0.1:${port}${version ? ` · v${version}` : ''}`

    return (
      <div ref={containerRef} className="relative h-full w-full bg-panel">
        {/* 内容由 App 层 DshWebviewLayer 承载；webUrl 未到（token 竞态窗口）时显示占位 */}
        {!webUrl && (
          <div className="flex h-full w-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <LoaderSpinner />
            <span>正在启动 DSH…</span>
          </div>
        )}

        {pill.collapsed ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <div
                ref={pillRef}
                role="button"
                tabIndex={0}
                style={posStyle}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setPill((p) => ({ ...p, collapsed: false }))
                }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className={`absolute z-20 flex size-5 touch-none items-center justify-center rounded-full border border-divider bg-panel shadow-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${posClass} ${dragClass}`}
              >
                <span className="size-2 animate-pulse rounded-full bg-green-500" />
              </div>
            </TooltipTrigger>
            <TooltipContent side="top">{`${hoverTitle} · 点击展开`}</TooltipContent>
          </Tooltip>
        ) : (
          <div
            ref={pillRef}
            style={posStyle}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className={`group absolute z-20 flex touch-none items-center gap-2 rounded-full border border-divider bg-panel py-1 pl-2.5 pr-1.5 shadow-lg ${posClass} ${dragClass}`}
          >
            <Tip tip={hoverTitle}>
              <span className="select-none">
                <span className="flex items-center gap-1.5">
                  <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
                  <span className="max-w-0 overflow-hidden text-[11px] whitespace-nowrap text-muted-foreground opacity-0 transition-all duration-200 ease-in-out group-hover:max-w-40 group-hover:opacity-100">
                    DSH 运行中
                  </span>
                </span>
              </span>
            </Tip>
            <button
              onClick={() => setPluginDialogOpen(true)}
              aria-label="管理插件"
              className="js-nodrag flex h-6 items-center rounded-full px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Tip tip="管理插件" side="bottom">
                <Puzzle className="size-3" />
              </Tip>
            </button>
            <button
              onClick={() => setPill((p) => ({ ...p, collapsed: true }))}
              aria-label="收起为小圆点"
              className="js-nodrag flex h-6 items-center rounded-full px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Tip tip="收起为小圆点" side="bottom">
                <Minus className="size-3" />
              </Tip>
            </button>
            <button
              onClick={async () => {
                await window.electronAPI.dshStop()
              }}
              aria-label="关闭 DSH"
              className="js-nodrag flex h-6 items-center rounded-full px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <Tip tip="关闭 DSH" side="bottom">
                <Power className="size-3" />
              </Tip>
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
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
          <Tip tip={busy ? '正在启动…' : '启动 DeepSeek Harness'}>
            <button
              onClick={handleStart}
              disabled={busy || !!notReadyReason}
              aria-label="启动 DeepSeek Harness"
              className="group flex size-16 items-center justify-center rounded-full border border-divider bg-panel-header shadow-sm transition-all duration-200 ease-in-out hover:bg-accent hover:shadow-md focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <LoaderSpinner />
              ) : (
                <Power className="size-6 text-muted-foreground transition-colors group-hover:text-foreground" />
              )}
            </button>
          </Tip>
          <span className="text-[11px] text-muted-foreground">
            {busy ? '正在启动…' : notReadyReason ? '不可用' : '点击启动'}
          </span>
        </div>
        <button
          onClick={() => setPluginDialogOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <Puzzle className="size-3" />
          管理插件
        </button>
      </div>
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
