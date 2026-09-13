import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Power, Bot, Minus, Puzzle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'
import { DshPluginDialog } from '@/components/dsh/dsh-plugin-dialog'

// ===================================================================
// DshPage —— DSH 主区域，双形态：
//   未启动：居中空状态卡片（图标 + 说明 + 电源启动钮 + 管理插件入口）；
//   运行中：内容由主进程 WebContentsView 承载（本页 DOM 之下不渲染它），
//           底部一条胶囊控制条（状态点/插件/收起/关闭），可拖动（位置记忆）。
//
// 关键协作：WebContentsView 恒绘制在窗口 DOM 之上，因此
//   - 内容区底部预留控制条（DOM 不被视图遮住）；
//   - 视图可见性/矩形经 dshSetViewVisible 上报（DIP，getBoundingClientRect
//     坐标系）；插件对话框打开时暂时隐藏视图（DOM 弹窗需要盖住 DSH 内容）。
//   切走 tab 时组件卸载、effect 清理上报 visible=false，切回重新上报即可
//   ——视图本体在主进程保活，无重载。
// 状态来源：主进程 dsh:statusChanged 事件推送（挂载时拉一次初值）。
// ===================================================================

interface DshStatus {
  running: boolean
  port?: number
  url?: string
}

interface ViewRectFx {
  x: number
  y: number
  width: number
  height: number
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
      pos: typeof s.x === 'number' && typeof s.y === 'number' ? { x: s.x, y: s.y } : null,
      collapsed: !!s.collapsed,
    }
  } catch {
    return { pos: null, collapsed: false }
  }
}

function rectOf(el: HTMLElement): ViewRectFx {
  const r = el.getBoundingClientRect()
  return { x: r.left, y: r.top, width: r.width, height: r.height }
}

export function DshPage() {
  const [port, setPort] = useState<number | null>(null)
  const [webUrl, setWebUrl] = useState<string | null>(null)
  const [version, setVersion] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notReadyReason, setNotReadyReason] = useState('')
  const [pluginsOpen, setPluginsOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    window.electronAPI.dshIsReady().then((r) => {
      if (!cancelled && !r.ready) setNotReadyReason(r.reason ?? '')
    })
    window.electronAPI.dshGetVersion().then((v) => {
      if (!cancelled && v) setVersion(v)
    })
    window.electronAPI.dshGetStatus().then((s) => {
      if (cancelled) return
      applyStatus(s)
    })
    const unsub = window.electronAPI.onDshStatusChanged((s: DshStatus) => {
      applyStatus(s)
    })
    return () => {
      cancelled = true
      unsub()
    }
  }, [])

  function applyStatus(s: DshStatus) {
    setRunning(s.running)
    setPort(s.running ? (s.port ?? null) : null)
    setWebUrl(s.running && s.url ? s.url : null)
  }

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

  // ---- 视图可见性/矩形上报（决定 WebContentsView 的 bounds 与显隐）----
  const contentRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = contentRef.current
    const visible = running && !!webUrl
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
  }, [running, webUrl])

  // 插件对话框打开时暂时隐藏视图（DOM 弹窗无法盖在 WebContentsView 之上）
  useEffect(() => {
    if (!pluginsOpen) return
    window.electronAPI.dshSetViewVisible(false, { x: 0, y: 0, width: 0, height: 0 })
    return () => {
      if (running && webUrl && contentRef.current) {
        window.electronAPI.dshSetViewVisible(true, rectOf(contentRef.current))
      }
    }
  }, [pluginsOpen, running, webUrl])

  // ---- 胶囊：拖拽（限控制条内）+ 收缩 + 持久化 ----

  const barRef = useRef<HTMLDivElement>(null)
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

  function clampToBar(x: number, y: number): PillPos {
    const bar = barRef.current
    const el = pillRef.current
    if (!bar || !el) return { x, y }
    const maxX = Math.max(PILL_MARGIN_PX, bar.clientWidth - el.offsetWidth - PILL_MARGIN_PX)
    const maxY = Math.max(PILL_MARGIN_PX, bar.clientHeight - el.offsetHeight - PILL_MARGIN_PX)
    return {
      x: Math.min(Math.max(x, PILL_MARGIN_PX), maxX),
      y: Math.min(Math.max(y, PILL_MARGIN_PX), maxY),
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return
    // 按钮（插件/收起/关闭）自身处理点击，不进入拖拽流程
    if ((e.target as HTMLElement).closest('.js-nodrag')) return
    const el = pillRef.current
    const bar = barRef.current
    if (!el || !bar) return
    const r = el.getBoundingClientRect()
    const br = bar.getBoundingClientRect()
    const base = pill.pos ?? { x: r.left - br.left, y: r.top - br.top }
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
    setPill((p) => ({ ...p, pos: clampToBar(d.baseX + dx, d.baseY + dy) }))
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
    const clamped = clampToBar(pill.pos.x, pill.pos.y)
    if (clamped.x !== pill.pos.x || clamped.y !== pill.pos.y) {
      setPill((p) => ({ ...p, pos: clamped }))
    }
  }, [pill.pos?.x, pill.pos?.y])

  if (running && port) {
    const posStyle = pill.pos ? { left: pill.pos.x, top: pill.pos.y } : undefined
    const posClass = pill.pos ? '' : 'right-3'
    const dragClass = dragging ? 'cursor-grabbing select-none' : 'cursor-grab'

    return (
      <div className="relative flex h-full w-full flex-col bg-panel">
        {/* WebContentsView 绘制区域（底部控制条之外的部分） */}
        <div ref={contentRef} className="relative min-h-0 flex-1">
          {/* 视图未就绪（等待 token）时的占位，视图弹出后即被其盖住 */}
          {!webUrl && (
            <div className="flex h-full w-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
              <LoaderSpinner />
              <span>正在启动 DSH…</span>
            </div>
          )}
        </div>

        {/* 底部胶囊控制条：DOM 保证可交互（WebContentsView 不覆盖这层） */}
        <div
          ref={barRef}
          className="relative h-10 w-full shrink-0 border-t border-divider bg-panel-header"
        >
          {pill.collapsed ? (
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
              className={`absolute z-20 flex size-5 touch-none items-center justify-center rounded-full border border-divider bg-panel shadow-lg transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ${posClass} top-2.5 ${dragClass}`}
            >
              <span className="size-2 animate-pulse rounded-full bg-green-500" />
            </div>
          ) : (
            <div
              ref={pillRef}
              style={posStyle}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              className={`group absolute z-20 flex touch-none items-center gap-2 rounded-full border border-divider bg-panel py-1 pl-2.5 pr-1.5 shadow-lg top-1.5 ${posClass} ${dragClass}`}
            >
              <span
                className="flex select-none items-center gap-1.5"
                title={
                  version
                    ? `DeepSeek Harness v${version} · http://127.0.0.1:${port}`
                    : `http://127.0.0.1:${port}`
                }
              >
                <span className="size-1.5 animate-pulse rounded-full bg-green-500" />
                <span className="max-w-0 overflow-hidden text-[11px] whitespace-nowrap text-muted-foreground opacity-0 transition-all duration-200 ease-in-out group-hover:max-w-40 group-hover:opacity-100">
                  http://127.0.0.1:{port}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="js-nodrag h-6 rounded-full px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setPluginsOpen(true)}
                title="管理插件"
              >
                <Puzzle className="size-3" />
              </Button>
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
                <Power className="size-3" />
              </Button>
            </div>
          )}
        </div>

        <DshPluginDialog
          open={pluginsOpen}
          onClose={() => setPluginsOpen(false)}
          running={running}
        />
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
                请重新安装完整的 ZDNotes 安装包（开发环境可运行 <code>npm run build:dsh</code>）
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
          onClick={() => setPluginsOpen(true)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          title="管理 DSH 插件（安装 / 卸载）"
        >
          <Puzzle className="size-3" />
          管理插件
        </button>
      </div>
      <DshPluginDialog open={pluginsOpen} onClose={() => setPluginsOpen(false)} running={running} />
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
