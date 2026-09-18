import { create } from 'zustand'

// ===================================================================
// DSH UI 共享状态：DshPage（内容区胶囊）与 DshPluginDialog 分属不同
// 组件树位置，需要共享运行状态并互相触发（胶囊打开插件面板）。
// 运行状态由首个订阅者（App 内组件）经 dsh:statusChanged 事件写入。
// ===================================================================

interface DshUiState {
  running: boolean
  port: number | null
  webUrl: string | null
  pluginDialogOpen: boolean
  setStatus: (s: { running: boolean; port?: number; url?: string }) => void
  setPluginDialogOpen: (open: boolean) => void
}

export const useDshUiStore = create<DshUiState>((set) => ({
  running: false,
  port: null,
  webUrl: null,
  pluginDialogOpen: false,
  setStatus: (s) =>
    set({
      running: s.running,
      port: s.running ? (s.port ?? null) : null,
      webUrl: s.running && s.url ? s.url : null,
    }),
  setPluginDialogOpen: (open) => set({ pluginDialogOpen: open }),
}))
