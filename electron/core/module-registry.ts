import type { FeatureModule, MainModuleContext } from './contracts'
import type { AgentTool } from './contracts'
import { isEnabled } from './feature-flags'
import type { ToolRegistry } from './tool-registry'

// ===================================================================
// 平台模块装配器（App Assembler）。
// 收集内置 FeatureModule，按 feature-flags 决定启用与否，依次执行
// onStart / registerIpc / 收集 agentTools。渲染层声明（view / settings
// sections）也由此统一导出。
// 主进程 app-shell（electron/main/app-shell.ts）与测试均可复用。
// ===================================================================

export class ModuleRegistry {
  private modules: FeatureModule[] = []
  private enabledCache: Map<string, FeatureModule> | null = null
  private flags: Record<string, boolean> = {}

  register(module: FeatureModule): void {
    if (this.modules.some((m) => m.id === module.id)) {
      throw new Error(`Module already registered: ${module.id}`)
    }
    this.modules.push(module)
    this.enabledCache = null
  }

  registerAll(modules: FeatureModule[]): void {
    for (const m of modules) this.register(m)
  }

  all(): FeatureModule[] {
    return [...this.modules]
  }

  get(id: string): FeatureModule | undefined {
    return this.modules.find((m) => m.id === id)
  }

  /** 根据 flags 解析出当前启用的模块列表 */
  enabled(flags?: Record<string, boolean>): FeatureModule[] {
    if (flags) this.flags = flags
    if (this.enabledCache) return [...this.enabledCache.values()]
    const list = this.modules.filter((m) => isEnabled(this.flags, m.id))
    this.enabledCache = new Map(list.map((m) => [m.id, m]))
    return list
  }

  private collectCtx(provided: Partial<MainModuleContext>): MainModuleContext {
    return {
      getDB: provided.getDB ?? (() => { throw new Error('getDB not provided') }),
      saveAsync: provided.saveAsync ?? (() => {}),
      send: provided.send ?? (() => {}),
      getDataDir: provided.getDataDir ?? (() => ''),
      toolRegistry: provided.toolRegistry,
    }
  }

  /** 执行启用的模块的 onStart */
  async startAll(ctx: Partial<MainModuleContext>, flags?: Record<string, boolean>): Promise<void> {
    const c = this.collectCtx(ctx)
    for (const m of this.enabled(flags)) {
      await m.onStart?.(c)
    }
  }

  /** 执行启用的模块的 registerIpc */
  registerIpcAll(ctx: Partial<MainModuleContext>, flags?: Record<string, boolean>): void {
    const c = this.collectCtx(ctx)
    for (const m of this.enabled(flags)) m.registerIpc?.(c)
  }

  /** 执行启用的模块的 onShutdown */
  shutdownAll(ctx: Partial<MainModuleContext>, flags?: Record<string, boolean>): void {
    const c = this.collectCtx(ctx)
    for (const m of this.enabled(flags)) m.onShutdown?.(c)
  }

  /** 收集启用的模块贡献的 Agent 工具 */
  collectAgentTools(flags?: Record<string, boolean>): AgentTool[] {
    const out: AgentTool[] = []
    for (const m of this.enabled(flags)) {
      if (m.agentTools) out.push(...m.agentTools)
    }
    return out
  }

  /** 把启用的模块的 Agent 工具注册进统一 ToolRegistry */
  registerAgentTools(registry: ToolRegistry, flags?: Record<string, boolean>): void {
    registry.registerAll(this.collectAgentTools(flags))
  }

  /** 启用的模块的渲染层视图声明 */
  collectViews(flags?: Record<string, boolean>) {
    return this.enabled(flags)
      .map((m) => m.renderer?.view)
      .filter((v): v is NonNullable<typeof v> => !!v)
  }

  /** 启用的模块的渲染层设置小节声明 */
  collectSettingsSections(flags?: Record<string, boolean>) {
    return this.enabled(flags)
      .map((m) => m.renderer?.settingsSections ?? [])
      .flat()
  }
}