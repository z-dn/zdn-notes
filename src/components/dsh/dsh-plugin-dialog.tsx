import { useEffect, useRef, useState } from 'react'
import { X, Package, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/toast'
import { showConfirm } from '@/components/confirm-dialog'

// ===================================================================
// DshPluginDialog —— DSH 插件管理对话框。
// 列表来自 profile package.json 依赖（主进程 dsh:listPlugins）；
// 安装/卸载经自带 pnpm 转发执行，pnpm 输出经 dsh:pluginLog 流式回显。
// 安装/卸载均先弹「安装插件 = 运行任意代码」确认（与 agent-tools 同款警告）。
// ===================================================================

interface DshPluginInfo {
  name: string
  version: string
  active?: boolean // false = 未进 bundles 加载层（安装中断），重启应用自动修复
}

interface DshPluginDialogProps {
  open: boolean
  onClose: () => void
  /** DSH 是否运行中：运行中装卸后需重启子进程生效，完成后提供一键重启 */
  running?: boolean
}

const LOG_MAX_LINES = 200

export function DshPluginDialog({ open, onClose, running }: DshPluginDialogProps) {
  const [plugins, setPlugins] = useState<DshPluginInfo[]>([])
  const [notReadyReason, setNotReadyReason] = useState('')
  const [loadError, setLoadError] = useState('')
  const [spec, setSpec] = useState('')
  const [busyName, setBusyName] = useState('') // '' | 'add' | 正在操作的插件名
  const [logs, setLogs] = useState<string[]>([])
  const [showRestart, setShowRestart] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  async function refresh() {
    const r = await window.electronAPI.dshListPlugins()
    if (r.ok) {
      setPlugins(r.plugins ?? [])
      setLoadError('')
      if (!r.plugins?.length) setNotReadyReason('')
    } else {
      // profile 尚未初始化时主进程返回 ok:true + 空数组；其余为运行时缺失或读取失败
      setNotReadyReason(r.error?.includes('未找到') ? r.error : '')
      setLoadError(r.error && !r.error.includes('未找到') ? r.error : '')
    }
  }

  useEffect(() => {
    if (!open) return
    setLogs([])
    setShowRestart(false)
    refresh()
    const unsubLog = window.electronAPI.onDshPluginLog((chunk: string) => {
      setLogs((prev) => [...prev, ...chunk.split('\n').filter(Boolean)].slice(-LOG_MAX_LINES))
    })
    const unsubDone = window.electronAPI.onDshPluginDone(
      (r: { action: string; name: string; ok: boolean; error?: string }) => {
        setBusyName('')
        if (r.ok) {
          toast(`${r.action === 'add' ? '安装' : '卸载'}成功：${r.name}`)
          refresh()
          if (running) setShowRestart(true)
        }
        // 失败信息已在日志区展示，不重复 toast
      },
    )
    return () => {
      unsubLog()
      unsubDone()
    }
  }, [open, running])

  async function handleRestart() {
    setRestarting(true)
    try {
      await window.electronAPI.dshStop()
      const r = await window.electronAPI.dshStart()
      if (r.ok) toast(`DSH 已重启：http://127.0.0.1:${r.port}`)
      else toast(`重启失败: ${r.error ?? '未知错误'}`)
    } finally {
      setRestarting(false)
      setShowRestart(false)
    }
  }

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [logs])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  async function handleInstall() {
    const target = spec.trim()
    if (!target || busyName) return
    const ok = await showConfirm(
      '安装 DSH 插件',
      `安装插件 = 运行任意代码（与应用同权限），插件可读写你的文件、执行程序。仅安装你信任来源的插件：${target}`,
    )
    if (!ok) return
    setBusyName('add')
    const r = await window.electronAPI.dshAddPlugin(target)
    if (!r.ok) {
      setBusyName('')
      toast(`安装失败: ${r.error ?? '未知错误'}`)
    }
  }

  async function handleRemove(name: string) {
    if (busyName) return
    const ok = await showConfirm('卸载 DSH 插件', `确定卸载 ${name} 吗？重启 DSH 后生效。`)
    if (!ok) return
    setBusyName(name)
    const r = await window.electronAPI.dshRemovePlugin(name)
    if (!r.ok) {
      setBusyName('')
      toast(`卸载失败: ${r.error ?? '未知错误'}`)
    }
  }

  const runtimeMissing = !!notReadyReason

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={() => !busyName && onClose()} />
      <div
        className="animate-fade-slide-up fixed left-1/2 top-1/2 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-divider px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <Package className="size-4" />
            DSH 插件管理
          </h2>
          <button
            onClick={onClose}
            disabled={!!busyName}
            className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            title="关闭"
          >
            <X className="size-4" />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {runtimeMissing ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              DSH 运行时不可用：{notReadyReason}
              <br />请先运行 <code>npm run build:dsh</code>。
            </p>
          ) : (
            <>
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                安装插件 = 运行任意代码（与应用同权限）。仅安装你信任来源的插件。
              </p>

              {running && (
                <p className="rounded-md bg-panel-header px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  DSH 运行中：变更将在重启 DSH 后生效，操作完成后可一键重启。
                </p>
              )}

              <div className="flex gap-2">
                <Input
                  value={spec}
                  onChange={(e) => setSpec(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleInstall()}
                  placeholder="npm 包名 或 github:作者/仓库"
                  className="h-8 text-[11px]"
                  disabled={!!busyName}
                />
                <Button size="sm" onClick={handleInstall} disabled={!spec.trim() || !!busyName}>
                  {busyName === 'add' ? '安装中…' : '安装'}
                </Button>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                如 dsh-better-sidebar（npm）、github:owner/repo（GitHub）、
                github:owner/repo#path:/packages/sub（GitHub 子包）。
                官方 @deepseek-ai 插件建议固定版本号，如 @scope/name@0.1.0。
              </p>

              <div className="space-y-1">
                {loadError && (
                  <p className="text-[11px] text-destructive">列表读取失败：{loadError}</p>
                )}
                {!loadError && plugins.length === 0 && (
                  <p className="py-2 text-center text-[11px] text-muted-foreground">
                    暂无已安装插件
                  </p>
                )}
                {plugins.map((p) => (
                  <div
                    key={p.name}
                    className="flex items-center justify-between rounded-md border border-divider px-2.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-xs">{p.name}</span>
                      {p.version && (
                        <Badge variant="outline" className="shrink-0 text-[11px]">
                          {p.version}
                        </Badge>
                      )}
                      {p.active === false && (
                        <Badge
                          variant="outline"
                          className="shrink-0 border-amber-500/40 text-[11px] text-amber-600 dark:text-amber-400"
                          title="未进入加载层（上次安装中断）。重启应用后自动修复。"
                        >
                          未生效
                        </Badge>
                      )}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[11px] text-muted-foreground hover:text-destructive"
                      onClick={() => handleRemove(p.name)}
                      disabled={!!busyName}
                    >
                      {busyName === p.name ? '卸载中…' : '卸载'}
                    </Button>
                  </div>
                ))}
              </div>

              {logs.length > 0 && (
                <pre
                  ref={logRef}
                  className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-panel-header p-2 font-mono text-[10px] leading-relaxed text-muted-foreground"
                >
                  {logs.join('\n')}
                </pre>
              )}

              {showRestart && running && (
                <Button
                  size="sm"
                  onClick={handleRestart}
                  disabled={restarting || !!busyName}
                  className="self-center"
                >
                  {restarting ? (
                    <>
                      <LoaderSpinner />
                      重启中…
                    </>
                  ) : (
                    '重启 DSH 生效'
                  )}
                </Button>
              )}
            </>
          )}
        </div>
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
