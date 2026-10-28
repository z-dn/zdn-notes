import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  activeStatePath,
  migrateLegacyRuntime,
  readRuntimeState,
  readVersionFromDir,
  writeRuntimeState,
} from '../electron/modules/dsh/runtime-store'

function makeRuntime(dir: string, version: string): void {
  const pkg = join(dir, 'node_modules', '@deepseek-ai', 'dsh')
  mkdirSync(join(pkg, 'lib'), { recursive: true })
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ version }))
  writeFileSync(join(pkg, 'lib', 'bin.js'), '')
}

const hasBin = (dir: string) =>
  existsSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))

describe('runtime store', () => {
  it('round-trips active state and version metadata', () => {
    const root = mkdtempSync(join(tmpdir(), 'zdn-runtime-store-'))
    try {
      const dir = join(root, 'versions', '0.1.7-rc.2')
      makeRuntime(dir, '0.1.7-rc.2')
      writeRuntimeState(root, {
        version: '0.1.7-rc.2',
        dir: join('versions', '0.1.7-rc.2'),
        at: 123,
        previous: { version: '0.1.5-rc.2', dir: join('versions', '0.1.5-rc.2'), at: 100 },
      })
      expect(existsSync(activeStatePath(root))).toBe(true)
      const state = readRuntimeState(root, hasBin)
      expect(state?.version).toBe('0.1.7-rc.2')
      expect(state?.previous?.version).toBe('0.1.5-rc.2')
      expect(readVersionFromDir(dir)).toBe('0.1.7-rc.2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('migrates a legacy single-directory runtime into versions/<v>', () => {
    const root = mkdtempSync(join(tmpdir(), 'zdn-runtime-legacy-'))
    try {
      makeRuntime(root, '0.1.5-rc.2')
      writeFileSync(
        join(root, 'zdn-runtime.json'),
        JSON.stringify({ version: '0.1.5-rc.2', source: 'user', at: 42 }),
      )
      const migrated = migrateLegacyRuntime(root, hasBin)
      expect(migrated?.version).toBe('0.1.5-rc.2')
      expect(migrated?.at).toBe(42)
      expect(hasBin(join(root, 'versions', '0.1.5-rc.2'))).toBe(true)
      expect(hasBin(root)).toBe(false)
      expect(readRuntimeState(root, hasBin)?.version).toBe('0.1.5-rc.2')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('returns null when there is no user runtime or state is broken', () => {
    const root = mkdtempSync(join(tmpdir(), 'zdn-runtime-empty-'))
    try {
      expect(readRuntimeState(root, hasBin)).toBeNull()
      writeFileSync(activeStatePath(root), '{bad json')
      expect(readRuntimeState(root, hasBin)).toBeNull()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
