import { create } from 'zustand'
import { toast } from '@/lib/toast'
import {
  TOOL_KEYS,
  TOOL_DEFAULTS,
  parseToolState,
  type ToolKey,
  type ToolStateMap,
} from '@/types/tool'

const saveTimers: Partial<Record<ToolKey, ReturnType<typeof setTimeout>>> = {}

interface ToolStore {
  states: Record<ToolKey, unknown>
  loaded: boolean
  activeToolId: ToolKey
  setActiveToolId: (id: ToolKey) => void
  loadStates: () => Promise<void>
  getState: <K extends ToolKey>(key: K) => ToolStateMap[K]
  updateState: <K extends ToolKey>(key: K, patch: Partial<ToolStateMap[K]>) => void
}

export const useToolStore = create<ToolStore>((set, get) => ({
  states: {} as Record<ToolKey, unknown>,
  loaded: false,
  activeToolId: TOOL_KEYS.json,

  setActiveToolId: (id) => set({ activeToolId: id }),

  loadStates: async () => {
    try {
      const raw = await window.electronAPI.toolGetAll()
      const states = {} as Record<ToolKey, unknown>
      const keys = Object.values(TOOL_KEYS) as ToolKey[]
      for (const key of keys) {
        states[key] = parseToolState(key, raw[key], TOOL_DEFAULTS[key])
      }
      set({ states, loaded: true })
    } catch {
      toast('加载工具箱状态失败')
    }
  },

  getState: (key) => {
    return (get().states[key] ?? TOOL_DEFAULTS[key]) as ToolStateMap[typeof key]
  },

  updateState: (key, patch) => {
    const current = get().states[key] ?? TOOL_DEFAULTS[key]
    const next = { ...current, ...patch }
    set({ states: { ...get().states, [key]: next } })

    if (saveTimers[key]) clearTimeout(saveTimers[key])
    saveTimers[key] = setTimeout(() => {
      window.electronAPI.toolSet(key, JSON.stringify(next))
    }, 400)
  },
}))
