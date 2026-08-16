import { getAllSettings, setSetting } from './database/settings-dao'
import { getAllTasks, getTaskById } from './database/task-dao'
import { getAllCategories } from './database/category-dao'
import { getAllToolState } from './database/tool-state-dao'

// ===================================================================
// 插件 desktop 能力桥（P4）。
// 插件声明 permission "desktop" 后，ctx.desktop(channel, ...args) 可调用
// 白名单内的桌面 IPC 通道（只读为主，写操作严格限制）。
// 通道在此显式登记，防止第三方插件拿到任意主进程能力。
// ===================================================================

export type DesktopBridge = (channel: string, args: unknown[]) => Promise<unknown>

const READ_CHANNELS = {
  'settings:getAll': () => getAllSettings(),
  'task:getAll': (args: unknown[]) => getAllTasks(args[0] as never),
  'task:getById': (args: unknown[]) => getTaskById(String(args[0])),
  'category:getAll': () => getAllCategories(),
  'tool:getAll': () => getAllToolState(),
} as const

const WRITE_CHANNELS = {
  'settings:set': (args: unknown[]) => {
    setSetting(String(args[0]), String(args[1]))
    return true
  },
} as const

const ALLOWED: Record<string, boolean> = {}
for (const k of Object.keys(READ_CHANNELS)) ALLOWED[k] = true
for (const k of Object.keys(WRITE_CHANNELS)) ALLOWED[k] = true

/** GUI 侧的 desktop 桥实现：仅放行登记通道 */
export const desktopBridge: DesktopBridge = async (channel, args) => {
  const readHandler = (READ_CHANNELS as Record<string, unknown>)[channel]
  if (typeof readHandler === 'function') {
    return (readHandler as (a: unknown[]) => unknown)(args)
  }
  const writeHandler = (WRITE_CHANNELS as Record<string, unknown>)[channel]
  if (typeof writeHandler === 'function') {
    return (writeHandler as (a: unknown[]) => unknown)(args)
  }
  throw new Error(`desktop 能力不允许调用通道: ${channel}`)
}

/** 判断插件是否能调用某通道（供授权 UI 展示） */
export function isDesktopChannelAllowed(channel: string): boolean {
  return ALLOWED[channel] === true
}

/** 展示 desktop 授权可用通道 */
export function desktopChannelList(): { channel: string; writable: boolean }[] {
  return Object.keys(ALLOWED).map((channel) => ({
    channel,
    writable: channel in WRITE_CHANNELS,
  }))
}