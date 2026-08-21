import type { AgentTool, ToolContext } from './contracts'

// ===================================================================
// 统一 MCP 工具注册表（形态 A：单端点合并）。
// 收集内置工具（modules/*/tools.ts）与插件工具（agent-tools/*.js），
// 按 agent-mcp-config.json 白名单过滤后输出 MCP 工具列表。
// 主进程 mcp-ipc 与独立 MCP 进程共用同一套注册表逻辑。
// ===================================================================

export interface McpToolSpec {
  key: string
  name: string
  description: string
  inputSchema: Record<string, unknown>
  kind: 'builtin' | 'plugin'
  tier: 'core' | 'extended'
  readonly: boolean
  danger: boolean
  /** 插件工具：所属插件 id（供构建 PluginToolContext） */
  pluginId?: string
  run(ctx: ToolContext, args: Record<string, unknown>): unknown
}

export interface McpCfgLike {
  enabled?: boolean
  permissions?: Record<string, boolean>
}

export class ToolRegistry {
  private tools = new Map<string, AgentTool>()

  register(tool: AgentTool): void {
    if (this.tools.has(tool.key)) {
      throw new Error(`Tool key already registered: ${tool.key}`)
    }
    this.tools.set(tool.key, tool)
  }

  registerAll(tools: AgentTool[]): void {
    for (const t of tools) this.register(t)
  }

  /** 全部已注册工具（含禁用），key → tool */
  all(): AgentTool[] {
    return [...this.tools.values()]
  }

  /** 全部工具 key（供配置白名单生成） */
  keys(): string[] {
    return [...this.tools.keys()]
  }

  findByName(name: string): AgentTool | undefined {
    for (const t of this.tools.values()) {
      if (t.name === name) return t
    }
    return undefined
  }

  findByKey(key: string): AgentTool | undefined {
    return this.tools.get(key)
  }

  /**
   * 输出配置目录（key → 元信息），供 agent-mcp-config.json 默认白名单生成与
   * 设置页渲染使用。内置工具与插件工具统一由此派生。
   */
  toCatalog(): Record<string, { label: string; default: boolean; danger: boolean }> {
    const out: Record<string, { label: string; default: boolean; danger: boolean }> = {}
    for (const t of this.tools.values()) {
      out[t.key] = { label: t.label, default: t.defaultEnabled ?? false, danger: t.danger ?? false }
    }
    return out
  }

  /**
   * 按配置白名单构建 MCP 工具列表。
   * 只有 enabled 且 permissions[key] === true 的工具才会暴露给智能体
   * —— 禁用的工具不进 tools/list，从而不进模型上下文（token 精简）。
   *
   * @param options.tier - 过滤层级：'core' 只返回核心工具，'all' 返回所有允许的工具（默认）
   */
  buildMcpTools(cfg: McpCfgLike, options?: { tier?: 'core' | 'all' }): McpToolSpec[] {
    const out: McpToolSpec[] = []
    for (const t of this.tools.values()) {
      const allowed = cfg.enabled !== false && cfg.permissions?.[t.key] !== false
      if (!allowed) continue

      // 分层过滤：core 模式下只返回 tier='core' 的工具
      const tier = t.tier ?? 'core' // 默认为 core，向后兼容
      if (options?.tier === 'core' && tier !== 'core') continue

      out.push({
        key: t.key,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        kind: t.kind,
        tier,
        readonly: t.readonly ?? false,
        danger: t.danger ?? false,
        pluginId: t.pluginId,
        run: t.run,
      })
    }
    return out
  }

  /** 获取所有已注册工具的目录摘要（用于 plugin_discover 元工具） */
  getPluginCatalog(): Record<string, { label: string; description: string; tools: { name: string; label: string; description: string }[] }> {
    const plugins: Record<string, { label: string; description: string; tools: { name: string; label: string; description: string }[] }> = {}

    for (const t of this.tools.values()) {
      if (t.kind !== 'plugin' || !t.pluginId) continue

      if (!plugins[t.pluginId]) {
        plugins[t.pluginId] = {
          label: t.pluginId,
          description: `插件 ${t.pluginId} 提供的工具`,
          tools: [],
        }
      }

      plugins[t.pluginId].tools.push({
        name: t.name,
        label: t.label,
        description: t.description.slice(0, 100), // 截断摘要
      })
    }

    return plugins
  }
}