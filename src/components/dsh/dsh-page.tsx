import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Bot, ChevronLeft, Power, Puzzle, RotateCcw } from 'lucide-react'
import { toast } from '@/lib/toast'
import { useDshUiStore } from '@/stores/dsh-ui-store'
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
//     带 .js-nodrag 的按钮（插件/重启/关闭/收起）不进入拖拽流程
//   - 持久化：{x, y, collapsed} 存 localStorage（渲染层本地 UI 偏好），
//     恢复时按容器边界 clamp 校验
//   - 开/关动画：单元素常驻，容器 width 过渡（token 化 duration/ease）向右
//     扫掠延展/向左收拢；按钮行 w-max 恒定尺寸靠 overflow 裁剪渐露，
//     光点格 18px 恒定（大小/位置两态不变）；收起钮在最右（ChevronLeft）
//   - 重启：stop→start 序列，期间 restarting 保持胶囊挂载（黄点 + 重启占位）
//   - 光点三态：绿=运行就绪 / 黄=启动中·重启中 / 红=未运行（预留，停止后胶囊不渲染）
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
/** 默认（未拖动过）贴右下角的边距，等价于原 bottom-3 right-3 */
const DEFAULT_MARGIN_PX = 12
/** 收起态容器边长（h-5/w-5 含边框，与历史形态一致） */
const PILL_COLLAPSED_PX = 20

/** 胶囊光点三态：stopped（红，预留——胶囊停止后不渲染）/ starting（黄）/ running（绿） */
type DotPhase = 'stopped' | 'starting' | 'running'

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
  const [restarting, setRestarting] = useState(false)
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

  async function handleRestart() {
    if (restarting) return
    setRestarting(true)
    try {
      await window.electronAPI.dshStop()
      const res = await window.electronAPI.dshStart()
      if (res.ok) toast('DSH 已重启')
      else toast(`重启失败: ${res.error ?? '未知错误'}`)
    } finally {
      setRestarting(false)
    }
  }

  // ---- 胶囊：拖拽 + 收缩 + 持久化 ----

  const containerRef = useRef<HTMLDivElement>(null)
  const pillRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [pill, setPill] = useState<PillState>(loadPillState)
  /** 展开态容器总宽（含边框）；null = 尚未测量（首帧用 auto，数值等价无过渡） */
  const [pillW, setPillW] = useState<number | null>(null)
  const [dragging, setDragging] = useState(false)
  const dragRef = useRef<{
    startX: number
    startY: number
    baseX: number
    baseY: number
    moved: boolean
  } | null>(null)

  /** @param w/h 目标尺寸覆盖（展开瞬间 offsetWidth 仍是过渡初值，需按目标宽度校正） */
  function clampToContainer(x: number, y: number, w?: number, h?: number): PillPos {
    const c = containerRef.current
    const el = pillRef.current
    if (!c || !el) return { x, y }
    const ew = w ?? el.offsetWidth
    const eh = h ?? el.offsetHeight
    const maxX = Math.max(PILL_MARGIN_PX, c.clientWidth - ew - PILL_MARGIN_PX)
    const maxY = Math.max(PILL_MARGIN_PX, c.clientHeight - eh - PILL_MARGIN_PX)
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

  // 测量展开态总宽（inner 为 w-max，收起态被裁剪仍报自然宽度）；
  // 顺带把「从未拖动过」的默认右下角物化为 left/top——右锚定会让开/关
  // 动画朝左生长，物化后左边缘固定、向右延展恰好贴合右下角。
  useLayoutEffect(() => {
    const inner = innerRef.current
    if (inner) {
      const w = Math.ceil(inner.getBoundingClientRect().width) + 2 // + 双侧 1px 边框
      setPillW((prev) => (prev === w ? prev : w))
    }
    if (pill.pos || !containerRef.current) return
    const c = containerRef.current.getBoundingClientRect()
    if (c.width <= 0 || c.height <= 0) return // 隐藏态（tab 未激活）不物化
    const expandedW =
      (inner ? Math.ceil(inner.getBoundingClientRect().width) + 2 : 0) || PILL_COLLAPSED_PX
    const el = pillRef.current
    const h = el ? el.offsetHeight || PILL_COLLAPSED_PX : PILL_COLLAPSED_PX
    setPill((p) => ({
      ...p,
      pos: {
        x: Math.max(PILL_MARGIN_PX, c.width - expandedW - DEFAULT_MARGIN_PX),
        y: Math.max(PILL_MARGIN_PX, c.height - h - DEFAULT_MARGIN_PX),
      },
    }))
  }, [pill.pos])

  // 展开/收起瞬间按「目标宽度」校正边界（过渡中的 offsetWidth 不可用）：
  // 默认/拖动后的位置若放不下完整胶囊，展开前先左移，避免溢出容器。
  useLayoutEffect(() => {
    if (!pill.pos || pillW === null) return
    const targetW = pill.collapsed ? PILL_COLLAPSED_PX : pillW
    const clamped = clampToContainer(pill.pos.x, pill.pos.y, targetW)
    if (clamped.x !== pill.pos.x || clamped.y !== pill.pos.y) {
      setPill((p) => ({ ...p, pos: clamped }))
    }
  }, [pill.collapsed, pillW])

  if ((running && port) || restarting) {
    const posStyle = pill.pos ? { left: pill.pos.x, top: pill.pos.y } : undefined
    const posClass = pill.pos ? '' : 'bottom-3 right-3'
    const dragClass = dragging ? 'cursor-grabbing select-none' : 'cursor-grab'
    // 光点三态：重启中优先判黄；stopped（红）仅代码预留——此状态胶囊不渲染
    const phase: DotPhase = restarting
      ? 'starting'
      : !running
        ? 'stopped'
        : webUrl
          ? 'running'
          : 'starting'
    const dotColor =
      phase === 'running' ? 'bg-green-500' : phase === 'starting' ? 'bg-yellow-500' : 'bg-red-500'
    const pulseClass = phase === 'stopped' ? '' : 'animate-pulse'
    const hoverTitle =
      phase === 'running'
        ? `DSH 运行中 · 127.0.0.1:${port}${version ? ` · v${version}` : ''}`
        : phase === 'starting'
          ? restarting
            ? 'DSH 重启中…'
            : `DSH 启动中${port ? ` · 127.0.0.1:${port}` : ''}`
          : 'DSH 未运行'
    const tooltipText = pill.collapsed ? `${hoverTitle} · 点击展开` : hoverTitle

    return (
      <div ref={containerRef} className="relative h-full w-full bg-panel">
        {/* 内容由 App 层 DshWebviewLayer 承载；webUrl 未到（token 竞态窗口/重启窗口）时显示占位 */}
        {!webUrl && (
          <div className="flex h-full w-full items-center justify-center gap-2 text-[11px] text-muted-foreground">
            <LoaderSpinner />
            <span>{restarting ? '正在重启 DSH…' : '正在启动 DSH…'}</span>
          </div>
        )}

        {/* 单元素常驻胶囊：容器 width 过渡（token 化）向右扫掠延展/向左收拢；
            内层 w-max 恒定尺寸，靠容器 overflow 裁剪渐露，光点格两态零变化 */}
        <div
          ref={pillRef}
          style={{
            ...(posStyle ?? {}),
            width: pill.collapsed ? PILL_COLLAPSED_PX : (pillW ?? undefined),
          }}
          role={pill.collapsed ? 'button' : undefined}
          tabIndex={pill.collapsed ? 0 : undefined}
          onKeyDown={
            pill.collapsed
              ? (e) => {
                  if (e.key === 'Enter' || e.key === ' ')
                    setPill((p) => ({ ...p, collapsed: false }))
                }
              : undefined
          }
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`absolute z-20 flex h-5 touch-none items-center overflow-hidden rounded-full border border-divider bg-panel shadow-lg transition-[width,background-color] duration-200 ease-out ${posClass} ${dragClass} ${
            pill.collapsed
              ? 'hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring'
              : ''
          }`}
        >
          <div ref={innerRef} className="flex w-max shrink-0 items-center gap-2 pl-[5px] pr-1.5">
            <Tip tip={tooltipText}>
              <span className={`size-2 rounded-full ${dotColor} ${pulseClass}`} />
            </Tip>
            <div
              inert={pill.collapsed}
              className={`flex items-center gap-2 transition-opacity duration-200 ease-out ${
                pill.collapsed ? 'opacity-0' : 'opacity-100'
              }`}
            >
              <button
                onClick={() => setPluginDialogOpen(true)}
                aria-label="管理插件"
                className="js-nodrag flex h-5 items-center rounded-full px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Tip tip="管理插件" side="bottom">
                  <Puzzle className="size-3" />
                </Tip>
              </button>
              <button
                onClick={handleRestart}
                disabled={restarting}
                aria-label="重启 DSH"
                className="js-nodrag flex h-5 items-center rounded-full px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Tip tip="重启 DSH" side="bottom">
                  <RotateCcw className={`size-3 ${restarting ? 'animate-spin' : ''}`} />
                </Tip>
              </button>
              <button
                onClick={async () => {
                  await window.electronAPI.dshStop()
                }}
                disabled={restarting}
                aria-label="关闭 DSH"
                className="js-nodrag flex h-5 items-center rounded-full px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-destructive focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Tip tip="关闭 DSH" side="bottom">
                  <Power className="size-3" />
                </Tip>
              </button>
              <button
                onClick={() => setPill((p) => ({ ...p, collapsed: true }))}
                aria-label="收起为小圆点"
                className="js-nodrag flex h-5 items-center rounded-full px-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                <Tip tip="收起为小圆点" side="bottom">
                  <ChevronLeft className="size-3" />
                </Tip>
              </button>
            </div>
          </div>
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
