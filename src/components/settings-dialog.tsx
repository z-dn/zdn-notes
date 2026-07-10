import { useEffect, useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/lib/toast'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

const THEME_OPTIONS: { value: 'system' | 'light' | 'dark'; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]



export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const editing = useSettingsStore((s) => s.editing)
  const dirty = useSettingsStore((s) => s.dirty)
  const updateEditing = useSettingsStore((s) => s.updateEditing)
  const saveSettings = useSettingsStore((s) => s.saveSettings)
  const resetEditing = useSettingsStore((s) => s.resetEditing)
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<string>('')
  const [appVersion, setAppVersion] = useState('')
  const [mounted, setMounted] = useState(false)
  const [show, setShow] = useState(false)

  useEffect(() => {
    if (open) {
      setMounted(true)
      requestAnimationFrame(() => setShow(true))
    } else {
      setShow(false)
      const t = setTimeout(() => setMounted(false), 200)
      setUpdateStatus('idle')
      setUpdateInfo('')
      return () => clearTimeout(t)
    }
  }, [open])

  useEffect(() => {
    window.electronAPI.getAppVersion().then(setAppVersion)
  }, [])

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
    if (ok) onClose()
  }

  function handleCancel() {
    resetEditing()
    onClose()
  }

  function handleOverlayClick(e: React.MouseEvent) {
    if (e.target === e.currentTarget) handleCancel()
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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={handleOverlayClick}>
      <div className={`absolute inset-0 bg-black transition-opacity duration-200 ${show ? 'opacity-40' : 'opacity-0'}`} />
      <div className={`relative w-[420px] rounded-lg border bg-background shadow-xl transition-all duration-200 ${show ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}>
        <div className="flex items-center justify-between border-b px-5 py-3">
          <h2 className="text-base font-semibold">⚙️ 设置</h2>
          <button
            onClick={handleCancel}
            className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">主题</label>
            <div className="flex gap-2">
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
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={editing.reminderEnabled}
                onChange={(e) => updateEditing('reminderEnabled', e.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
              />
              <span className="text-xs font-medium text-muted-foreground">启用到期提醒</span>
            </label>
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-muted-foreground">更新</label>
            <label className="flex items-center gap-2 cursor-pointer mb-3">
              <input
                type="checkbox"
                checked={editing.autoUpdate}
                onChange={(e) => updateEditing('autoUpdate', e.target.checked)}
                className="h-4 w-4 rounded border-input text-primary focus:ring-primary"
              />
              <span className="text-xs font-medium text-muted-foreground">启动时检查更新</span>
            </label>
            <div className="flex items-center gap-2">
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

        <div className="flex items-center justify-between border-t px-5 py-3">
          <p className="text-xs text-muted-foreground">v{appVersion}</p>
          <div className="flex gap-2">
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
