import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  loadConfig,
  writeConfig,
  isAllowed,
  allowedOperations,
  DEFAULT_CONFIG,
  OPERATION_CATALOG,
} from '../electron/mcp/config'

const dirs: string[] = []

function tmpFile(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-mcp-config-'))
  dirs.push(d)
  return path.join(d, 'agent-mcp-config.json')
}

afterEach(() => {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

describe('loadConfig', () => {
  it('writes default config when file is missing and returns defaults', () => {
    const f = tmpFile()
    const cfg = loadConfig({ configFile: f })
    expect(cfg.enabled).toBe(true)
    expect(cfg.maxWaitLockMs).toBe(2000)
    expect(cfg.permissions['task:create']).toBe(true)
    expect(cfg.permissions['task:update']).toBe(true)
    expect(cfg.permissions['task:delete']).toBe(true)
    expect(fs.existsSync(f)).toBe(true)
  })

  it('merges partial config with defaults', () => {
    const f = tmpFile()
    fs.writeFileSync(f, JSON.stringify({ permissions: { 'task:delete': true } }), 'utf-8')
    const cfg = loadConfig({ configFile: f })
    expect(cfg.permissions['task:delete']).toBe(true)
    expect(cfg.permissions['task:create']).toBe(true) // 来自默认
  })

  it('filters unknown permission keys', () => {
    const f = tmpFile()
    fs.writeFileSync(
      f,
      JSON.stringify({ permissions: { 'task:delete': true, 'bogus:op': true } }),
      'utf-8',
    )
    const cfg = loadConfig({ configFile: f })
    expect('bogus:op' in cfg.permissions).toBe(false)
  })

  it('falls back to defaults on invalid JSON', () => {
    const f = tmpFile()
    fs.writeFileSync(f, 'not json', 'utf-8')
    const cfg = loadConfig({ configFile: f })
    expect(cfg.permissions['task:create']).toBe(true)
  })
})

describe('writeConfig', () => {
  it('writes merged config to file', () => {
    const f = tmpFile()
    const cfg = writeConfig(f, { enabled: false, permissions: { 'task:delete': true } })
    expect(cfg.enabled).toBe(false)
    expect(cfg.permissions['task:delete']).toBe(true)
    expect(cfg.permissions['task:create']).toBe(true) // 来自默认
    const onDisk = JSON.parse(fs.readFileSync(f, 'utf-8'))
    expect(onDisk.enabled).toBe(false)
  })

  it('filters unknown permission keys on write', () => {
    const f = tmpFile()
    const cfg = writeConfig(f, { permissions: { 'bogus:op': true } as never })
    expect('bogus:op' in cfg.permissions).toBe(false)
  })

  it('loads back what was written', () => {
    const f = tmpFile()
    writeConfig(f, { enabled: true, permissions: { 'task:delete': false } })
    const cfg = loadConfig({ configFile: f })
    expect(cfg.permissions['task:delete']).toBe(false)
  })
})

describe('isAllowed / allowedOperations', () => {
  it('respects the enabled master switch', () => {
    const cfg = { ...DEFAULT_CONFIG, enabled: false }
    for (const k of Object.keys(OPERATION_CATALOG)) {
      expect(isAllowed(cfg, k as keyof typeof OPERATION_CATALOG)).toBe(false)
    }
  })

  it('returns only allowed operations by default', () => {
    const ops = allowedOperations(DEFAULT_CONFIG)
    expect(ops).toContain('task:create')
    expect(ops).toContain('task:read_list')
    expect(ops).toContain('task:read_detail')
    expect(ops).toContain('task:update_status')
    expect(ops).toContain('task:update')
    expect(ops).toContain('task:delete')
    // 分类能力已从 MCP 能力清单中移除
    expect(ops).not.toContain('category:list')
    expect(ops).not.toContain('category:create')
  })

  it('honors explicit permission override', () => {
    const cfg = { ...DEFAULT_CONFIG, permissions: { ...DEFAULT_CONFIG.permissions, 'task:delete': true } }
    expect(isAllowed(cfg, 'task:delete')).toBe(true)
  })
})