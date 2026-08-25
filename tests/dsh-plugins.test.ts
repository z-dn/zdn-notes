import { describe, expect, it } from 'vitest'
import {
  computeBundleSync,
  isValidPluginSpec,
  parseIgnoredBuildPackages,
  parseInstalledPlugins,
} from '../electron/modules/dsh/plugin-spec'

describe('isValidPluginSpec', () => {
  it('accepts npm names, scoped names with versions, and github specs', () => {
    expect(isValidPluginSpec('dsh-better-sidebar')).toBe(true)
    expect(isValidPluginSpec('@deepseek-ai/dsh-annotation')).toBe(true)
    expect(isValidPluginSpec('@deepseek-ai/dsh-annotation@0.1.0')).toBe(true)
    expect(isValidPluginSpec('github:owner/repo')).toBe(true)
    expect(isValidPluginSpec('github:owner/repo#path:/packages/sub')).toBe(true)
    expect(isValidPluginSpec('pkg@1.2.3-beta.1+build')).toBe(true)
  })

  it('rejects empty, flags, whitespace, shell metacharacters, and overlong input', () => {
    expect(isValidPluginSpec('')).toBe(false)
    expect(isValidPluginSpec('-x')).toBe(false)
    expect(isValidPluginSpec('--flag')).toBe(false)
    expect(isValidPluginSpec('a b')).toBe(false)
    expect(isValidPluginSpec('a;b')).toBe(false)
    expect(isValidPluginSpec('a|b')).toBe(false)
    expect(isValidPluginSpec('$(cmd)')).toBe(false)
    expect(isValidPluginSpec('`cmd`')).toBe(false)
    expect(isValidPluginSpec("'x'")).toBe(false)
    expect(isValidPluginSpec('a'.repeat(301))).toBe(false)
  })
})

describe('parseInstalledPlugins', () => {
  it('extracts dependencies only, sorted by name', () => {
    const raw = JSON.stringify({
      name: 'web',
      private: true,
      dependencies: {
        'z-plugin': '^1.0.0',
        '@scope/another': '0.1.0-rc.8',
      },
      devDependencies: { 'dev-only': '1.0.0' },
    })
    expect(parseInstalledPlugins(raw)).toEqual([
      { name: '@scope/another', version: '0.1.0-rc.8' },
      { name: 'z-plugin', version: '^1.0.0' },
    ])
  })

  it('returns empty list when no dependencies', () => {
    expect(parseInstalledPlugins(JSON.stringify({ name: 'web' }))).toEqual([])
  })

  it('throws on malformed json (caller wraps into failure)', () => {
    expect(() => parseInstalledPlugins('not json')).toThrow()
  })
})

describe('parseIgnoredBuildPackages', () => {
  it('parses multiple packages, stripping versions and commas', () => {
    const stderr = `[ERR_PNPM_IGNORED_BUILDS] Ignored build scripts: cloudflared@0.7.3, cpu-features@0.0.10, node-pty@1.1.0, ssh2@1.17.0`
    expect(parseIgnoredBuildPackages(stderr)).toEqual([
      'cloudflared',
      'cpu-features',
      'node-pty',
      'ssh2',
    ])
  })

  it('handles scoped package names safely', () => {
    const stderr = 'Ignored build scripts: @linxin666/dsh-web-all@0.3.3'
    expect(parseIgnoredBuildPackages(stderr)).toEqual(['@linxin666/dsh-web-all'])
  })

  it('dedupes repeated entries', () => {
    const stderr = 'Ignored build scripts: node-pty@1.1.0, node-pty@1.1.0'
    expect(parseIgnoredBuildPackages(stderr)).toEqual(['node-pty'])
  })

  it('returns empty array when no match', () => {
    expect(parseIgnoredBuildPackages('some unrelated error')).toEqual([])
    expect(parseIgnoredBuildPackages('')).toEqual([])
  })
})

describe('computeBundleSync', () => {
  const resolvable = new Set(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'good-plugin'])

  it('appends capable dependencies missing from bundles', () => {
    const { bundles, changed } = computeBundleSync(
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      { '@deepseek-ai/dsh-base': '*', 'good-plugin': '^1.0.0' },
      (n) => resolvable.has(n),
    )
    expect(bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'good-plugin'])
    expect(changed).toBe(true)
  })

  it('keeps in-box bundles that are not dependencies (resolved from installation)', () => {
    const { bundles, changed } = computeBundleSync(
      ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
      {},
      (n) => resolvable.has(n),
    )
    expect(bundles).toEqual(['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'])
    expect(changed).toBe(false)
  })

  it('drops stale bundle entries that no longer resolve', () => {
    const { bundles, changed } = computeBundleSync(
      ['@deepseek-ai/dsh-base', 'removed-plugin'],
      {},
      (n) => resolvable.has(n),
    )
    expect(bundles).toEqual(['@deepseek-ai/dsh-base'])
    expect(changed).toBe(true)
  })

  it('drops dependency bundles whose package lost its dsh.bundle declaration', () => {
    // plain-dep 在依赖里但不可解析为 bundle → 不追加也不保留
    const { bundles, changed } = computeBundleSync(
      ['plain-dep'],
      { 'plain-dep': '^1.0.0' },
      () => false,
    )
    expect(bundles).toEqual([])
    expect(changed).toBe(true)
  })

  it('is idempotent: no changes on already-synced state', () => {
    const { changed } = computeBundleSync(
      ['@deepseek-ai/dsh-base', 'good-plugin'],
      { 'good-plugin': '^1.0.0' },
      (n) => resolvable.has(n),
    )
    expect(changed).toBe(false)
  })
})
