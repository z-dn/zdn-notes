// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { ModuleRegistry } from '../electron/core/module-registry'
import type { FeatureModule, MainModuleContext } from '../electron/core/contracts'

describe('ModuleRegistry 生命周期', () => {
  it('registerIpc / onStart / onShutdown 按序调用并透传 ctx', async () => {
    const seen: (MainModuleContext | undefined)[] = []
    const mod: FeatureModule = {
      id: 'test',
      name: 'Test',
      kind: 'core',
      registerIpc: (ctx) => seen.push(ctx),
      onStart: (ctx) => {
        seen.push(ctx)
      },
      onShutdown: (ctx) => seen.push(ctx),
    }
    const registry = new ModuleRegistry()
    registry.register(mod)

    const ctx = {
      getDB: () => null as never,
      saveAsync: () => {},
      send: () => {},
      getDataDir: () => 'd',
    }
    await registry.startAll(ctx)
    registry.registerIpcAll(ctx)
    registry.shutdownAll(ctx)

    expect(seen).toHaveLength(3)
    for (const c of seen) {
      expect(c?.getDataDir()).toBe('d')
    }
  })

  it('未提供可选字段时保持缺省（不报错）', () => {
    const registry = new ModuleRegistry()
    registry.register({ id: 't', name: 'T', kind: 'core', registerIpc: () => {} })
    registry.registerIpcAll({})
  })
})
