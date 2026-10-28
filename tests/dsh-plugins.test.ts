import { describe, expect, it } from 'vitest'
import { join } from 'path'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import {
  CORE_WEB_BUNDLE,
  checkPackageInstallIntegrity,
  checkPluginAgainstTarget,
  checkPluginCompatibility,
  classifyPluginSpec,
  collectPatchEntries,
  collectPatchEntryIds,
  collectPluginClosure,
  computeBundleSync,
  dshRequirementOf,
  findNewDependencies,
  hasQuarantineBlock,
  isBundleAnchorResolvable,
  isDshPluginManifest,
  isValidPluginSpec,
  matchCulprit,
  packageNameFromEntry,
  parseBootFailure,
  parseBootFailures,
  parseIgnoredBuildPackages,
  parseInstalledPlugins,
  parseMissingPluginPackages,
  parseQuarantineLedger,
  rangeHasUpperBound,
  removeQuarantineBlocks,
  renderQuarantineBlock,
  sameMinorVersion,
  selectHighestCompatibleVersion,
  shouldRebuildWebProfile,
  simulatePluginsAgainstTarget,
  summarizePluginStatuses,
} from '../electron/modules/dsh/plugin-spec'
import { applyWin32ProcessNoWindowPatch } from '../electron/modules/dsh/vendor-patch'

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

describe('shouldRebuildWebProfile', () => {
  it('healthy profile (bundles include core web app) must NOT be rebuilt', () => {
    const raw = JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', CORE_WEB_BUNDLE] } },
    })
    expect(shouldRebuildWebProfile(raw)).toBe(false)
  })

  it('v1.8.2 corruption (core web app missing from bundles) must be rebuilt', () => {
    const raw = JSON.stringify({
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'some-plugin'] } },
    })
    expect(shouldRebuildWebProfile(raw)).toBe(true)
  })

  it('bundles missing / unparseable / absent manifest must be rebuilt', () => {
    expect(shouldRebuildWebProfile(JSON.stringify({ dsh: {} }))).toBe(true)
    expect(shouldRebuildWebProfile(JSON.stringify({}))).toBe(true)
    expect(shouldRebuildWebProfile('not json')).toBe(true)
    expect(shouldRebuildWebProfile(null)).toBe(true)
  })
})

describe('isBundleAnchorResolvable', () => {
  const pkgDir = join('/profile/node_modules', 'some-plugin')
  const makeReader = (files: Record<string, string | null>) => (p: string) =>
    Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null
  const patchPath = join(pkgDir, 'cordis.patch.yml')
  const pkgJsonPath = join(pkgDir, 'package.json')
  const declared = JSON.stringify({ dsh: { bundle: { patch: './cordis.patch.yml' } } })

  it('declared patch file present → resolvable', () => {
    expect(
      isBundleAnchorResolvable(
        pkgDir,
        makeReader({ [pkgJsonPath]: declared }),
        (p) => p === patchPath,
      ),
    ).toBe(true)
  })

  it('declared patch file MISSING → not resolvable (dsh-opencode-zen regression)', () => {
    expect(
      isBundleAnchorResolvable(pkgDir, makeReader({ [pkgJsonPath]: declared }), () => false),
    ).toBe(false)
  })

  it('no dsh.bundle declaration → not resolvable', () => {
    expect(
      isBundleAnchorResolvable(
        pkgDir,
        makeReader({ [pkgJsonPath]: JSON.stringify({ name: 'x' }) }),
        () => true,
      ),
    ).toBe(false)
  })

  it('package.json absent / unparseable / non-string patch → not resolvable', () => {
    expect(isBundleAnchorResolvable(pkgDir, makeReader({}), () => true)).toBe(false)
    expect(
      isBundleAnchorResolvable(pkgDir, makeReader({ [pkgJsonPath]: 'not json' }), () => true),
    ).toBe(false)
    expect(
      isBundleAnchorResolvable(
        pkgDir,
        makeReader({ [pkgJsonPath]: JSON.stringify({ dsh: { bundle: { patch: 42 } } }) }),
        () => true,
      ),
    ).toBe(false)
  })
})

describe('findNewDependencies', () => {
  it('returns deps present in after but not in before', () => {
    expect(
      findNewDependencies(
        { 'old-plugin': '^1.0.0' },
        { 'old-plugin': '^1.0.0', 'new-plugin': 'github:o/r' },
      ),
    ).toEqual(['new-plugin'])
  })

  it('null before (profile absent / first init) → empty (no rollback target)', () => {
    expect(findNewDependencies(null, { 'some-plugin': '^1.0.0' })).toEqual([])
  })

  it('no additions → empty', () => {
    expect(findNewDependencies({ a: '1' }, { a: '1' })).toEqual([])
  })
})

describe('matchCulprit', () => {
  it('matches a new dep name appearing in preflight output', () => {
    expect(
      matchCulprit(
        ['dsh-opencode-zen'],
        'failed to read overlay D:\\...\\node_modules\\dsh-opencode-zen\\cordis.patch.yml: ENOENT',
      ),
    ).toEqual(['dsh-opencode-zen'])
  })

  it('no hit / empty output → empty', () => {
    expect(matchCulprit(['dsh-opencode-zen'], 'some unrelated error')).toEqual([])
    expect(matchCulprit(['a'], '')).toEqual([])
  })

  it('matches only the implicated dep when multiple were added', () => {
    expect(matchCulprit(['innocent', 'guilty'], 'boom in guilty\\cordis.patch.yml')).toEqual([
      'guilty',
    ])
  })
})

describe('classifyPluginSpec', () => {
  it('classifies npm names (plain, scoped, with version/tag)', () => {
    expect(classifyPluginSpec('dsh-better-sidebar')).toEqual({
      kind: 'registry',
      name: 'dsh-better-sidebar',
    })
    expect(classifyPluginSpec('@scope/name')).toEqual({ kind: 'registry', name: '@scope/name' })
    expect(classifyPluginSpec('@scope/name@0.1.0')).toEqual({
      kind: 'registry',
      name: '@scope/name',
      version: '0.1.0',
    })
    expect(classifyPluginSpec('pkg@latest')).toEqual({
      kind: 'registry',
      name: 'pkg',
      version: 'latest',
    })
  })

  it('classifies github/file/http and paths as other (no registry precheck)', () => {
    expect(classifyPluginSpec('github:owner/repo')).toEqual({ kind: 'other' })
    expect(classifyPluginSpec('github:owner/repo#path:/packages/sub')).toEqual({ kind: 'other' })
    expect(classifyPluginSpec('file:./local-pkg')).toEqual({ kind: 'other' })
    expect(classifyPluginSpec('./relative')).toEqual({ kind: 'other' })
    expect(classifyPluginSpec('https://example.com/pkg.tgz')).toEqual({ kind: 'other' })
  })
})

describe('dshRequirementOf', () => {
  it('reads the 4-key fallback in priority order', () => {
    expect(
      dshRequirementOf({
        dsh: { engines: { dsh: '>=0.2.0' }, compatibility: { dsh: '>=0.3.0' } },
        engines: { dsh: '>=0.4.0' },
        peerDependencies: { '@deepseek-ai/dsh': '>=0.5.0' },
      }),
    ).toBe('>=0.2.0')
    expect(dshRequirementOf({ engines: { dsh: '>=0.1.0' } })).toBe('>=0.1.0')
    expect(dshRequirementOf({ peerDependencies: { '@deepseek-ai/dsh': '>=0.1.0' } })).toBe(
      '>=0.1.0',
    )
    expect(dshRequirementOf({ dsh: { compatibility: { dsh: '>=0.1.0' } } })).toBe('>=0.1.0')
  })

  it('returns null when nothing is declared / blank values', () => {
    expect(dshRequirementOf({})).toBeNull()
    expect(dshRequirementOf({ engines: { dsh: '  ' } })).toBeNull()
  })
})

describe('checkPluginCompatibility', () => {
  const resolveNone = () => null

  it('rejects when DSH version requirement is not satisfied (dsh-llm accident shape)', () => {
    const issues = checkPluginCompatibility({
      manifest: { dsh: { compatibility: { dsh: '>=0.2.0-rc.2 <0.3' } } },
      dshVersion: '0.1.5-rc.2',
      nodeVersion: '24.4.0',
      resolveRuntimePackageVersion: resolveNone,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('DSH >=0.2.0-rc.2 <0.3')
    expect(issues[0]).toContain('0.1.5-rc.2')
  })

  it('passes when current DSH satisfies the range (dsh-web-all shape)', () => {
    const issues = checkPluginCompatibility({
      manifest: { dsh: { engines: { dsh: '>=0.1.5-rc.1' } } },
      dshVersion: '0.1.5-rc.2',
      nodeVersion: '24.4.0',
      resolveRuntimePackageVersion: resolveNone,
    })
    expect(issues).toEqual([])
  })

  it('fail-open when DSH requirement declared but current version unknown', () => {
    expect(
      checkPluginCompatibility({
        manifest: { engines: { dsh: '>=9.0.0' } },
        dshVersion: null,
        nodeVersion: '24.4.0',
        resolveRuntimePackageVersion: resolveNone,
      }),
    ).toEqual([])
  })

  it('rejects engines.node mismatch', () => {
    const issues = checkPluginCompatibility({
      manifest: { engines: { node: '>=26' } },
      dshVersion: '0.1.5-rc.2',
      nodeVersion: '24.4.0',
      resolveRuntimePackageVersion: resolveNone,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('Node >=26')
  })

  it('rejects @deepseek-ai/* peer range mismatch (jiesou shape)', () => {
    const issues = checkPluginCompatibility({
      manifest: {
        peerDependencies: {
          '@deepseek-ai/dsh-llm': '>=0.2.0-rc.2 <0.3',
          cordis: '>=4.0.1 <5',
        },
      },
      dshVersion: '0.1.5-rc.2',
      nodeVersion: '24.4.0',
      resolveRuntimePackageVersion: (n) => (n === '@deepseek-ai/dsh-llm' ? '0.1.5-rc.2' : null),
    })
    expect(issues).toHaveLength(1)
    expect(issues[0]).toContain('@deepseek-ai/dsh-llm')
    expect(issues[0]).not.toContain('cordis') // 非 @deepseek-ai/ peer 不检查
  })

  it('fail-open when peer package not resolvable in runtime', () => {
    expect(
      checkPluginCompatibility({
        manifest: { peerDependencies: { '@deepseek-ai/dsh-llm': '>=9.0.0' } },
        dshVersion: '0.1.5-rc.2',
        nodeVersion: '24.4.0',
        resolveRuntimePackageVersion: resolveNone,
      }),
    ).toEqual([])
  })
})

describe('collectPatchEntryIds / collectPatchEntries', () => {
  const webAllPatch = `# AUTO-GENERATED
- id: web-ui-doctor
  name: '@linxin666/dsh-doctor'
  config:
    plugin: '@linxin666/dsh-doctor'
- id: web-ui-compat
  name: compat
  insert:
    - id: nested-entry
      name: nested
  config:
    plugin: '@deepseek-ai/dsh-web-compat'
    config:
      foo: !!js/function >
        function () { return 1 }
- id: top-level-entry
  name: top
`

  it('extracts insert + top-level entry ids, deduped', () => {
    expect(collectPatchEntryIds(webAllPatch).sort()).toEqual([
      'nested-entry',
      'top-level-entry',
      'web-ui-compat',
      'web-ui-doctor',
    ])
  })

  it('collects id/name pairs for quarantine name→id mapping', () => {
    const entries = collectPatchEntries(webAllPatch)
    expect(entries).toContainEqual({ id: 'web-ui-doctor', name: '@linxin666/dsh-doctor' })
    expect(entries).toContainEqual({ id: 'top-level-entry', name: 'top' })
  })

  it('strips !!js tags so FAILSAFE parse succeeds (loader patch files use them)', () => {
    expect(collectPatchEntryIds("- id: a\n  config:\n    fn: !!js/function 'x'\n")).toEqual(['a'])
  })

  it('falls back to line scan on broken yaml', () => {
    expect(collectPatchEntryIds("insert:\n  - id: broken\n  : : :\n  - id: 'quoted-id'\n")).toEqual(
      expect.arrayContaining(['broken', 'quoted-id']),
    )
  })

  it('empty / no-id patch → empty', () => {
    expect(collectPatchEntryIds('')).toEqual([])
    expect(collectPatchEntryIds('insert: []\n')).toEqual([])
  })
})

describe('parseBootFailure', () => {
  it('import failure (dsh-opencode-zen accident shape)', () => {
    const stderr =
      'loader failed\nfailed to apply loader entry include (cordis:include): failed to import loader entry opencode-zen-free-provider (@jiesou/dsh-opencode-zen-free-provider): Cannot find module'
    const f = parseBootFailure(stderr)
    expect(f).toMatchObject({
      kind: 'import',
      entryId: 'opencode-zen-free-provider',
      entryName: '@jiesou/dsh-opencode-zen-free-provider',
    })
  })

  it('apply/activation failure, excluding the cordis Include wrapper', () => {
    const onlyWrapper = 'failed to apply loader entry include (cordis:include): inner detail'
    expect(parseBootFailure(onlyWrapper)).toBeNull()
    const real = 'failed to apply loader entry web-ui-x (@scope/pkg): boom'
    expect(parseBootFailure(real)).toMatchObject({ kind: 'apply', entryId: 'web-ui-x' })
  })

  it('pending service failure (v1.8.2 accident shape)', () => {
    const stderr =
      'plugin tree failed to load:\n@linxin666/dsh-web-all/pet: pending (waiting for service: webServer)'
    expect(parseBootFailure(stderr)).toMatchObject({
      kind: 'pending',
      entryName: '@linxin666/dsh-web-all/pet',
      service: 'webServer',
    })
  })

  it('port steal / unrelated errors → null (no quarantine)', () => {
    expect(
      parseBootFailure('Error: listen EADDRINUSE: address already in use 127.0.0.1:39231'),
    ).toBeNull()
    expect(parseBootFailure('')).toBeNull()
    expect(parseBootFailure('some random stack\nat Module.load')).toBeNull()
  })
})

describe('quarantine block helpers', () => {
  it('render → has → remove roundtrip', () => {
    const original = 'insert:\n  - id: keep\n'
    const block = renderQuarantineBlock('bad-entry')
    const patched = `${original.trimEnd()}\n\n${block}`
    expect(hasQuarantineBlock(patched, 'bad-entry')).toBe(true)
    expect(hasQuarantineBlock(patched, 'other-entry')).toBe(false)
    expect(patched).toContain('- id: bad-entry')
    expect(patched).toContain('  disabled: true')
    expect(removeQuarantineBlocks(patched, 'bad-entry').trim()).toBe(original.trim())
  })

  it('removal is a no-op when the block is absent', () => {
    const text = 'insert:\n  - id: keep\n'
    expect(removeQuarantineBlocks(text, 'missing')).toBe(text)
  })

  it('only the targeted entry block is removed', () => {
    const patched = `${renderQuarantineBlock('a')}\n${renderQuarantineBlock('b')}`
    const after = removeQuarantineBlocks(patched, 'a')
    expect(hasQuarantineBlock(after, 'a')).toBe(false)
    expect(hasQuarantineBlock(after, 'b')).toBe(true)
  })
})

describe('parseQuarantineLedger', () => {
  it('parses valid records and drops malformed entries', () => {
    const raw = JSON.stringify([
      { entryId: 'a', name: '@s/p', reason: 'x', at: 1 },
      { entryId: 'b', reason: 'y', at: 2 },
      { noId: true },
      'string',
      null,
    ])
    expect(parseQuarantineLedger(raw)).toEqual([
      { entryId: 'a', name: '@s/p', reason: 'x', at: 1 },
      { entryId: 'b', reason: 'y', at: 2 },
    ])
  })

  it('empty / broken / non-array → empty', () => {
    expect(parseQuarantineLedger(null)).toEqual([])
    expect(parseQuarantineLedger('')).toEqual([])
    expect(parseQuarantineLedger('not json')).toEqual([])
    expect(parseQuarantineLedger('{}')).toEqual([])
  })
})

describe('summarizePluginStatuses', () => {
  const base = {
    dshVersion: '0.1.5-rc.2',
    nodeVersion: '24.4.0',
    resolveRuntimePackageVersion: () => null,
  }

  it('classifies ok / incompatible / inactive, and treats unreadable as fail-open', () => {
    const out = summarizePluginStatuses({
      ...base,
      plugins: [
        { name: 'good', version: '1.0.0', active: true, manifest: { engines: { dsh: '>=0.1.0' } } },
        { name: 'bad', version: '1.0.0', active: true, manifest: { engines: { dsh: '>=0.2.0' } } },
        { name: 'off', version: '1.0.0', active: false, manifest: { engines: { dsh: '>=0.1.0' } } },
        { name: 'unreadable', version: '1.0.0', active: true, manifest: null },
      ],
    })
    expect(out.find((p) => p.name === 'good')?.status).toBe('ok')
    expect(out.find((p) => p.name === 'bad')?.status).toBe('incompatible')
    expect(out.find((p) => p.name === 'off')?.status).toBe('inactive')
    expect(out.find((p) => p.name === 'unreadable')?.status).toBe('ok')
  })

  it('incompatible wins over inactive', () => {
    const out = summarizePluginStatuses({
      ...base,
      plugins: [
        { name: 'x', version: '1', active: false, manifest: { engines: { node: '>=26' } } },
      ],
    })
    expect(out[0].status).toBe('incompatible')
    expect(out[0].issues.length).toBeGreaterThan(0)
  })
})

describe('simulatePluginsAgainstTarget', () => {
  it('returns only plugins that break on the target version', () => {
    const plugins = [
      {
        name: 'needs-0.2',
        version: '1',
        active: true,
        manifest: { engines: { dsh: '>=0.2.0-rc.2' } },
      },
      { name: 'any', version: '1', active: true, manifest: { engines: { dsh: '>=0.1.0' } } },
    ]
    const toOld = simulatePluginsAgainstTarget({
      plugins,
      targetDshVersion: '0.1.5-rc.2',
      targetCoreVersions: {},
      nodeVersion: '24.4.0',
    })
    expect(toOld.map((r) => r.name)).toEqual(['needs-0.2'])
    const toNew = simulatePluginsAgainstTarget({
      plugins,
      targetDshVersion: '0.2.0-rc.2',
      targetCoreVersions: {},
      nodeVersion: '24.4.0',
    })
    expect(toNew).toEqual([])
  })

  it('uses target core versions for @deepseek-ai/* peer checks', () => {
    const breaking = simulatePluginsAgainstTarget({
      plugins: [
        {
          name: 'p',
          version: '1',
          active: true,
          manifest: { peerDependencies: { '@deepseek-ai/dsh-llm': '>=0.2.0 <0.3' } },
        },
      ],
      targetDshVersion: '0.2.0-rc.2',
      targetCoreVersions: { '@deepseek-ai/dsh-llm': '0.1.5-rc.2' },
      nodeVersion: '24.4.0',
    })
    expect(breaking).toHaveLength(1)
    expect(breaking[0].issues[0]).toContain('@deepseek-ai/dsh-llm')
  })

  it('skips unreadable manifests (fail-open)', () => {
    expect(
      simulatePluginsAgainstTarget({
        plugins: [{ name: 'x', version: '1', active: true, manifest: null }],
        targetDshVersion: '0.2.0-rc.2',
        targetCoreVersions: {},
        nodeVersion: '24.4.0',
      }),
    ).toEqual([])
  })
})

describe('applyWin32ProcessNoWindowPatch', () => {
  const REL = join('node_modules', '@deepseek-ai', 'dsh-win32-process', 'lib', 'index.js')

  function makeRuntime(src: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'zdn-vp-'))
    mkdirSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh-win32-process', 'lib'), {
      recursive: true,
    })
    writeFileSync(join(dir, REL), src)
    return dir
  }

  it('patches all three CreateProcess call sites, and is idempotent', () => {
    const dir = makeRuntime(
      'a, 1, 1028, environment, b\nfoo(args), 0, startupInfo, z\nbar(commandLine, 4, startupInfo)',
    )
    try {
      const r1 = applyWin32ProcessNoWindowPatch(dir)
      expect(r1.applied).toBe(true)
      const out = readFileSync(join(dir, REL), 'utf8')
      expect(out).toContain('134218756')
      expect(out).toContain('134217728')
      expect(out).toContain('134217732')
      const r2 = applyWin32ProcessNoWindowPatch(dir)
      expect(r2.applied).toBe(false)
      expect(r2.skipped).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips (does not throw) when dsh-win32-process is absent', () => {
    const dir = mkdtempSync(join(tmpdir(), 'zdn-vp-'))
    try {
      const r = applyWin32ProcessNoWindowPatch(dir)
      expect(r.applied).toBe(false)
      expect(r.skipped).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips when the upstream version already fixed / changed targets', () => {
    const dir = makeRuntime('const x = 1\n')
    try {
      const r = applyWin32ProcessNoWindowPatch(dir)
      expect(r.applied).toBe(false)
      expect(r.skipped).toBe(true)
      expect(r.reason).toBeTruthy()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('sameMinorVersion', () => {
  it('true only within the same major.minor', () => {
    expect(sameMinorVersion('0.1.5-rc.2', '0.1.7-rc.2')).toBe(true)
    expect(sameMinorVersion('0.2.0-rc.2', '0.2.1-alpha.3')).toBe(true)
    expect(sameMinorVersion('0.1.5-rc.2', '0.2.0-rc.2')).toBe(false)
    expect(sameMinorVersion('1.0.0', '0.9.9')).toBe(false)
  })

  it('false for missing/invalid input', () => {
    expect(sameMinorVersion(null, '0.1.0')).toBe(false)
    expect(sameMinorVersion('0.1.0', undefined)).toBe(false)
    expect(sameMinorVersion('not-a-version', '0.1.0')).toBe(false)
  })
})

describe('packageNameFromEntry', () => {
  it('strips subpaths and keeps the scope', () => {
    expect(packageNameFromEntry('@linxin666/dsh-web-all/ssh')).toBe('@linxin666/dsh-web-all')
    expect(packageNameFromEntry('dsh-better-sidebar')).toBe('dsh-better-sidebar')
    expect(packageNameFromEntry('@scope/pkg/sub/deep')).toBe('@scope/pkg')
  })

  it('rejects protocol specifiers / empty', () => {
    expect(packageNameFromEntry('cordis:include')).toBeNull()
    expect(packageNameFromEntry('node:fs')).toBeNull()
    expect(packageNameFromEntry('')).toBeNull()
  })
})

describe('checkPackageInstallIntegrity', () => {
  const dir = join('/p', 'node_modules', 'pkg')
  const pkgPath = join(dir, 'package.json')
  const reader = (files: Record<string, string | null>) => (p: string) =>
    Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null

  it('ok when declared main exists', () => {
    const r = checkPackageInstallIntegrity({
      name: 'pkg',
      packageDir: dir,
      readText: reader({ [pkgPath]: JSON.stringify({ main: 'lib/index.js' }) }),
      exists: (p) => p === join(dir, 'lib', 'index.js'),
    })
    expect(r.ok).toBe(true)
  })

  it('ok when an exports string leaf exists', () => {
    const r = checkPackageInstallIntegrity({
      name: 'pkg',
      packageDir: dir,
      readText: reader({
        [pkgPath]: JSON.stringify({ exports: { '.': { default: './lib/index.js' } } }),
      }),
      exists: (p) => p === join(dir, 'lib', 'index.js'),
    })
    expect(r.ok).toBe(true)
  })

  it('broken on empty dir / missing package.json (the real incident)', () => {
    const r = checkPackageInstallIntegrity({
      name: '@linxin666/dsh-i18n',
      packageDir: dir,
      readText: () => null,
      exists: () => false,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('package.json')
  })

  it('broken when the declared entry file is missing', () => {
    const r = checkPackageInstallIntegrity({
      name: 'pkg',
      packageDir: dir,
      readText: reader({ [pkgPath]: JSON.stringify({ main: 'lib/index.js' }) }),
      exists: () => false,
    })
    expect(r.ok).toBe(false)
    expect(r.reason).toContain('入口文件缺失')
  })

  it('broken when the package dir cannot be resolved', () => {
    const r = checkPackageInstallIntegrity({
      name: 'x',
      packageDir: null,
      readText: () => null,
      exists: () => false,
    })
    expect(r.ok).toBe(false)
  })
})

describe('parseMissingPluginPackages', () => {
  it('extracts scoped and unscoped packages from path-style errors', () => {
    const stderr =
      "Cannot find package 'D:\\ProgramData\\ZDNotes\\dsh\\profiles\\web\\node_modules\\@linxin666\\dsh-i18n\\index.js'\n" +
      "Cannot find module 'D:\\x\\node_modules\\dsh-better-sidebar\\index.js'"
    expect(parseMissingPluginPackages(stderr).sort()).toEqual([
      '@linxin666/dsh-i18n',
      'dsh-better-sidebar',
    ])
  })

  it('dedupes, handles bare specifiers, and ignores empty input', () => {
    expect(parseMissingPluginPackages('')).toEqual([])
    expect(parseMissingPluginPackages("Cannot find package 'pkg'")).toEqual(['pkg'])
    expect(
      parseMissingPluginPackages(
        "Cannot find package 'pkg'\nCannot find package '/a/node_modules/pkg/index.js'",
      ),
    ).toEqual(['pkg'])
  })
})

describe('collectPluginClosure', () => {
  const manifests: Record<string, Record<string, unknown>> = {
    '@scope/root': {
      name: '@scope/root',
      version: '1.0.0',
      dependencies: { child: '1.0.0', '@deepseek-ai/dsh-base': '*' },
    },
    child: { name: 'child', version: '2.0.0', dependencies: { grand: '1.0.0' } },
    grand: { name: 'grand', version: '3.0.0', dependencies: { '@scope/root': '*' } },
  }
  const read = (n: string) => manifests[n] ?? null

  it('walks transitive deps, skips @deepseek-ai/* runtime packages, and keeps root attribution', () => {
    const nodes = collectPluginClosure({ roots: ['@scope/root'], readManifest: read })
    expect(nodes.map((n) => n.name)).toEqual(['@scope/root', 'child', 'grand'])
    expect(nodes.map((n) => n.root)).toEqual(['@scope/root', '@scope/root', '@scope/root'])
    expect(nodes.map((n) => n.parent)).toEqual([null, '@scope/root', 'child'])
    expect(nodes.find((n) => n.name === 'grand')?.version).toBe('3.0.0')
  })

  it('dedupes roots, survives cycles, and caps node count', () => {
    const nodes = collectPluginClosure({
      roots: ['@scope/root', '@scope/root', 'missing'],
      readManifest: read,
    })
    expect(nodes.map((n) => n.name)).toEqual(['@scope/root', 'missing', 'child', 'grand'])
    expect(nodes.find((n) => n.name === 'missing')?.manifest).toBeNull()
    expect(
      collectPluginClosure({ roots: ['@scope/root'], readManifest: read, maxNodes: 2 }),
    ).toHaveLength(2)
  })

  it('skips @deepseek-ai/* roots (runtime packages, not plugins)', () => {
    expect(
      collectPluginClosure({ roots: ['@deepseek-ai/dsh-web-app'], readManifest: read }),
    ).toEqual([])
  })
})

describe('rangeHasUpperBound', () => {
  it('detects closed ranges (including caret/tilde/exact/x-range desugaring)', () => {
    expect(rangeHasUpperBound('>=0.1.5-rc.1 <0.3')).toBe(true)
    expect(rangeHasUpperBound('^0.1.5')).toBe(true)
    expect(rangeHasUpperBound('~0.1.5')).toBe(true)
    expect(rangeHasUpperBound('0.1.5')).toBe(true)
    expect(rangeHasUpperBound('0.1.x')).toBe(true)
  })

  it('rejects open-ended / wildcard / invalid ranges', () => {
    expect(rangeHasUpperBound('>=0.1.5-rc.1')).toBe(false)
    expect(rangeHasUpperBound('*')).toBe(false)
    expect(rangeHasUpperBound('not a range')).toBe(false)
  })
})

describe('isDshPluginManifest', () => {
  it('recognizes dsh metadata, DSH engines and @deepseek-ai peers', () => {
    expect(isDshPluginManifest({ dsh: { bundle: { patch: './x.yml' } } })).toBe(true)
    expect(isDshPluginManifest({ dsh: { engines: { dsh: '>=0.1.5' } } })).toBe(true)
    expect(isDshPluginManifest({ peerDependencies: { '@deepseek-ai/cordis': '^4' } })).toBe(true)
  })

  it('skips ordinary JS libraries', () => {
    expect(isDshPluginManifest({ name: 'js-yaml', dependencies: { argparse: '^2' } })).toBe(false)
    expect(isDshPluginManifest({ peerDependencies: { react: '^19' } })).toBe(false)
  })
})

describe('checkPluginAgainstTarget', () => {
  const base = {
    targetDshVersion: '0.2.0-rc.2',
    targetCoreVersions: {} as Record<string, string | undefined>,
    nodeVersion: '24.4.0',
  }

  it('reports a missing target peer package (0.2.x removed/renamed core packages)', () => {
    const issues = checkPluginAgainstTarget({
      ...base,
      manifest: { peerDependencies: { '@deepseek-ai/dsh-llm': '^0.1.5-rc.1' } },
      crossMinor: false,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('error')
    expect(issues[0].message).toContain('缺少 peer 包 @deepseek-ai/dsh-llm')
  })

  it('reports a peer version mismatch against the target runtime', () => {
    const issues = checkPluginAgainstTarget({
      ...base,
      targetCoreVersions: { '@deepseek-ai/cordis': '3.0.0' },
      manifest: { peerDependencies: { '@deepseek-ai/cordis': '^4.0.2' } },
      crossMinor: false,
    })
    expect(issues).toHaveLength(1)
    expect(issues[0].severity).toBe('error')
    expect(issues[0].message).toContain('@deepseek-ai/cordis')
    expect(issues[0].message).toContain('3.0.0')
  })

  it('cross-minor + open-ended DSH range → warning; same-minor → passes', () => {
    const manifest = { dsh: { engines: { dsh: '>=0.1.5-rc.1' } } }
    const cross = checkPluginAgainstTarget({ ...base, manifest, crossMinor: true })
    expect(cross).toHaveLength(1)
    expect(cross[0].severity).toBe('warning')
    expect(cross[0].message).toContain('无上界')
    expect(checkPluginAgainstTarget({ ...base, manifest, crossMinor: false })).toEqual([])
  })

  it('cross-minor + closed range including target → passes; excluding target → issue', () => {
    expect(
      checkPluginAgainstTarget({
        ...base,
        manifest: { dsh: { compatibility: { dsh: '>=0.2.0-rc.1 <0.3' } } },
        crossMinor: true,
      }),
    ).toEqual([])
    expect(
      checkPluginAgainstTarget({
        ...base,
        manifest: { dsh: { compatibility: { dsh: '>=0.1.5-rc.1 <0.2' } } },
        crossMinor: true,
      })[0].message,
    ).toContain('插件要求 DSH')
  })

  it('cross-minor + no DSH declaration → warning; same-minor → passes', () => {
    const cross = checkPluginAgainstTarget({ ...base, manifest: {}, crossMinor: true })
    expect(cross).toHaveLength(1)
    expect(cross[0].severity).toBe('warning')
    expect(cross[0].message).toContain('未声明 DSH 版本要求')
    expect(checkPluginAgainstTarget({ ...base, manifest: {}, crossMinor: false })).toEqual([])
  })

  it('keeps engines.node check', () => {
    expect(
      checkPluginAgainstTarget({
        ...base,
        manifest: { engines: { node: '>=26' } },
        crossMinor: false,
      })[0].message,
    ).toContain('Node >=26')
  })
})

describe('selectHighestCompatibleVersion', () => {
  it('picks the highest valid version that satisfies the predicate', () => {
    expect(
      selectHighestCompatibleVersion(['0.1.0', '0.3.0', '0.2.0', 'bad'], (v) => v !== '0.3.0'),
    ).toBe('0.2.0')
  })

  it('returns null when nothing is compatible', () => {
    expect(selectHighestCompatibleVersion(['1.0.0'], () => false)).toBeNull()
    expect(selectHighestCompatibleVersion([], () => true)).toBeNull()
  })
})

describe('parseBootFailures', () => {
  it('collects multiple import/apply/pending failures and dedupes', () => {
    const stderr = [
      'failed to import loader entry a (@s/a): not found',
      'failed to import loader entry a (@s/a): not found',
      'failed to apply loader entry b (@s/b): boom',
      '@s/c/pet: pending (waiting for service: webServer)',
    ].join('\n')
    const failures = parseBootFailures(stderr)
    expect(failures.map((f) => `${f.kind}:${f.entryId ?? f.entryName}`)).toEqual([
      'import:a',
      'apply:b',
      'pending:@s/c/pet',
    ])
  })

  it('ignores the cordis Include wrapper and unrelated errors', () => {
    expect(
      parseBootFailures('failed to apply loader entry include (cordis:include): inner'),
    ).toEqual([])
    expect(parseBootFailures('Error: listen EADDRINUSE 127.0.0.1:1')).toEqual([])
    expect(parseBootFailures('')).toEqual([])
  })
})
