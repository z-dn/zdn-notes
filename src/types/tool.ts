export const TOOL_KEYS = {
  json: 'tool:json',
  textDiff: 'tool:textdiff',
  api: 'tool:api',
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

export interface ApiResponseResult {
  ok: boolean
  status?: number
  statusText?: string
  headers?: Record<string, string>
  body?: string
  timeMs?: number
  size?: number
  error?: string
  truncated?: boolean
}

export interface ApiHistoryEntry {
  id: string
  createdAt: number
  method: string
  url: string
  headers: { key: string; value: string }[]
  body: string
  truncated: boolean
  response: ApiResponseResult | null
}

export interface ApiToolState {
  method: string
  url: string
  headers: { key: string; value: string }[]
  body: string
  history: ApiHistoryEntry[]
  lastResponse: ApiResponseResult | null
}

export type ToolStateMap = {
  [TOOL_KEYS.json]: JsonToolState
  [TOOL_KEYS.textDiff]: TextDiffToolState
  [TOOL_KEYS.api]: ApiToolState
}

export const TOOL_DEFAULTS: ToolStateMap = {
  [TOOL_KEYS.json]: { input: '', mode: 'beautify', inputCollapsed: false },
  [TOOL_KEYS.textDiff]: { original: '', modified: '', inputCollapsed: false },
  [TOOL_KEYS.api]: {
    method: 'GET',
    url: '',
    headers: [{ key: '', value: '' }],
    body: '',
    history: [],
    lastResponse: null,
  },
}

export function parseToolState<T>(key: ToolKey, raw: string | undefined, fallback: T): T {
  if (!raw) return fallback
  try {
    return { ...fallback, ...JSON.parse(raw) } as T
  } catch {
    return fallback
  }
}
