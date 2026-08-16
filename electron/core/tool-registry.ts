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
  readonly: boolean
  danger: boolean
  /** 插件工具：所属插件 id（供构建 PluginToolContext） */
  pluginId?: string
  /** 插件工具：插件声明的权限（manifest.permissions，能力授权判断） */
  pluginPermissions?: string[]
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
   */
  buildMcpTools(cfg: McpCfgLike): McpToolSpec[] {
    const out: McpToolSpec[] = []
    for (const t of this.tools.values()) {
      const allowed = cfg.enabled !== false && cfg.permissions?.[t.key] !== false
      if (!allowed) continue
      out.push({
        key: t.key,
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        kind: t.kind,
        readonly: t.readonly ?? false,
        danger: t.danger ?? false,
        pluginId: t.pluginId,
        pluginPermissions: t.pluginPermissions,
        run: t.run,
      })
    }
    return out
  }
}