export const TOOL_KEYS = {
  json: 'tool:json',
  textDiff: 'tool:textdiff',
} as const

export type ToolKey = (typeof TOOL_KEYS)[keyof typeof TOOL_KEYS]

export interface JsonToolState {
  input: string
  mode: 'beautify' | 'minify'
  inputCollapsed: boolean
}

export interface TextDiffToolState {
  original: string
  modified: string
  inputCollapsed: boolean
}

export type ToolStateMap = {
  [TOOL_KEYS.json]: JsonToolState
  [TOOL_KEYS.textDiff]: TextDiffToolState
}

export const TOOL_DEFAULTS: ToolStateMap = {
  [TOOL_KEYS.json]: { input: '', mode: 'beautify', inputCollapsed: false },
  [TOOL_KEYS.textDiff]: { original: '', modified: '', inputCollapsed: false },
}

export function parseToolState<T>(key: ToolKey, raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return { ...fallback, ...JSON.parse(raw) } as T
  } catch {
    return fallback
  }
}
