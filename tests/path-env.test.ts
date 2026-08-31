import { describe, expect, it } from 'vitest'
import { expandPathVars, mergePathDirs } from '../electron/modules/dsh/path-env'

describe('expandPathVars', () => {
  it('expands known vars from env', () => {
    expect(expandPathVars('C:\\a;%SystemRoot%\\system32', { SystemRoot: 'C:\\Windows' })).toBe(
      'C:\\a;C:\\Windows\\system32',
    )
  })

  it('falls back to built-in SystemRoot/SystemDrive when env lacks them', () => {
    expect(expandPathVars('%SystemRoot%;%SystemDrive%', {})).toBe('C:\\Windows;C:')
  })

  it('keeps unknown vars literal', () => {
    expect(expandPathVars('%JAVA_HOME%\\bin', {})).toBe('%JAVA_HOME%\\bin')
    expect(expandPathVars('%JAVA_HOME%\\bin', { JAVA_HOME: 'C:\\jdk' })).toBe('C:\\jdk\\bin')
  })
})

describe('mergePathDirs', () => {
  it('appends additions not already present, preserving order and deduping', () => {
    expect(mergePathDirs('C:\\a;C:\\b', 'C:\\b;C:\\c')).toBe('C:\\a;C:\\b;C:\\c')
  })

  it('is case-insensitive on Windows-style paths', () => {
    expect(mergePathDirs('c:\\a', 'C:\\A')).toBe('c:\\a')
  })

  it('skips empty segments', () => {
    expect(mergePathDirs('C:\\a;;', ';;C:\\b')).toBe('C:\\a;C:\\b')
  })

  it('existing entries keep priority over additions', () => {
    expect(mergePathDirs('C:\\a', 'C:\\a;D:\\b')).toBe('C:\\a;D:\\b')
  })
})