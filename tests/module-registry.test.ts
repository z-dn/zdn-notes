// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { ModuleRegistry } from '../electron/core/module-registry'
import { ToolRegistry } from '../electron/core/tool-registry'
import { TASK_TOOLS } from '../electron/modules/tasks/tools'
import type { FeatureModule, MainModuleContext } from '../electron/core/contracts'

describe('ModuleRegistry.collectCtx（toolRegistry 透传）', () => {
  it('把 toolRegistry 传给 registerIpc / onStart / onShutdown', async () => {
    const reg = new ToolRegistry()
    reg.registerAll(TASK_TOOLS)

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
      toolRegistry: reg,
    }
    await registry.startAll(ctx)
    registry.registerIpcAll(ctx)
    registry.shutdownAll(ctx)

    expect(seen).toHaveLength(3)
    for (const c of seen) {
      expect(c?.toolRegistry).toBe(reg)
      expect(c?.toolRegistry?.keys()).toContain('task:create')
    }
  })

  it('未传 toolRegistry 时保持 undefined（不报错）', () => {
    const registry = new ModuleRegistry()
    registry.register({ id: 't', name: 'T', kind: 'core', registerIpc: () => {} })
    registry.registerIpcAll({})
  })
})
