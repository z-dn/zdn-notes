import { createElement, useEffect, useRef, useState } from 'react'
import { Play, Square, PanelLeftClose, PanelLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/toast'

// ===================================================================
// DshPage —— DSH 主区域（占满整屏）：<webview> 渲染官方 Web UI，
// 左上角叠一条可折叠的悬浮控制条。API Key/模型在 DSH 内配。
// 收起时只露一个小图标，完全不挡 webview。
// ===================================================================

export function DshPage() {
  const webviewRef = useRef<HTMLElement | null>(null)
  const [port, setPort] = useState<number | null>(null)
  const [running, setRunning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [barOpen, setBarOpen] = useState(true)

  useEffect(() => {
    let cancelled = false
    const timer = setInterval(async () => {
      if (cancelled) return
      const s = (await window.electronAPI.dshGetStatus()) as { running: boolean; port?: number }
      setRunning(s.running)
      setPort(s.running ? s.port ?? null : null)
    }, 500)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  async function handleStart() {
    setBusy(true)
    const res = (await window.electronAPI.dshStart()) as { ok: boolean; port?: number; error?: string }
    setBusy(false)
    if (!res.ok) toast(`启动失败: ${res.error ?? '未知错误'}`)
  }

  async function handleStop() {
    await window.electronAPI.dshStop()
  }

  return (
    <div className="relative h-full w-full bg-panel">
      {running && port ? (
        createElement('webview', {
          key: port,
          ref: webviewRef,
          src: `http://127.0.0.1:${port}`,
          className: 'h-full w-full',
          style: { width: '100%', height: '100%' },
          allowpopups: 'false',
        })
      ) : (
        <div className="flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground">
          {busy
            ? '正在启动 DeepSeek Harness Web UI…'
            : barOpen
              ? '点击「启动」加载 DeepSeek Harness Web UI。'
              : '点击左侧图标展开控制条启动。'}
        </div>
      )}

      {barOpen ? (
        <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-md border border-divider bg-panel px-3 py-2 shadow-lg">
          {running ? (
            <Button size="sm" variant="destructive" onClick={handleStop}>
              <Square className="size-3.5" />
              关闭
            </Button>
          ) : (
            <Button size="sm" onClick={handleStart} disabled={busy}>
              <Play className="size-3.5" />
              启动
            </Button>
          )}
          {running && port && (
            <span className="select-none text-[11px] text-muted-foreground">
              http://127.0.0.1:{port}
            </span>
          )}
          <Button size="sm" variant="ghost" className="ml-1" onClick={() => setBarOpen(false)} title="收起">
            <PanelLeftClose className="size-3.5" />
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setBarOpen(true)}
          title="展开 DSH 控制"
          className="absolute left-3 top-3 z-20 flex size-8 items-center justify-center rounded-md border border-divider bg-panel shadow-lg transition-colors hover:bg-accent"
        >
          <PanelLeft className="size-3.5 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}
