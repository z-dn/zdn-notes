import { create } from 'zustand'

// ===================================================================
// DSH UI 共享状态：标题栏徽标（dsh-status-badge）与 DshPage（内容区）
// 分属不同组件树位置，需要共享运行状态并互相触发（徽标打开插件面板、
// 面板打开时临时隐藏 WebContentsView）。
// 运行状态由 dsh-status-badge 订阅 dsh:statusChanged 写入（全局单源）。
// ===================================================================

interface DshUiState {
  running: boolean
  port: number | null
  webUrl: string | null
  pluginDialogOpen: boolean
  /** 标题栏徽标下拉菜单展开中：打开时需临时隐藏 WebContentsView（菜单是 DOM，盖不过视图） */
  badgeMenuOpen: boolean
  setStatus: (s: { running: boolean; port?: number; url?: string }) => void
  setPluginDialogOpen: (open: boolean) => void
  setBadgeMenuOpen: (open: boolean) => void
}

export const useDshUiStore = create<DshUiState>((set) => ({
  running: false,
  port: null,
  webUrl: null,
  pluginDialogOpen: false,
  badgeMenuOpen: false,
  setStatus: (s) =>
    set({
      running: s.running,
      port: s.running ? (s.port ?? null) : null,
      webUrl: s.running && s.url ? s.url : null,
    }),
  setPluginDialogOpen: (open) => set({ pluginDialogOpen: open }),
  setBadgeMenuOpen: (open) => set({ badgeMenuOpen: open }),
}))
