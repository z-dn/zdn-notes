import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

// ===================================================================
// MCP 调用日志（主进程 GUI 端点与独立 MCP 进程共享）。
//
// 记录智能体对 MCP 的每一次 tools/call：时间、工具名、截断参数、
// 耗时、成功/失败。以 JSONL 追加写入 <数据目录>/call-logs.jsonl，
// 跨会话保留，超出上限后自动修剪最近 MAX_LOG_ENTRIES 条。
//
// 双写者约定：GUI 端点（source:'gui'）与独立 MCP 进程（source:'mcp'）
// 都向同一文件追加；同一调用只会被真正执行的一方记录（delegate 转发
// 成功时 GUI 记一条，MCP 侧不再重复）。
// ===================================================================

export const MAX_LOG_ENTRIES = 2000
export const CALL_LOG_FILE = 'call-logs.jsonl'

export interface McpCallLogEntry {
  id: string
  ts: number
  tool: string
  args: Record<string, unknown>
  ok: boolean
  error?: string
  ms: number
  source: 'gui' | 'mcp'
}

// ---- 参数截断：长字符串/深对象收窄，避免日志膨胀 ----

const MAX_STRING_LEN = 200
const MAX_KEYS = 20
const MAX_DEPTH = 3

function truncateValue(v: unknown, depth = 0): unknown {
  if (typeof v === 'string') {
    return v.length > MAX_STRING_LEN ? v.slice(0, MAX_STRING_LEN) + '…' : v
  }
  if (Array.isArray(v)) {
    if (depth >= MAX_DEPTH) return '[…]'
    return v.slice(0, MAX_KEYS).map((x) => truncateValue(x, depth + 1))
  }
  if (v && typeof v === 'object') {
    if (depth >= MAX_DEPTH) return '{…}'
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).slice(0, MAX_KEYS)) {
      out[k] = truncateValue((v as Record<string, unknown>)[k], depth + 1)
    }
    return out
  }
  return v
}

export function truncateArgs(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args || typeof args !== 'object') return {}
  const out: Record<string, unknown> = {}
  for (const k of Object.keys(args).slice(0, MAX_KEYS)) {
    out[k] = truncateValue(args[k])
  }
  return out
}

// ---- 文件读写 ----

export function callLogFile(dataDir: string): string {
  return path.join(dataDir, CALL_LOG_FILE)
}

export function appendCallLog(dataDir: string, entry: McpCallLogEntry): void {
  try {
    const file = callLogFile(dataDir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8')
    trimLogFile(file)
  } catch {
    // 日志写入失败不影响调用本身
  }
}

export function readCallLogs(dataDir: string, limit = 500): McpCallLogEntry[] {
  try {
    const raw = fs.readFileSync(callLogFile(dataDir), 'utf-8')
    const entries: McpCallLogEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        entries.push(JSON.parse(line) as McpCallLogEntry)
      } catch {
        // 跳过损坏行
      }
    }
    return entries.slice(-limit).reverse()
  } catch {
    return []
  }
}

export function clearCallLogs(dataDir: string): void {
  try {
    fs.rmSync(callLogFile(dataDir), { force: true })
  } catch {
    // 忽略
  }
}

function trimLogFile(file: string): void {
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    if (lines.length <= MAX_LOG_ENTRIES) return
    const kept = lines.slice(lines.length - MAX_LOG_ENTRIES)
    fs.writeFileSync(file, kept.join('\n') + '\n', 'utf-8')
  } catch {
    // 忽略
  }
}

export function makeCallLogEntry(data: Omit<McpCallLogEntry, 'id'>): McpCallLogEntry {
  return { ...data, id: randomUUID() }
}
