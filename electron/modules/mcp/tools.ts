import type { AgentTool, ToolContext } from '../../core/contracts'
import type { ToolRegistry } from '../../core/tool-registry'

// ===================================================================
// MCP 元工具：插件发现与按需加载。
// 这两个工具用于分层工具发现架构，减少初始 tools/list 的 token 消耗。
// ===================================================================

/**
 * 创建插件发现与加载工具。
 * @param registry - 工具注册表引用（运行时由 app-shell 注入）
 */
export function createMetaTools(registry: () => ToolRegistry): AgentTool[] {
  return [
    META_TOOL_DISCOVER(registry),
    META_TOOL_LOAD(registry),
  ]
}

/**
 * plugin_discover：列出所有可用插件及其能力摘要。
 * 返回插件 ID、描述和工具列表（只返回 name + label + description，不返回 inputSchema）。
 * AI 调用此工具后，可以了解有哪些插件可用，再按需调用 plugin_load 获取完整 schema。
 */
function META_TOOL_DISCOVER(registry: () => ToolRegistry): AgentTool {
  return {
    key: 'plugin:discover',
    name: 'plugin_discover',
    label: '发现可用插件',
    description:
      '列出所有可用插件及其工具摘要。调用此工具后，使用 plugin_load 获取指定插件的完整工具 schema。',
    inputSchema: {
      type: 'object',
      properties: {},
    },
    readonly: true,
    defaultEnabled: true,
    kind: 'builtin',
    tier: 'core',
    run: (_ctx: ToolContext, _args: Record<string, unknown>) => {
      const reg = registry()
      const catalog = reg.getPluginCatalog()
      return {
        plugins: Object.entries(catalog).map(([id, info]) => ({
          id,
          label: info.label,
          description: info.description,
          toolCount: info.tools.length,
          tools: info.tools,
        })),
        totalPlugins: Object.keys(catalog).length,
        totalTools: Object.values(catalog).reduce((sum, p) => sum + p.tools.length, 0),
        hint: '使用 plugin_load(pluginId="<插件ID>") 获取指定插件的完整工具 schema。',
      }
    },
  }
}

/**
 * plugin_load：按需加载指定插件的完整工具 schema。
 * 返回该插件所有工具的 name、description 和 inputSchema，供 AI 调用工具时使用。
 */
function META_TOOL_LOAD(registry: () => ToolRegistry): AgentTool {
  return {
    key: 'plugin:load',
    name: 'plugin_load',
    label: '加载插件工具',
    description:
      '加载指定插件的完整工具 schema（包含 inputSchema）。加载后即可调用该插件的工具。',
    inputSchema: {
      type: 'object',
      properties: {
        pluginId: {
          type: 'string',
          description: '插件 ID（从 plugin_discover 返回的 id 字段获取）',
        },
      },
      required: ['pluginId'],
    },
    readonly: true,
    defaultEnabled: true,
    kind: 'builtin',
    tier: 'core',
    run: (_ctx: ToolContext, args: Record<string, unknown>) => {
      const pluginId = args.pluginId as string
      if (!pluginId) {
        return { error: 'pluginId 参数必填' }
      }

      const reg = registry()
      const tools = reg.all().filter((t) => t.kind === 'plugin' && t.pluginId === pluginId)

      if (tools.length === 0) {
        return {
          error: `未找到插件: ${pluginId}`,
          hint: '使用 plugin_discover 查看可用插件列表。',
        }
      }

      return {
        pluginId,
        tools: tools.map((t) => ({
          name: t.name,
          label: t.label,
          description: t.description,
          inputSchema: t.inputSchema,
          key: t.key, // 用于权限检查
        })),
        message: `已加载 ${tools.length} 个工具。现在可以调用这些工具了。`,
      }
    },
  }
}
