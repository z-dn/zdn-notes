import { useEffect, useState } from 'react'
import { Settings } from 'lucide-react'
import { useSettingsStore } from '@/stores/settings-store'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'
import { showConfirm } from '@/components/confirm-dialog'
import { toast } from '@/lib/toast'
import { useFlipDialog } from '@/hooks/use-flip-dialog'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
  pendingVersion?: string
}

const THEME_OPTIONS: { value: 'system' | 'light' | 'dark'; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]



export function SettingsDialog({ open, onClose, pendingVersion }: SettingsDialogProps) {
  const editing = useSettingsStore((s) => s.editing)
  const dirty = useSettingsStore((s) => s.dirty)
  const updateEditing = useSettingsStore((s) => s.updateEditing)
  const saveSettings = useSettingsStore((s) => s.saveSettings)
  const resetEditing = useSettingsStore((s) => s.resetEditing)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<string>('')
  const [appVersion, setAppVersion] = useState('')
  const [dataDir, setDataDir] = useState('')
  const [dataDirWarning, setDataDirWarning] = useState<string | null>(null)
  const [inboxDir, setInboxDir] = useState('')
  const { contentRef, overlayRef, mounted, playClose } = useFlipDialog(open, onClose)

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setAppVersion)
    window.electronAPI.getDataDir().then(setDataDir)
    window.electronAPI.getDataDirFallback().then(setDataDirWarning)
    window.electronAPI.getInboxDir().then(setInboxDir)
  }, [])

  useEffect(() => {
    if (pendingVersion) {
      setUpdateStatus('available')
      setUpdateInfo(`发现新版本 ${pendingVersion}`)
    } else {
      setUpdateStatus('idle')
      setUpdateInfo('')
    }
  }, [pendingVersion])

  useEffect(() => {
    const unsubs: (() => void)[] = []

    const unsub1 = window.electronAPI.onUpdateChecking(() => {
      setUpdateStatus('checking')
      setUpdateInfo('正在检查更新...')
    })
    if (unsub1) unsubs.push(unsub1)

    const unsub2 = window.electronAPI.onUpdateAvailable((info) => {
      setUpdateStatus('available')
      const ver = (info as { version?: string }).version ?? ''
      setUpdateInfo(`发现新版本 ${ver}`)
    })
    if (unsub2) unsubs.push(unsub2)

    const unsub3 = window.electronAPI.onUpdateNotAvailable(() => {
      setUpdateStatus('not-available')
      setUpdateInfo('已是最新版本')
    })
    if (unsub3) unsubs.push(unsub3)

    const unsub4 = window.electronAPI.onUpdateError((msg) => {
      setUpdateStatus('error')
      setUpdateInfo(`检查更新失败: ${msg}`)
    })
    if (unsub4) unsubs.push(unsub4)

    const unsub5 = window.electronAPI.onUpdateProgress((progress) => {
      setUpdateStatus('downloading')
      const p = progress as { percent?: number }
      setUpdateInfo(`下载中 ${Math.round(p.percent ?? 0)}%`)
    })
    if (unsub5) unsubs.push(unsub5)

    const unsub6 = window.electronAPI.onUpdateDownloaded(() => {
      setUpdateStatus('downloaded')
      setUpdateInfo('更新已下载，点击安装重启应用')
    })
    if (unsub6) unsubs.push(unsub6)

    return () => unsubs.forEach((fn) => fn())
  }, [open])

  if (!mounted) return null

  async function handleSave() {
    const ok = await saveSettings()
    if (ok) playClose()
  }

  function handleCancel() {
    resetEditing()
    setUpdateStatus('idle')
    setUpdateInfo('')
    playClose()
  }

  function handleCheckUpdate() {
    setUpdateStatus('checking')
    setUpdateInfo('正在检查更新...')
    window.electronAPI.updateCheck()
  }

  function handleDownload() {
    setUpdateStatus('downloading')
    setUpdateInfo('正在下载更新...')
    window.electronAPI.updateDownload()
  }

  function handleInstall() {
    window.electronAPI.updateInstall()
  }

  async function handleBackup() {
    const ok = await window.electronAPI.exportBackup()
    toast(ok ? '备份成功' : '备份已取消')
  }

  async function handleRestore() {
    if (!(await showConfirm('恢复数据', '恢复将覆盖当前所有任务、分类和设置，且不可撤销。确定继续吗？'))) return
    const result = await window.electronAPI.importBackup()
    if (result.ok) {
      useTaskStore.getState().selectTask(null)
      useTaskStore.getState().loadTasks()
      useCategoryStore.getState().loadCategories()
      useSettingsStore.getState().loadSettings()
      toast('恢复成功')
    } else {
      toast(`恢复失败: ${result.error ?? '未知错误'}`)
    }
  }

  async function handleChangeDataDir() {
    const picked = await window.electronAPI.chooseDataDir()
    if (!picked) return
    if (
      !(await showConfirm(
        '更改存储位置',
        `数据将被迁移到：\n${picked}\n\n现有数据会复制到新位置，成功后旧位置将被清理。确定继续吗？`
      ))
    )
      return
    const result = await window.electronAPI.setDataDir(picked)
    if (result.ok) {
      setDataDir(result.path ?? picked)
      useTaskStore.getState().selectTask(null)
      useTaskStore.getState().loadTasks()
      useCategoryStore.getState().loadCategories()
      toast('存储位置已更改')
    } else {
      toast(`更改失败: ${result.error ?? '未知错误'}`)
    }
  }

  async function handleResetDataDir() {
    if (!(await showConfirm('恢复默认存储位置', '数据将被移回应用默认目录，旧位置将被清理。确定继续吗？'))) return
    const result = await window.electronAPI.setDataDir('')
    if (result.ok) {
      setDataDir(result.path ?? '')
      useTaskStore.getState().selectTask(null)
      useTaskStore.getState().loadTasks()
      useCategoryStore.getState().loadCategories()
      toast('已恢复默认存储位置')
    } else {
      toast(`恢复失败: ${result.error ?? '未知错误'}`)
    }
  }

  return (
    <div className="fixed inset-0 z-50">
      <div ref={overlayRef} className="absolute inset-0 bg-black/40" onClick={() => playClose()} />
      <div
        ref={contentRef}
        className="fixed left-1/2 top-1/2 flex max-h-[85vh] w-[640px] max-w-[90vw] flex-col rounded-lg border bg-background shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-divider px-6 py-3">
          <h2 className="flex items-center gap-1.5 text-base font-semibold"><Settings className="size-4" /> 设置</h2>
          <button
            onClick={handleCancel}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">主题</label>
            <div className="flex gap-3">
              {THEME_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateEditing('theme', opt.value)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                    editing.theme === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">面板分隔</label>
            <div className="flex gap-3">
              {[
                { value: 'divider' as const, label: '分割线' },
                { value: 'tint' as const, label: '底色分层' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateEditing('panelStyle', opt.value)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                    editing.panelStyle === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">描述编辑方式</label>
            <div className="flex gap-3">
              {[
                { value: 'edit' as const, label: '编辑即显示' },
                { value: 'toggle' as const, label: '手动切换' },
              ].map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => updateEditing('descriptionMode', opt.value)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-xs transition-colors ${
                    editing.descriptionMode === opt.value
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-input bg-background text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={editing.reminderEnabled}
                onChange={(e) => updateEditing('reminderEnabled', e.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-xs font-medium text-muted-foreground">启用到期提醒</span>
            </label>
          </div>

          <div>
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                checked={editing.allowLocalRequests}
                onChange={(e) => updateEditing('allowLocalRequests', e.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-xs font-medium text-muted-foreground">
                允许接口调试访问内网/本机地址
              </span>
            </label>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">数据备份</label>
            <div className="flex items-center gap-3">
              <button
                onClick={handleBackup}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                备份数据
              </button>
              <button
                onClick={handleRestore}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
              >
                恢复数据
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">备份包含数据库与图片，恢复将覆盖当前全部数据。</p>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">数据存储位置</label>
            <p
              className="mb-2 break-all rounded-md border border-input bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
              title={dataDir}
            >
              {dataDir}
            </p>
            {dataDirWarning && (
              <p className="mb-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-300">
                {dataDirWarning}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={handleChangeDataDir}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                更改位置
              </button>
              <button
                onClick={handleResetDataDir}
                className="rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
              >
                恢复默认
              </button>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">数据库与图片将存储在所选目录中，更改后需确认迁移。</p>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">增量导入（收件夹）</label>
            <p
              className="mb-2 break-all rounded-md border border-input bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
              title={inboxDir}
            >
              {inboxDir}
            </p>
            <button
              onClick={async () => { await window.electronAPI.openInboxDir() }}
              className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors"
            >
              打开收件夹
            </button>
            <p className="mt-2 text-xs text-muted-foreground">
              将 zdn-notes.db 或备份 zip 放入收件夹会自动增量合入本地（按时间取新，只增不删）。
            </p>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">更新</label>
            <label className="flex items-center gap-3 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={editing.autoUpdate}
                onChange={(e) => updateEditing('autoUpdate', e.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
              <span className="text-xs font-medium text-muted-foreground">启动时检查更新</span>
            </label>
            <div className="flex items-center gap-3">
              <button
                onClick={handleCheckUpdate}
                disabled={updateStatus === 'checking' || updateStatus === 'downloading'}
                className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                检查更新
              </button>
              {updateStatus === 'available' && (
                <button
                  onClick={handleDownload}
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-xs text-foreground hover:bg-accent transition-colors"
                >
                  下载更新
                </button>
              )}
              {updateStatus === 'downloaded' && (
                <button
                  onClick={handleInstall}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-xs text-white hover:bg-green-700 transition-colors"
                >
                  立即安装
                </button>
              )}
            </div>
            {updateStatus !== 'idle' && (
              <p className="mt-2 text-xs text-muted-foreground">{updateInfo}</p>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-divider px-6 py-3">
          <p className="text-xs text-muted-foreground">v{appVersion}</p>
          <div className="flex gap-3">
            <button
              onClick={handleCancel}
              className="rounded-md border border-input bg-background px-4 py-1.5 text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              取消
            </button>
            <button
              onClick={handleSave}
              disabled={!dirty}
              className="rounded-md bg-primary px-4 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
