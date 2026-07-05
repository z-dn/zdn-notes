import { useSettingsStore } from '@/stores/settings-store'
import { toast } from '@/lib/toast'

interface SettingsDialogProps {
  open: boolean
  onClose: () => void
}

const THEME_OPTIONS: { value: 'system' | 'light' | 'dark'; label: string }[] = [
  { value: 'system', label: '跟随系统' },
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
]

const VIEW_OPTIONS: { value: 'list' | 'kanban' | 'today'; label: string }[] = [
  { value: 'list', label: '列表视图' },
  { value: 'kanban', label: '看板视图' },
  { value: 'today', label: '今日聚焦' },
]

export function SettingsDialog({ open, onClose }: SettingsDialogProps) {
  const editing = useSettingsStore((s) => s.editing)
  const dirty = useSettingsStore((s) => s.dirty)
  const updateEditing = useSettingsStore((s) => s.updateEditing)
  const saveSettings = useSettingsStore((s) => s.saveSettings)
  const resetEditing = useSettingsStore((s) => s.resetEditing)

  if (!open) return null

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={handleOverlayClick}
    >
      <div className="w-[400px] rounded-lg border bg-background shadow-xl">
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
            <label className="mb-2 block text-xs font-medium text-muted-foreground">默认视图</label>
            <div className="relative">
              <select
                value={editing.defaultView}
                onChange={(e) => updateEditing('defaultView', e.target.value as typeof editing.defaultView)}
                className="flex h-8 w-full items-center rounded-md border border-input bg-background px-2 text-xs text-foreground appearance-none cursor-pointer hover:bg-accent transition-colors"
              >
                {VIEW_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
              <svg
                className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground"
                fill="none" viewBox="0 0 24 24" stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
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
        </div>

        <div className="flex justify-end gap-2 border-t px-5 py-3">
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
  )
}
