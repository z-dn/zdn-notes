import { createElement, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Play, Square, Bot, Minus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'

// ===================================================================
// DshPage —— DSH 主区域，双形态：
//   未启动：居中空状态卡片（图标 + 说明 + 启动按钮）；
//   运行中：<webview> 全屏沉浸接管，右下角一枚可拖拽状态胶囊，
//           可收起为小圆点、可在内容区内任意拖动（位置跨重启记忆）。
// 状态来源：主进程 dsh:statusChanged 事件推送（挂载时拉一次初值）。
//
// 胶囊交互：
//   - 拖拽：Pointer Events + setPointerCapture（沿用 mindmap-canvas 先例），
//     实时 clamp 在内容区边界内；拖拽中禁用过渡动画。
//   - 点击 vs 拖拽：位移 < DRAG_THRESHOLD_PX 视为点击（收缩态点击展开）；
//     带 .js-nodrag 的按钮（收起/关闭）不进入拖拽流程。
//   - 持久化：{x, y, collapsed} 存 localStorage（渲染层本地 UI 偏好），
//     恢复时按容器边界 clamp 校验。
// ===================================================================

interface DshStatus {
  running: boolean
  port?: number
}

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
      pos:
        typeof s.x === 'number' && typeof s.y === 'number' ? { x: s.x, y: s.y } : null,
      collapsed: !!s.collapsed,
    }
  } catch {
    return { pos: null, collapsed: false }
  }
}

export function DshPage() {
  const [port, setPort] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notReadyReason, setNotReadyReason] = useState('')

  useEffect(() => {
    let cancelled = false
    window.electronAPI.dshIsReady().then((r) => {
      if (!cancelled && !r.ready) setNotReadyReason(r.reason ?? '')
    })
    window.electronAPI.dshGetStatus().then((s) => {
      if (cancelled) return
      setRunning(s.running)
      setPort(s.running ? s.port ?? null : null)
    })
    const unsub = window.electronAPI.onDshStatusChanged((s: DshStatus) => {
      setRunning(s.running)
      setPort(s.running ? s.port ?? null : null)
    })
    return () => {
      cancelled = true
      unsub()
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

  async function handleStop() {
    await window.electronAPI.dshStop()
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
    // 按钮（收起/关闭）自身处理点击，不进入拖拽流程
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

    if (pill.collapsed) {
      return (
        <div ref={containerRef} className="relative h-full w-full bg-panel">
          {createElement('webview', {
            key: port,
            src: `http://127.0.0.1:${port}`,
            className: 'h-full w-full',
            style: { width: '100%', height: '100%' },
            allowpopups: 'false',
          })}
          <div
            ref={pillRef}
            role="button"
            tabIndex={0}
            title="DSH 运行中 · 点击展开"
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
        </div>
      )
    }

    return (
      <div ref={containerRef} className="relative h-full w-full bg-panel">
        {createElement('webview', {
          key: port,
          src: `http://127.0.0.1:${port}`,
          className: 'h-full w-full',
          style: { width: '100%', height: '100%' },
          allowpopups: 'false',
        })}
        <div
          ref={pillRef}
          style={posStyle}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`group absolute z-20 flex touch-none items-center gap-2 rounded-full border border-divider bg-panel py-1 pl-2.5 pr-1.5 shadow-lg ${posClass} ${dragClass}`}
        >
          <span
            className="flex select-none items-center gap-1.5"
            title={`http://127.0.0.1:${port}`}
          >
            <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
            <span className="max-w-0 overflow-hidden text-[11px] whitespace-nowrap text-muted-foreground opacity-0 transition-all duration-200 ease-in-out group-hover:max-w-40 group-hover:opacity-100">
              http://127.0.0.1:{port}
            </span>
          </span>
          <Button
            size="sm"
            variant="ghost"
            className="js-nodrag h-6 rounded-full px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
            onClick={() => setPill((p) => ({ ...p, collapsed: true }))}
            title="收起为小圆点"
          >
            <Minus className="size-3" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="js-nodrag h-6 rounded-full px-1.5 text-[11px] text-muted-foreground hover:text-destructive"
            onClick={handleStop}
            title="关闭 DSH"
          >
            <Square className="size-3" />
          </Button>
        </div>
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
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {notReadyReason ? (
              <>
                运行时不可用：{notReadyReason}
                <br />
                请先运行 <code>npm run build:dsh</code>
              </>
            ) : (
              '内嵌官方 AI 编程助手 Web UI，本地运行、开箱即用。'
            )}
          </p>
        </div>
        <Button size="sm" onClick={handleStart} disabled={busy || !!notReadyReason}>
          {busy ? (
            <>
              <LoaderSpinner />
              正在启动…
            </>
          ) : (
            <>
              <Play className="size-3.5" />
              启动
            </>
          )}
        </Button>
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
