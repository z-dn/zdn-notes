import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { applyDshAppBootRequirePatch } from '../electron/modules/dsh/vendor-patch'

const FIXTURE = `function internalModules() {
	const addon = createRequire(import.meta.url)("node-addon-require-builtin");
	const esmModule = addon.requireBuiltin("internal/modules/esm/loader");
	const cjsModule = addon.requireBuiltin("internal/modules/cjs/loader");
	const cjsHelpers = addon.requireBuiltin("internal/modules/helpers");
	const esmUtils = addon.requireBuiltin("internal/modules/esm/utils");
	const esmResolve = addon.requireBuiltin("internal/modules/esm/resolve");
	const esm = esmModule.getOrInitializeCascadedLoader();
	return { esm };
}
`

describe('applyDshAppBootRequirePatch', () => {
  it('rewrites app-boot to prefer --expose-internals require and stays idempotent', () => {
    const root = mkdtempSync(join(tmpdir(), 'zdn-dsh-appboot-'))
    try {
      const dir = join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib')
      mkdirSync(dir, { recursive: true })
      const file = join(dir, 'index.js')
      writeFileSync(file, FIXTURE)
      const first = applyDshAppBootRequirePatch(root)
      expect(first.applied).toBe(true)
      const patched = readFileSync(file, 'utf8')
      expect(patched).toContain('zdn-require-builtin-fallback')
      expect(patched).toContain('const esmModule = requireInternal("internal/modules/esm/loader");')
      expect(patched).toContain('requireInternal("internal/modules/esm/resolve")')
      const second = applyDshAppBootRequirePatch(root)
      expect(second.applied).toBe(false)
      expect(second.skipped).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('skips when app-boot is absent', () => {
    const root = mkdtempSync(join(tmpdir(), 'zdn-dsh-appboot-missing-'))
    try {
      const result = applyDshAppBootRequirePatch(root)
      expect(result.applied).toBe(false)
      expect(result.skipped).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
