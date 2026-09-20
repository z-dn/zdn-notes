import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {
  appendAppLog,
  readAppLogs,
  clearAppLogs,
  appLogFile,
  MAX_APP_LOG_ENTRIES,
  TRIM_EVERY,
} from '../electron/core/app-log'

describe('app-log', () => {
  let dataDir: string

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-log-test-'))
  })

  afterEach(() => {
    fs.rmSync(dataDir, { recursive: true, force: true })
  })

  it('append + read roundtrip', () => {
    appendAppLog(dataDir, { level: 'error', source: 'dsh', message: '启动失败', detail: 'boom' })
    appendAppLog(dataDir, { level: 'info', source: 'mcp', message: 'ok' })

    const all = readAppLogs(dataDir)
    expect(all).toHaveLength(2)
    // 倒序（最新在前）
    expect(all[0].message).toBe('ok')
    expect(all[1].message).toBe('启动失败')
    expect(all[1].level).toBe('error')
    expect(all[1].detail).toBe('boom')
    expect(all[1].source).toBe('dsh')
    expect(typeof all[1].ts).toBe('number')
    expect(all[1].id).toBeTruthy()
  })

  it('filter by source and level', () => {
    appendAppLog(dataDir, { level: 'error', source: 'dsh', message: 'e1' })
    appendAppLog(dataDir, { level: 'warn', source: 'dsh', message: 'w1' })
    appendAppLog(dataDir, { level: 'info', source: 'other', message: 'i1' })

    expect(readAppLogs(dataDir, { source: 'dsh' }).map((e) => e.message)).toEqual(['w1', 'e1'])
    expect(readAppLogs(dataDir, { level: 'error' }).map((e) => e.message)).toEqual(['e1'])
    expect(readAppLogs(dataDir, { source: 'dsh', level: 'info' })).toHaveLength(0)
  })

  it('limit returns newest N (reversed)', () => {
    for (let i = 0; i < 10; i++) appendAppLog(dataDir, { level: 'info', source: 't', message: `m${i}` })
    const top3 = readAppLogs(dataDir, { limit: 3 })
    expect(top3).toHaveLength(3)
    expect(top3.map((e) => e.message)).toEqual(['m9', 'm8', 'm7'])
  })

  it('clip overlong message/detail', () => {
    const e = appendAppLog(dataDir, {
      level: 'info',
      source: 'dsh',
      message: 'x'.repeat(5000),
      detail: 'd'.repeat(90000),
    })
    expect(e.message.length).toBeLessThanOrEqual(2001)
    expect(e.message.endsWith('…')).toBe(true)
    expect(e.detail!.length).toBeLessThanOrEqual(8001)
  })

  it('trim keeps file around MAX entries', () => {
    for (let i = 0; i < MAX_APP_LOG_ENTRIES + TRIM_EVERY + 50; i++) {
      appendAppLog(dataDir, { level: 'info', source: 't', message: `m${i}` })
    }
    const all = readAppLogs(dataDir, { limit: MAX_APP_LOG_ENTRIES + TRIM_EVERY + 100 })
    // 修剪每 TRIM_EVERY 条做一次，文件上限是 MAX + TRIM_EVERY 的缓冲带
    expect(all.length).toBeGreaterThan(0)
    expect(all.length).toBeLessThanOrEqual(MAX_APP_LOG_ENTRIES + TRIM_EVERY)
    const file = fs.readFileSync(appLogFile(dataDir), 'utf-8')
    // 修剪保留的是最近的条目，最后一行应是最后写入的那条
    const lastLine = file.split('\n').filter(Boolean).pop()!
    const parsed = JSON.parse(lastLine)
    expect(parsed.message).toBe(`m${MAX_APP_LOG_ENTRIES + TRIM_EVERY + 49}`)
  }, 30_000)

  it('returns subtle entries even when detail missing', () => {
    const e = appendAppLog(dataDir, { level: 'warn', source: 'dsh', message: 'no-detail' })
    expect(e.detail).toBeUndefined()
    expect(readAppLogs(dataDir)[0].detail).toBeUndefined()
  })

  it('clear removes all entries', () => {
    appendAppLog(dataDir, { level: 'info', source: 'dsh', message: 'a' })
    clearAppLogs(dataDir)
    expect(readAppLogs(dataDir)).toHaveLength(0)
  })

  it('read from missing dir returns empty array', () => {
    expect(readAppLogs(path.join(dataDir, 'nonexistent'))).toEqual([])
  })
})
