import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

// ===================================================================
// 通用应用日志（主进程各模块共享的落盘 + 广播基建）。
//
// 条目以 JSONL 追加写入 <数据目录>/app-logs.jsonl，跨会话保留，
// 超出上限后自动修剪最近 MAX_APP_LOG_ENTRIES 条。每条日志同时广播
// 给进程内监听器（logs 模块据此经 IPC 推给渲染层实时展示）。
//
// 设计参照 call-log.ts：写入失败静默吞掉，绝不影响业务调用方。
// ===================================================================

export const MAX_APP_LOG_ENTRIES = 2000
export const APP_LOG_FILE = 'app-logs.jsonl'
export const MAX_MESSAGE_LEN = 2000
export const MAX_DETAIL_LEN = 8000

export type AppLogLevel = 'info' | 'warn' | 'error'

export interface AppLogEntry {
  id: string
  ts: number
  level: AppLogLevel
  source: string
  message: string
  detail?: string
}

type LogListener = (entry: AppLogEntry) => void

const listeners = new Set<LogListener>()

/** 修剪节流：每 N 次追加才做一次全量修剪（避免每次追加都读整个文件，O(n²) 卡顿） */
export const TRIM_EVERY = 50
let appendsSinceTrim = 0

export function onLogEntry(listener: LogListener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function emitLogEntry(entry: AppLogEntry): void {
  for (const listener of listeners) {
    try {
      listener(entry)
    } catch {
      // 监听器异常不影响其他监听者
    }
  }
}

export function appLogFile(dataDir: string): string {
  return path.join(dataDir, APP_LOG_FILE)
}

export function appendAppLog(
  dataDir: string,
  data: { level: AppLogLevel; source: string; message: string; detail?: string },
): AppLogEntry {
  const entry: AppLogEntry = {
    id: randomUUID(),
    ts: Date.now(),
    level: data.level,
    source: data.source,
    message: clip(data.message, MAX_MESSAGE_LEN),
    detail: data.detail ? clip(data.detail, MAX_DETAIL_LEN) : undefined,
  }
  emitLogEntry(entry)
  try {
    const file = appLogFile(dataDir)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf-8')
    appendsSinceTrim++
    if (appendsSinceTrim >= TRIM_EVERY) {
      appendsSinceTrim = 0
      trimLogFile(file)
    }
  } catch {
    // 日志写入失败不影响调用本身
  }
  return entry
}

export function readAppLogs(
  dataDir: string,
  opts: { source?: string; level?: AppLogLevel; limit?: number } = {},
): AppLogEntry[] {
  const limit = opts.limit ?? 500
  try {
    const raw = fs.readFileSync(appLogFile(dataDir), 'utf-8')
    const entries: AppLogEntry[] = []
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as AppLogEntry
        if (opts.source && entry.source !== opts.source) continue
        if (opts.level && entry.level !== opts.level) continue
        entries.push(entry)
      } catch {
        // 跳过损坏行
      }
    }
    return entries.slice(-limit).reverse()
  } catch {
    return []
  }
}

export function clearAppLogs(dataDir: string): void {
  try {
    fs.rmSync(appLogFile(dataDir), { force: true })
  } catch {
    // 忽略
  }
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text
}

function trimLogFile(file: string): void {
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    const lines = raw.split('\n').filter(Boolean)
    if (lines.length <= MAX_APP_LOG_ENTRIES) return
    const kept = lines.slice(lines.length - MAX_APP_LOG_ENTRIES)
    fs.writeFileSync(file, kept.join('\n') + '\n', 'utf-8')
  } catch {
    // 忽略
  }
}
