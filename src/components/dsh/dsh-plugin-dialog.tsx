import { useEffect, useRef, useState } from 'react'
import { X, Package, TriangleAlert, ArrowUpCircle, ShieldCheck, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/lib/toast'
import { showConfirm } from '@/components/confirm-dialog'
import { Tip } from '@/components/tip-button'

// ===================================================================
// DshManageDialog —— DSH 统一管理对话框（运行时升级 + 插件 + 兼容性检测）。
//   运行时：查询 npm dist-tags，手动指定版本/ dist-tag 升级到用户覆盖层
//           <userData>/dsh-runtime（应用更新不覆盖），支持回退内置版本；
//           升级前对该版本做插件失效预演并二次确认，进度经 dsh:upgradeLog 流式回显。
//   插件：profile package.json 依赖列表；装卸经自带 pnpm 转发（dsh:pluginLog）。
//   兼容性：dsh:checkPluginCompatibility 对当前运行时体检，列表逐项徽标 + 原因。
// 所有危险操作（安装/卸载/升级/回退）均先弹确认。
// ===================================================================

interface DshPluginInfo {
  name: string
  version: string
  active?: boolean // false = 未进 bundles 加载层（安装中断），重启应用自动修复
}

interface QuarantineRecord {
  entryId: string
  name?: string
  reason: string
  at: number
}

interface RuntimeVersionInfo {
  version: string
  publishedAt: number | null
  addonRange: string | null
  deprecated: string | null
  tags: string[]
  hostAddonCompatible: boolean | null
}

interface RuntimeInfo {
  current: string | null
  hasUserOverride: boolean
  meta: { version: string; source: 'user'; at: number; vendorPatchApplied: boolean } | null
  distTags?: Record<string, string> | null
  latest?: string | null
  recommended?: string | null
  versions?: RuntimeVersionInfo[]
  pinned?: string | null
  ignored?: string[]
  previous?: { version: string; at: number } | null
  host?: { electron: string | null; node: string; appBootPatchRequired: boolean }
}

interface RuntimeNotes {
  ok: boolean
  version: string
  title: string
  body: string
  url: string
  source: 'github' | 'npm' | 'error'
  publishedAt?: number | null
  error?: string
}

type RuntimeChannel = 'all' | 'latest' | 'next' | 'alpha'

interface CompatEntry {
  status: 'ok' | 'incompatible' | 'inactive'
  issues: string[]
}

interface IntegrityEntry {
  name: string
  ok: boolean
  reason?: string
}

interface PreflightResult {
  ok: boolean
  from: string | null
  to: string
  crossMinor: boolean
  declaredIssues: Array<{
    package: string
    version: string
    root: string
    parent: string | null
    errors: string[]
    warnings: string[]
    children?: string[]
  }>
  probeOk: boolean
  probeError?: string
  probeFailures: Array<{ entryId?: string; name?: string; package?: string; reason: string }>
  recommendations: Array<{
    package: string
    current: string | null
    recommended: string | null
    kind: 'direct' | 'transitive'
    children?: string[]
    verified?: boolean
    note?: string
  }>
  integrity: IntegrityEntry[]
  error?: string
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
  const [quarantined, setQuarantined] = useState<QuarantineRecord[]>([])
  const [notReadyReason, setNotReadyReason] = useState('')
  const [loadError, setLoadError] = useState('')
  const [spec, setSpec] = useState('')
  const [busyName, setBusyName] = useState('') // '' | 'add' | 正在操作的插件名
  const [logs, setLogs] = useState<string[]>([])
  const [showRestart, setShowRestart] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  // ---- 运行时升级状态 ----
  const [runtime, setRuntime] = useState<RuntimeInfo | null>(null)
  const [targetVersion, setTargetVersion] = useState('')
  const [channel, setChannel] = useState<RuntimeChannel>('all')
  const [notes, setNotes] = useState<RuntimeNotes | null>(null)
  const [notesLoading, setNotesLoading] = useState(false)
  const [checking, setChecking] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [preflighting, setPreflighting] = useState(false)
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [reverting, setReverting] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [pinning, setPinning] = useState(false)
  const [backupBusy, setBackupBusy] = useState(false)
  const [updateLogs, setUpdateLogs] = useState<string[]>([])
  const updateLogRef = useRef<HTMLPreElement>(null)

  // ---- 兼容性体检 ----
  const [compat, setCompat] = useState<Record<string, CompatEntry>>({})
  const [integrity, setIntegrity] = useState<IntegrityEntry[]>([])
  const [compatBusy, setCompatBusy] = useState(false)
  const [repairing, setRepairing] = useState(false)

  async function refresh() {
    const r = await window.electronAPI.dshListPlugins()
    if (r.ok) {
      setPlugins(r.plugins ?? [])
      setQuarantined(r.quarantined ?? [])
      setLoadError('')
      if (!r.plugins?.length) setNotReadyReason('')
    } else {
      // profile 尚未初始化时主进程返回 ok:true + 空数组；其余为运行时缺失或读取失败
      setNotReadyReason(r.error?.includes('未找到') ? r.error : '')
      setLoadError(r.error && !r.error.includes('未找到') ? r.error : '')
    }
  }

  async function loadRuntime() {
    const info = await window.electronAPI.dshCheckRuntimeUpdate()
    setRuntime(info)
    setTargetVersion((prev) => prev || info.recommended || info.latest || info.current || '')
  }

  useEffect(() => {
    setPreflight(null)
  }, [targetVersion])

  useEffect(() => {
    if (!open || !targetVersion.trim()) {
      setNotes(null)
      return
    }
    let cancelled = false
    setNotes(null)
    setNotesLoading(true)
    const timer = setTimeout(async () => {
      try {
        const r = await window.electronAPI.dshGetRuntimeNotes(targetVersion.trim())
        if (!cancelled) setNotes(r)
      } catch {
        if (!cancelled) setNotes(null)
      } finally {
        if (!cancelled) setNotesLoading(false)
      }
    }, 250)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [open, targetVersion])

  useEffect(() => {
    if (!open) return
    setLogs([])
    setUpdateLogs([])
    setCompat({})
    setIntegrity([])
    setPreflight(null)
    setShowRestart(false)
    refresh()
    loadRuntime()
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
    const unsubUpLog = window.electronAPI.onDshUpgradeLog((chunk: string) => {
      setUpdateLogs((prev) => [...prev, ...chunk.split('\n').filter(Boolean)].slice(-LOG_MAX_LINES))
    })
    const unsubUpDone = window.electronAPI.onDshUpgradeDone(() => {
      setUpdating(false)
      loadRuntime()
    })
    return () => {
      unsubLog()
      unsubDone()
      unsubUpLog()
      unsubUpDone()
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
    if (updateLogRef.current) updateLogRef.current.scrollTop = updateLogRef.current.scrollHeight
  }, [updateLogs])

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  const runtimeMissing = !!notReadyReason

  async function handleCheckUpdate() {
    if (checking) return
    setChecking(true)
    try {
      const info = await window.electronAPI.dshCheckRuntimeUpdate()
      setRuntime(info)
      const target = info.recommended ?? info.latest
      if (target && target !== info.current) {
        toast(`可升级至 ${target}`)
        setTargetVersion(target)
      } else if (target) {
        toast('已是最新版本')
      } else {
        toast('无法获取版本信息（网络不可达）')
      }
    } finally {
      setChecking(false)
    }
  }

  async function runPreflight(): Promise<PreflightResult | null> {
    const target = targetVersion.trim()
    if (!target || preflighting || updating) return null
    setPreflighting(true)
    setUpdateLogs([])
    setPreflight(null)
    try {
      const r = await window.electronAPI.dshPreflightUpgrade(target)
      setPreflight(r)
      if (r.error) toast(`预演失败: ${r.error}`)
      else if (r.ok) toast(r.crossMinor ? '预演通过：跨 minor 升级可继续' : '预演通过')
      else toast('预演未通过：请先按推荐升级插件')
      return r
    } finally {
      setPreflighting(false)
    }
  }

  async function handleUpgrade() {
    const target = targetVersion.trim()
    if (!target || updating) return
    const r = await runPreflight()
    if (!r || !r.ok) return
    const ok = await showConfirm(
      '升级 DSH 运行时',
      `预演通过（${r.from ?? '未知'} → ${r.to}${r.crossMinor ? '，跨 minor' : ''}）。\n升级期间 DSH 会重启；跨版本可能迁移 Session 格式，建议先备份 DSH 数据。继续？`,
    )
    if (!ok) return
    setUpdating(true)
    try {
      const up = await window.electronAPI.dshUpgradeRuntime(target)
      if (up.ok) {
        toast(`DSH 已升级到 ${up.to}`)
        setTargetVersion(up.to)
        setPreflight(null)
      } else {
        toast(`升级失败: ${up.error ?? '未知错误'}`)
      }
      await loadRuntime()
    } finally {
      setUpdating(false)
    }
  }

  async function handleRevert() {
    if (reverting || updating) return
    const ok = await showConfirm(
      '回退 DSH 运行时',
      '将删除自定义运行时，回到随安装包内置的 DSH 版本。\n注意：新版本可能已迁移 Session 格式，旧版本不一定能读取；建议先备份 DSH 数据。确定？',
    )
    if (!ok) return
    setReverting(true)
    try {
      const r = await window.electronAPI.dshRevertRuntime()
      if (r.ok) {
        toast('已回退到内置版本')
        await loadRuntime()
      } else {
        toast(`回退失败: ${r.error ?? '未知错误'}`)
      }
    } finally {
      setReverting(false)
    }
  }

  async function handleRestorePrevious() {
    if (restoring || updating) return
    const previous = runtime?.previous?.version
    if (!previous) return
    const ok = await showConfirm(
      '回退 DSH 运行时',
      `切回上一版本 ${previous}？当前版本会保留，可再次切回。升级期间 DSH 会重启。\n注意：新版本可能已迁移 Session 格式，旧版本不一定能读取；建议先备份 DSH 数据。`,
    )
    if (!ok) return
    setRestoring(true)
    try {
      const r = await window.electronAPI.dshRestorePreviousRuntime()
      if (r.ok) {
        toast(`已回退到 ${r.version ?? previous}`)
        setPreflight(null)
        await loadRuntime()
      } else {
        toast(`回退失败: ${r.error ?? '未知错误'}`)
      }
    } finally {
      setRestoring(false)
    }
  }

  async function handlePin() {
    if (pinning || !runtime?.current) return
    const pin = runtime.pinned === runtime.current ? null : runtime.current
    setPinning(true)
    try {
      const r = await window.electronAPI.dshSetRuntimePin(pin)
      if (!r.ok) {
        toast(`设置失败: ${r.error ?? '未知错误'}`)
        return
      }
      toast(pin ? `已锁定 ${pin}，不再推荐新版本` : '已取消版本锁定')
      await loadRuntime()
    } finally {
      setPinning(false)
    }
  }

  async function handleIgnore() {
    const target = targetVersion.trim()
    if (!target || updating || preflighting || restoring || pinning) return
    const ignored = !(runtime?.ignored ?? []).includes(target)
    const r = await window.electronAPI.dshSetRuntimeIgnored(target, ignored)
    if (!r.ok) {
      toast(`操作失败: ${r.error ?? '未知错误'}`)
      return
    }
    toast(ignored ? `已忽略 ${target}` : `已恢复 ${target}`)
    const info = await window.electronAPI.dshCheckRuntimeUpdate()
    setRuntime(info)
    setTargetVersion(info.recommended || info.latest || info.current || '')
  }

  async function handleBackup() {
    if (backupBusy) return
    setBackupBusy(true)
    try {
      const r = await window.electronAPI.dshBackupHome()
      if (r.ok) toast(`DSH 数据已备份：${r.path ?? ''}`)
      else toast(`备份失败: ${r.error ?? '未知错误'}`)
    } finally {
      setBackupBusy(false)
    }
  }

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

  async function handleRestore(entryId: string) {
    if (busyName) return
    const r = await window.electronAPI.dshRestoreQuarantine(entryId)
    if (r.ok) {
      toast(`已恢复 ${entryId}，重启 DSH 后生效`)
      refresh()
      if (running) setShowRestart(true)
    } else {
      toast(`恢复失败: ${r.error ?? '未知错误'}`)
    }
  }

  async function handleCheckCompat() {
    if (compatBusy) return
    setCompatBusy(true)
    try {
      const r = await window.electronAPI.dshCheckPluginCompatibility()
      if (!r.ok) {
        toast(`检测失败: ${r.error ?? '未知错误'}`)
        return
      }
      const map: Record<string, CompatEntry> = {}
      for (const p of r.plugins ?? []) map[p.name] = { status: p.status, issues: p.issues }
      setCompat(map)
      const integ = r.integrity ?? []
      setIntegrity(integ)
      const bad = (r.plugins ?? []).filter((p) => p.status === 'incompatible').length
      const broken = integ.filter((e) => !e.ok).length
      if (broken > 0) toast(`${broken} 个插件安装不完整（运行时将无法加载）`)
      else if (bad > 0) toast(`${bad} 个插件存在兼容性问题`)
      else toast('全部插件兼容且安装完整')
    } finally {
      setCompatBusy(false)
    }
  }

  async function handleRepair() {
    if (repairing || busyName) return
    const ok = await showConfirm(
      '重装插件依赖',
      '将删除并重新安装 profile 依赖（约 1-2 分钟，需联网）。插件与配置保留。确定？',
    )
    if (!ok) return
    setRepairing(true)
    setUpdateLogs([])
    try {
      const r = await window.electronAPI.dshRepairProfile()
      if (r.ok) {
        toast('插件依赖已重装，可重启 DSH')
        await refresh()
        setIntegrity([])
      } else {
        toast(`重装失败: ${r.error ?? '未知错误'}`)
      }
    } finally {
      setRepairing(false)
    }
  }

  const runtimeBusy =
    updating || reverting || repairing || preflighting || restoring || pinning || backupBusy
  const upgradeTarget = runtime?.recommended ?? runtime?.latest ?? null
  const hasUpdate = !!(upgradeTarget && upgradeTarget !== runtime?.current)
  const crossMinorLatest = !!(
    runtime?.latest &&
    runtime.recommended &&
    runtime.latest !== runtime.recommended
  )
  const allVersions = runtime?.versions ?? []
  const selectedVersion = allVersions.find((v) => v.version === targetVersion.trim())
  const ignored = runtime?.ignored ?? []
  const targetIgnored = ignored.includes(targetVersion.trim())
  const channelVersions =
    channel === 'all' ? allVersions : allVersions.filter((v) => v.tags.includes(channel))
  const versionOptions = channelVersions.slice(0, 60).map((v) => ({
    value: v.version,
    label: `${v.version}${v.tags.length ? ` · ${v.tags.join('/')}` : ''}${
      v.version === runtime?.current ? ' · 当前' : ''
    }${v.deprecated ? ' · 已废弃' : ''}`,
  }))
  for (const fallback of [runtime?.current, targetVersion.trim()]) {
    if (fallback && !versionOptions.some((o) => o.value === fallback)) {
      versionOptions.unshift({
        value: fallback,
        label: `${fallback}${fallback === runtime?.current ? ' · 当前' : ''}`,
      })
    }
  }
  function selectChannel(next: RuntimeChannel) {
    setChannel(next)
    if (next === 'all') return
    const version = runtime?.distTags?.[next]
    if (version) setTargetVersion(version)
    else toast(`暂无 ${next} 通道版本`)
  }

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => !busyName && !runtimeBusy && onClose()}
      />
      <div
        className="animate-fade-slide-up fixed left-1/2 top-1/2 flex max-h-[85vh] w-full max-w-lg -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-divider px-4 py-3">
          <h2 className="flex items-center gap-1.5 text-sm font-medium">
            <Package className="size-4" />
            DSH 管理
          </h2>
          <Tip tip="关闭">
            <button
              onClick={onClose}
              disabled={!!busyName || runtimeBusy}
              className="flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              <X className="size-4" />
            </button>
          </Tip>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
          {runtimeMissing ? (
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              DSH 运行时不可用：{notReadyReason}
              <br />
              请重新安装完整的 ZDNotes 安装包（开发环境可运行 <code>npm run build:dsh</code>）。
            </p>
          ) : (
            <>
              {/* ---- 运行时版本 ---- */}
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">运行时版本</p>
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      当前 {runtime?.current ?? '未知'}
                      {runtime ? `（${runtime.hasUserOverride ? '自定义' : '内置'}）` : ''}
                      {runtime?.meta ? ` · ${new Date(runtime.meta.at).toLocaleDateString()}` : ''}
                      {runtime?.previous ? ` · 上一版本 ${runtime.previous.version}` : ''}
                    </p>
                    {runtime?.host && (
                      <p className="text-[11px] leading-relaxed text-muted-foreground/70">
                        宿主 Electron {runtime.host.electron ?? '未知'} · Node {runtime.host.node}
                        {runtime.host.appBootPatchRequired ? ' · 使用 app-boot 兼容补丁' : ''}
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 shrink-0 px-2 text-[11px]"
                    onClick={handleCheckUpdate}
                    disabled={checking || runtimeBusy}
                  >
                    {checking ? '检查中…' : '检查更新'}
                  </Button>
                </div>
                {hasUpdate && (
                  <p className="text-[11px] text-muted-foreground">
                    推荐 <span className="text-foreground">{upgradeTarget}</span>
                    {crossMinorLatest && (
                      <span className="text-muted-foreground/60">
                        （最新 {runtime?.latest} 跨 minor，升级前会先预演兼容性）
                      </span>
                    )}
                    {runtime?.pinned && (
                      <span className="text-muted-foreground/60"> · 已锁定 {runtime.pinned}</span>
                    )}
                  </p>
                )}
                <div className="flex flex-wrap gap-1">
                  {(
                    [
                      ['all', '全部'],
                      ['latest', '默认 latest'],
                      ['next', '预览 next'],
                      ['alpha', '实验 alpha'],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => selectChannel(key)}
                      disabled={runtimeBusy}
                      className={`h-6 rounded-full border px-2 text-[10px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50 ${
                        channel === key
                          ? 'border-foreground/30 bg-accent text-foreground'
                          : 'border-divider text-muted-foreground hover:bg-accent hover:text-foreground'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Select
                  value={targetVersion}
                  onChange={setTargetVersion}
                  options={versionOptions}
                  placeholder="选择目标版本"
                  className="w-full"
                />
                <Input
                  value={targetVersion}
                  onChange={(e) => setTargetVersion(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleUpgrade()}
                  placeholder="高级：精确版本或 dist-tag（latest / next / alpha）"
                  className="h-8 text-[11px]"
                  disabled={runtimeBusy}
                />
                {selectedVersion && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
                    <Badge variant="outline" className="text-[10px]">
                      {selectedVersion.version}
                    </Badge>
                    {selectedVersion.tags.map((tag) => (
                      <Badge key={tag} variant="secondary" className="text-[10px]">
                        {tag}
                      </Badge>
                    ))}
                    {selectedVersion.publishedAt && (
                      <span className="text-muted-foreground">
                        {new Date(selectedVersion.publishedAt).toLocaleDateString()}
                      </span>
                    )}
                    {selectedVersion.deprecated && (
                      <span className="text-destructive">已废弃：{selectedVersion.deprecated}</span>
                    )}
                    {selectedVersion.hostAddonCompatible === false ? (
                      <span className="text-amber-600 dark:text-amber-400">
                        宿主 addon 声明不匹配，需先预演确认
                      </span>
                    ) : selectedVersion.hostAddonCompatible === true ? (
                      <span className="text-green-600 dark:text-green-400">宿主 addon 兼容</span>
                    ) : null}
                  </div>
                )}
                {(notes || notesLoading) && (
                  <div className="space-y-1 rounded-md border border-divider bg-panel-header/60 px-2.5 py-2 text-[11px]">
                    {notesLoading ? (
                      <p className="text-muted-foreground">加载发布说明…</p>
                    ) : notes ? (
                      <>
                        <p className="font-medium">{notes.title}</p>
                        <p className="max-h-28 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed text-muted-foreground">
                          {notes.body}
                        </p>
                        {notes.error && <p className="text-destructive">{notes.error}</p>}
                      </>
                    ) : null}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  <Tip
                    tip="在隔离临时目录安装目标运行时，并用当前 profile 的插件依赖真实启动一次；不改动现有数据与运行时。"
                    className="max-w-80 leading-relaxed"
                  >
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void runPreflight()}
                        disabled={!targetVersion.trim() || runtimeBusy}
                        className="shrink-0"
                      >
                        {preflighting ? '预演中…' : '预演'}
                      </Button>
                    </span>
                  </Tip>
                  <Tip
                    tip="先自动预演，通过后安装到独立版本目录并重启 DSH；启动失败自动回滚，当前与上一版本均保留。"
                    className="max-w-80 leading-relaxed"
                  >
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        onClick={handleUpgrade}
                        disabled={!targetVersion.trim() || runtimeBusy || targetIgnored}
                        className="shrink-0"
                      >
                        {updating ? (
                          <>
                            <LoaderSpinner />
                            升级中…
                          </>
                        ) : preflighting ? (
                          '预演中…'
                        ) : (
                          <>
                            <ArrowUpCircle className="size-3.5" />
                            升级
                          </>
                        )}
                      </Button>
                    </span>
                  </Tip>
                  <Tip
                    tip="复制 DSH_HOME（会话、profile 清单、配置与凭据），排除 node_modules 与运行时目录；升级前建议执行。"
                    className="max-w-80 leading-relaxed"
                  >
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleBackup()}
                        disabled={runtimeBusy}
                        className="shrink-0 text-[11px]"
                      >
                        {backupBusy ? '备份中…' : '备份 DSH 数据'}
                      </Button>
                    </span>
                  </Tip>
                  {runtime?.current && (
                    <Tip
                      tip={
                        runtime.pinned === runtime.current
                          ? '解除版本锁定，恢复按所选通道自动推荐。'
                          : '锁定后检查更新只提示当前版本，不再推荐更高版本；手动指定版本仍可升级。'
                      }
                      className="max-w-80 leading-relaxed"
                    >
                      <span className="inline-flex">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handlePin()}
                          disabled={runtimeBusy}
                          className="shrink-0 text-[11px]"
                        >
                          {pinning
                            ? '设置中…'
                            : runtime.pinned === runtime.current
                              ? '取消锁定'
                              : '锁定当前版本'}
                        </Button>
                      </span>
                    </Tip>
                  )}
                  {targetVersion.trim() && targetVersion.trim() !== runtime?.current && (
                    <Tip
                      tip={
                        targetIgnored
                          ? '重新将该版本纳入推荐范围。'
                          : '将该版本排除在推荐之外，仍保留在版本列表（可手动选择）；可随时恢复。'
                      }
                      className="max-w-80 leading-relaxed"
                    >
                      <span className="inline-flex">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleIgnore()}
                          disabled={runtimeBusy}
                          className="shrink-0 text-[11px]"
                        >
                          {targetIgnored ? '恢复此版本' : '忽略此版本'}
                        </Button>
                      </span>
                    </Tip>
                  )}
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                  升级安装到独立版本目录（应用更新不会覆盖），保留当前与上一版本以便回退。每次升级都会先在临时目录用目标运行时实机加载现有插件，全部通过才切换；失败会自动回退。
                </p>
                {preflight && (
                  <div
                    className={`space-y-1.5 rounded-md border px-2.5 py-2 text-[11px] ${
                      preflight.ok
                        ? 'border-green-500/40 bg-green-500/5'
                        : 'border-destructive/40 bg-destructive/5'
                    }`}
                  >
                    <p
                      className={
                        preflight.ok
                          ? 'font-medium text-green-600 dark:text-green-400'
                          : 'font-medium text-destructive'
                      }
                    >
                      {preflight.ok
                        ? `预演通过：${preflight.to} 可加载现有插件${
                            preflight.crossMinor ? '（跨 minor）' : ''
                          }`
                        : `预演未通过（${preflight.from ?? '未知'} → ${preflight.to}）`}
                    </p>
                    {preflight.error && <p className="text-destructive">{preflight.error}</p>}
                    {!preflight.probeOk && preflight.probeError && (
                      <p className="text-destructive">实机启动：{preflight.probeError}</p>
                    )}
                    {preflight.declaredIssues.length > 0 && (
                      <div className="max-h-52 space-y-1 overflow-y-auto pr-1">
                        <p className="text-muted-foreground">声明层检查：</p>
                        {preflight.declaredIssues.map((i) => (
                          <div key={i.package} className="space-y-0.5">
                            <p
                              className={
                                i.errors.length > 0
                                  ? 'text-destructive'
                                  : 'text-amber-600 dark:text-amber-400'
                              }
                            >
                              · {i.package}
                              {i.children && i.children.length > 0
                                ? `（含 ${i.children.length} 个子插件）`
                                : ''}
                              {i.errors.length === 0 ? '：仅有警告，以实机预演为准' : ''}
                            </p>
                            {i.errors.map((e, idx) => (
                              <p key={`e${idx}`} className="pl-3 text-destructive">
                                - {e}
                              </p>
                            ))}
                            {i.warnings.map((w, idx) => (
                              <p key={`w${idx}`} className="pl-3 text-muted-foreground">
                                - {w}
                              </p>
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                    {preflight.probeFailures.length > 0 && (
                      <div className="space-y-0.5">
                        <p className="text-muted-foreground">实机加载失败：</p>
                        {preflight.probeFailures.map((f, idx) => (
                          <p
                            key={`${f.package ?? f.name ?? f.entryId ?? idx}`}
                            className="text-destructive"
                          >
                            · {f.package ?? f.name ?? f.entryId ?? '未知'}：{f.reason}
                          </p>
                        ))}
                      </div>
                    )}
                    {preflight.recommendations.length > 0 && (
                      <div className="space-y-0.5">
                        <p className="text-muted-foreground">
                          推荐升级（先按此升级插件，再重新预演）：
                        </p>
                        {preflight.recommendations.map((r) => (
                          <p key={r.package}>
                            · {r.package}：{r.current ?? '?'} →{' '}
                            {r.recommended ? (
                              <span className="text-foreground">{r.recommended}</span>
                            ) : (
                              <span className="text-destructive">暂无兼容版本</span>
                            )}
                            {r.verified && (
                              <span className="text-green-600 dark:text-green-400">
                                （推荐组合已验证可用）
                              </span>
                            )}
                            {r.note && !r.verified && (
                              <span className="text-muted-foreground">（{r.note}）</span>
                            )}
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {runtime?.previous && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 self-start px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={() => void handleRestorePrevious()}
                    disabled={runtimeBusy}
                  >
                    <Undo2 className="size-3.5" />
                    {restoring ? '切换中…' : `回退到上一版本 ${runtime.previous.version}`}
                  </Button>
                )}
                {runtime?.hasUserOverride && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 self-start px-2 text-[11px] text-muted-foreground hover:text-foreground"
                    onClick={handleRevert}
                    disabled={runtimeBusy}
                  >
                    <Undo2 className="size-3.5" />
                    {reverting ? '回退中…' : '回退内置版本'}
                  </Button>
                )}
                {updateLogs.length > 0 && (
                  <pre
                    ref={updateLogRef}
                    className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all rounded-md bg-panel-header p-2 font-mono text-[10px] leading-relaxed text-muted-foreground"
                  >
                    {updateLogs.join('\n')}
                  </pre>
                )}
              </div>

              <div className="border-t border-divider" />

              {/* ---- 插件 ---- */}
              <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-3 shrink-0" />
                安装插件 = 运行任意代码（与应用同权限）。仅安装你信任来源的插件。
              </p>

              {running && (
                <p className="rounded-md bg-panel-header px-2.5 py-1.5 text-[11px] text-muted-foreground">
                  DSH 运行中：插件变更将在重启 DSH 后生效，操作完成后可一键重启。
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
                github:owner/repo#path:/packages/sub（GitHub 子包）。 官方 @deepseek-ai
                插件建议固定版本号，如 @scope/name@0.1.0。
              </p>

              <div className="space-y-1">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-medium">已安装插件</p>
                  <div className="flex items-center gap-1">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={handleRepair}
                      disabled={repairing || !!busyName}
                    >
                      {repairing ? '重装中…' : '重装依赖'}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 text-[11px]"
                      onClick={handleCheckCompat}
                      disabled={compatBusy || !!busyName}
                    >
                      <ShieldCheck className="size-3.5" />
                      {compatBusy ? '检测中…' : '检测兼容性'}
                    </Button>
                  </div>
                </div>
                {loadError && (
                  <p className="text-[11px] text-destructive">列表读取失败：{loadError}</p>
                )}
                {!loadError && plugins.length === 0 && (
                  <p className="py-2 text-center text-[11px] text-muted-foreground">
                    暂无已安装插件
                  </p>
                )}
                {plugins.map((p) => {
                  const c = compat[p.name]
                  return (
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
                          <Tip tip="未进入加载层（安装中断或包内加载文件缺失）。重启应用后自动修复。">
                            <Badge
                              variant="outline"
                              className="shrink-0 border-amber-500/40 text-[11px] text-amber-600 dark:text-amber-400"
                            >
                              未生效
                            </Badge>
                          </Tip>
                        )}
                        {c?.status === 'ok' && (
                          <Badge
                            variant="outline"
                            className="shrink-0 border-green-500/40 text-[11px] text-green-600 dark:text-green-400"
                          >
                            兼容
                          </Badge>
                        )}
                        {c?.status === 'incompatible' && (
                          <Tip tip={`不兼容：${c.issues.join('；')}`}>
                            <Badge
                              variant="outline"
                              className="shrink-0 border-destructive/50 text-[11px] text-destructive"
                            >
                              不兼容
                            </Badge>
                          </Tip>
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
                  )
                })}

                {integrity.length > 0 &&
                  (integrity.filter((e) => !e.ok).length > 0 ? (
                    <div className="space-y-1 pt-1">
                      <p className="text-[11px] leading-relaxed text-destructive">
                        安装不完整（运行时无法加载，请卸载后重装对应插件）：
                      </p>
                      {integrity
                        .filter((e) => !e.ok)
                        .map((e) => (
                          <div
                            key={e.name}
                            className="flex items-center justify-between rounded-md border border-destructive/40 px-2.5 py-1.5"
                          >
                            <span className="truncate text-xs">{e.name}</span>
                            <Tip tip={e.reason ?? '未知原因'}>
                              <span className="shrink-0 text-[11px] text-muted-foreground">
                                查看原因
                              </span>
                            </Tip>
                          </div>
                        ))}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 self-start text-[11px]"
                        onClick={handleRepair}
                        disabled={repairing || !!busyName}
                      >
                        {repairing ? '重装中…' : '一键重装插件依赖'}
                      </Button>
                    </div>
                  ) : (
                    <p className="pt-1 text-[11px] text-green-600 dark:text-green-400">
                      安装完整性正常（{integrity.length} 个包）
                    </p>
                  ))}

                {quarantined.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      启动失败已自动隔离（重启 DSH 后生效）：
                    </p>
                    {quarantined.map((q) => (
                      <div
                        key={q.entryId}
                        className="flex items-center justify-between rounded-md border border-amber-500/40 px-2.5 py-1.5"
                      >
                        <Tip tip={`原因：${q.reason}`}>
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-xs">{q.name ?? q.entryId}</span>
                            <span className="shrink-0 text-[11px] text-muted-foreground">
                              {q.name ? q.entryId : ''}
                            </span>
                          </div>
                        </Tip>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                          onClick={() => handleRestore(q.entryId)}
                          disabled={!!busyName}
                        >
                          恢复
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
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
