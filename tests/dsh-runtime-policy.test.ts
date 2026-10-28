import { describe, expect, it } from 'vitest'
import {
  buildRuntimePackageJson,
  electronMajor,
  hostRuntimeInfo,
  isAddonRangeCompatible,
  pickRecommendedRuntime,
  runtimeVersionDirName,
  type RuntimeVersionMeta,
} from '../electron/modules/dsh/runtime-policy'

const version = (v: string, opts: Partial<RuntimeVersionMeta> = {}): RuntimeVersionMeta => ({
  version: v,
  publishedAt: null,
  addonRange: null,
  deprecated: null,
  tags: [],
  hostAddonCompatible: null,
  ...opts,
})

describe('runtime host policy', () => {
  it('marks Electron 42 and older as needing the app-boot patch', () => {
    for (const electron of ['42.11.18', '42.0.0', '41.5.0']) {
      expect(hostRuntimeInfo(electron).appBootPatchRequired).toBe(true)
    }
    expect(hostRuntimeInfo('43.0.0').appBootPatchRequired).toBe(false)
    expect(electronMajor('43.0.0')).toBe(43)
    expect(electronMajor('')).toBeNull()
  })

  it('builds a plain runtime manifest (no addon override)', () => {
    const pkg = buildRuntimePackageJson('0.1.7-rc.2')
    expect((pkg.dependencies as Record<string, string>)['@deepseek-ai/dsh']).toBe('0.1.7-rc.2')
    expect(pkg.pnpm).toBeUndefined()
  })

  it('sanitizes version directory names', () => {
    expect(runtimeVersionDirName('0.1.7-rc.2')).toBe('0.1.7-rc.2')
    expect(runtimeVersionDirName('../../evil')).toBe('.._.._evil')
    expect(runtimeVersionDirName('1.2.3+build.1')).toBe('1.2.3+build.1')
  })

  it('detects addon range compatibility with the host addon', () => {
    expect(isAddonRangeCompatible('^0.1.5', '0.1.5')).toBe(true)
    expect(isAddonRangeCompatible('^0.1.6', '0.1.5')).toBe(false)
    expect(isAddonRangeCompatible(null, '0.1.5')).toBeNull()
    expect(isAddonRangeCompatible('not-a-range', '0.1.5')).toBeNull()
  })
})

describe('pickRecommendedRuntime', () => {
  const versions = [
    version('0.1.7-rc.2', { tags: ['latest'] }),
    version('0.1.6-rc.2'),
    version('0.2.0-rc.2', { tags: ['next'] }),
    version('0.2.1-alpha.3', { tags: ['alpha'] }),
  ]

  it('prefers the highest same-minor version', () => {
    expect(
      pickRecommendedRuntime({
        current: '0.1.5-rc.2',
        versions,
        distTags: { latest: '0.1.7-rc.2', next: '0.2.0-rc.2' },
        pinned: null,
        ignored: [],
      }),
    ).toBe('0.1.7-rc.2')
  })

  it('honors pinned and ignored versions', () => {
    expect(
      pickRecommendedRuntime({
        current: '0.1.5-rc.2',
        versions,
        distTags: { latest: '0.1.7-rc.2', next: '0.2.0-rc.2' },
        pinned: '0.1.6-rc.2',
        ignored: [],
      }),
    ).toBe('0.1.6-rc.2')
    expect(
      pickRecommendedRuntime({
        current: '0.1.5-rc.2',
        versions,
        distTags: { latest: '0.1.7-rc.2', next: '0.2.0-rc.2' },
        pinned: null,
        ignored: ['0.1.7-rc.2'],
      }),
    ).toBe('0.1.6-rc.2')
  })

  it('falls back to latest/next when no same-minor version exists', () => {
    expect(
      pickRecommendedRuntime({
        current: '0.0.9',
        versions,
        distTags: { latest: '0.1.7-rc.2', next: '0.2.0-rc.2' },
        pinned: null,
        ignored: ['0.2.0-rc.2'],
      }),
    ).toBe('0.1.7-rc.2')
  })
})
