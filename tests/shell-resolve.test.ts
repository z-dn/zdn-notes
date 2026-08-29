import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveSidebarShellOverride } from '../electron/modules/dsh/shell-resolve'

const dirs: string[] = []

function makeDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-shell-resolve-'))
  dirs.push(d)
  return d
}

function makeStub(exe: string): void {
  fs.writeFileSync(exe, '')
}

function makeReal(exe: string): void {
  fs.writeFileSync(exe, Buffer.alloc(64))
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true })
  }
})

describe('resolveSidebarShellOverride', () => {
  it('returns undefined on non-win32', () => {
    expect(resolveSidebarShellOverride({ platform: 'linux', env: {} })).toBeUndefined()
  })

  it('returns undefined when no pwsh exists anywhere', () => {
    expect(resolveSidebarShellOverride({ platform: 'win32', env: { PATH: 'C:\\no\\pwsh' } })).toBeUndefined()
  })

  it('returns the first REAL pwsh even when a Store alias stub comes first', () => {
    const stubDir = makeDir()
    const realDir = makeDir()
    makeStub(path.join(stubDir, 'pwsh.exe'))
    makeReal(path.join(realDir, 'pwsh.exe'))
    const env = { PATH: `${stubDir};${realDir}` }
    expect(resolveSidebarShellOverride({ platform: 'win32', env })).toBe(path.join(realDir, 'pwsh.exe'))
  })

  it('returns the first real pwsh when it already precedes any stub', () => {
    const realDir = makeDir()
    const stubDir = makeDir()
    makeReal(path.join(realDir, 'pwsh.exe'))
    makeStub(path.join(stubDir, 'pwsh.exe'))
    const env = { PATH: `${realDir};${stubDir}` }
    expect(resolveSidebarShellOverride({ platform: 'win32', env })).toBe(path.join(realDir, 'pwsh.exe'))
  })

  it('scans ProgramFiles/LOCALAPPDATA known dirs when PATH has no pwsh', () => {
    const pfDir = makeDir()
    const pwsh = path.join(pfDir, 'PowerShell', '7', 'pwsh.exe')
    fs.mkdirSync(path.dirname(pwsh), { recursive: true })
    makeReal(pwsh)
    const env = { PATH: '', ProgramFiles: pfDir }
    expect(resolveSidebarShellOverride({ platform: 'win32', env })).toBe(pwsh)
  })

  it('falls back to inbox powershell.exe full path when only a stub exists', () => {
    const stubDir = makeDir()
    const systemRoot = makeDir()
    makeStub(path.join(stubDir, 'pwsh.exe'))
    const inbox = path.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    fs.mkdirSync(path.dirname(inbox), { recursive: true })
    makeReal(inbox)
    const env = { PATH: stubDir, SystemRoot: systemRoot }
    expect(resolveSidebarShellOverride({ platform: 'win32', env })).toBe(inbox)
  })

  it('falls back to bare powershell.exe when the inbox path is missing', () => {
    const stubDir = makeDir()
    makeStub(path.join(stubDir, 'pwsh.exe'))
    const env = { PATH: stubDir, SystemRoot: makeDir() }
    expect(resolveSidebarShellOverride({ platform: 'win32', env })).toBe('powershell.exe')
  })

  it('respects injected exists/isReal probes', () => {
    const env = { PATH: 'A;B' }
    const exists = (p: string): boolean => p.endsWith('pwsh.exe')
    const isReal = (p: string): boolean => p.startsWith('B')
    expect(resolveSidebarShellOverride({ platform: 'win32', env, exists, isReal })).toBe(path.join('B', 'pwsh.exe'))
  })
})