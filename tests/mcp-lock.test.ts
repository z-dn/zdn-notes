import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {
  acquireLock,
  releaseLock,
  acquireGuiLock,
  releaseGuiLock,
  writeLock,
  readGuiEndpoint,
  LockBusyError,
  LOCK_FILE,
} from '../electron/mcp/lock'

let dirs: string[] = []

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-mcp-lock-'))
  dirs.push(d)
  return d
}

function readLockFile(dataDir: string): { owner: string; pid: number } | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, LOCK_FILE), 'utf-8'))
  } catch {
    return null
  }
}

beforeEach(() => {
  dirs = []
})

afterEach(() => {
  for (const d of dirs) {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

describe('acquireLock / releaseLock', () => {
  it('acquires and releases a lock', () => {
    const d = tmpDir()
    acquireLock(d, 500)
    const lock = readLockFile(d)
    expect(lock?.owner).toBe('mcp')
    expect(lock?.pid).toBe(process.pid)
    releaseLock(d)
    expect(readLockFile(d)).toBeNull()
  })

  it('is re-entrant for the same process', () => {
    const d = tmpDir()
    acquireLock(d, 500)
    expect(() => acquireLock(d, 500)).not.toThrow()
    releaseLock(d)
  })

  it('does not release a lock owned by another process', () => {
    const d = tmpDir()
    writeLock(d, 'mcp', 999999)
    releaseLock(d)
    const lock = readLockFile(d)
    expect(lock?.pid).toBe(999999)
  })

  it('takes over a stale mcp lock (dead pid)', () => {
    const d = tmpDir()
    writeLock(d, 'mcp', 999999)
    acquireLock(d, 500)
    const lock = readLockFile(d)
    expect(lock?.owner).toBe('mcp')
    expect(lock?.pid).toBe(process.pid)
    releaseLock(d)
  })
})

describe('GUI lock priority', () => {
  it('does not steal a live GUI lock and times out with LockBusyError', () => {
    const d = tmpDir()
    acquireGuiLock(d)
    expect(() => acquireLock(d, 300)).toThrow(LockBusyError)
    releaseGuiLock(d)
  })

  it('takes over a GUI lock after it is released', () => {
    const d = tmpDir()
    acquireGuiLock(d)
    releaseGuiLock(d)
    acquireLock(d, 500)
    expect(readLockFile(d)?.owner).toBe('mcp')
    releaseLock(d)
  })
})

describe('GUI endpoint discovery (GUI-IPC)', () => {
  it('returns the endpoint written by acquireGuiLock', () => {
    const d = tmpDir()
    expect(readGuiEndpoint(d)).toBeNull()
    acquireGuiLock(d, { port: 4321, token: 'secret' })
    expect(readGuiEndpoint(d)).toEqual({ port: 4321, token: 'secret' })
    releaseGuiLock(d)
    expect(readGuiEndpoint(d)).toBeNull()
  })
})