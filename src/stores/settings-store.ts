import { create } from 'zustand'
import type { Settings } from '@/types/task'
import { toast } from '@/lib/toast'

const DEFAULTS: Settings = {
  theme: 'system',
  defaultView: 'list',
  reminderEnabled: true,
}

function api() {
  return window.electronAPI
}

interface SettingsStore {
  saved: Settings
  editing: Settings
  loading: boolean
  dirty: boolean

  loadSettings: () => Promise<void>
  updateEditing: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  saveSettings: () => Promise<boolean>
  resetEditing: () => void
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  saved: { ...DEFAULTS },
  editing: { ...DEFAULTS },
  loading: false,
  dirty: false,

  loadSettings: async () => {
    try {
      set({ loading: true })
      const raw = await api().settingsGetAll()
      const saved = { ...DEFAULTS } as Settings
      if (raw.theme && ['system', 'light', 'dark'].includes(raw.theme)) saved.theme = raw.theme as Settings['theme']
      if (raw.defaultView && ['list', 'kanban', 'today'].includes(raw.defaultView)) saved.defaultView = raw.defaultView as Settings['defaultView']
      if (raw.reminderEnabled !== undefined) saved.reminderEnabled = raw.reminderEnabled === 'true'
      set({ saved, editing: { ...saved }, loading: false, dirty: false })
    } catch {
      toast('加载设置失败')
      set({ loading: false })
    }
  },

  updateEditing: (key, value) => {
    const { editing, saved } = get()
    const next = { ...editing, [key]: value }
    set({ editing: next, dirty: next[key] !== saved[key] })
  },

  saveSettings: async () => {
    const { editing } = get()
    try {
      for (const [key, value] of Object.entries(editing)) {
        await api().settingsSet(key, String(value))
      }
      set({ saved: { ...editing }, dirty: false })
      toast('设置已保存')
      return true
    } catch {
      toast('保存设置失败')
      return false
    }
  },

  resetEditing: () => {
    const { saved } = get()
    set({ editing: { ...saved }, dirty: false })
  },
}))
