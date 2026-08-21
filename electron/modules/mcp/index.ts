import { ipcMain, dialog, app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { startMcpIpc } from '../../main/mcp-ipc'
import type { McpIpcServer } from '../../main/mcp-ipc'
import { configFileForDataDir } from '../../mcp/config'
import { loadConfig, writeConfig } from '../../mcp/config'
import { acquireGuiLock, releaseGuiLock } from '../../mcp/lock'
import { appendCallLog, readCallLogs, clearCallLogs, makeCallLogEntry } from '../../mcp/call-log'
import { listPlugins, extractPluginZip, uninstallPlugin } from './plugins'
import { pluginRoot } from '../../core/plugin-loader'
import type { ToolRegistry } from '../../core/tool-registry'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'
import type { AppService } from '../../core/app-service'

let mcpIpc: McpIpcServer | null = null
let currentToolRegistry: ToolRegistry | undefined

/** 插件开发规范文档路径：dev 读仓库 docs/，prod 读 extraResources 打包的 plugin-spec.md */
export function pluginSpecPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'plugin-spec.md')
  }
  return join(app.getAppPath(), 'docs', 'plugin-spec.md')
}

/** Agent 工具使用指南路径：dev 读仓库 docs/，prod 读 extraResources 打包的 agent-usage.md */
export function agentGuidePath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'agent-usage.md')
  }
  return join(app.getAppPath(), 'docs', 'agent-usage.md')
}

export function getMcpIpc(): McpIpcServer | null {
  return mcpIpc
}

/** 热重载时由 app-shell 更新当前注册表引用（getCatalog/listPlugins 读取它） */
export function setCurrentToolRegistry(registry: ToolRegistry | undefined): void {
  currentToolRegistry = registry
}

// 应用业务层：MCP 配置/目录/插件管理/调用日志（UI 与插件 ctx.app 共用）
function appService(svc: AppService, ctx: MainModuleContext): void {
  currentToolRegistry = ctx.toolRegistry
  const getCatalogMap = () => currentToolRegistry?.toCatalog()
  svc.register('mcp:getConfig', () =>
    loadConfig({ configFile: configFileForDataDir(ctx.getDataDir()), catalog: getCatalogMap() }),
  )
  svc.register('mcp:setConfig', (cfg: unknown) => {
    writeConfig(
      configFileForDataDir(ctx.getDataDir()),
      cfg as Parameters<typeof writeConfig>[1],
      getCatalogMap(),
    )
    mcpIpc?.reloadConfig()
    return loadConfig({
      configFile: configFileForDataDir(ctx.getDataDir()),
      catalog: getCatalogMap(),
    })
  })
  // 设置页渲染完整工具目录（内置 + 插件），按 kind 分组展示
  svc.register('mcp:getCatalog', () => {
    const reg = currentToolRegistry
    if (!reg) return { tools: [] }
    const tools = reg
      .all()
      .map((t) => ({
        key: t.key,
        name: t.name,
        label: t.label,
        description: t.description,
        kind: t.kind,
        danger: t.danger ?? false,
        defaultEnabled: t.defaultEnabled ?? false,
      }))
      .sort((a, b) =>
        a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'builtin' ? -1 : 1,
      )
    return { tools }
  })
  // 已安装插件清单（内置聚合 + 第三方）
  svc.register('mcp:listPlugins', () => listPlugins(ctx.getDataDir(), currentToolRegistry))
  // 卸载插件
  svc.register('mcp:uninstallPlugin', (id: unknown) => {
    try {
      const removed = uninstallPlugin(ctx.getDataDir(), String(id))
      return { ok: true, removed }
    } catch (e) {
      console.error('[mcp:uninstallPlugin]', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // 插件目录路径（供渲染层展示/打开）
  svc.register('mcp:getPluginsDir', () => pluginRoot(ctx.getDataDir()))
  // 读取调用日志（倒序，最近 500 条）
  svc.register('mcp:getCallLogs', () => readCallLogs(ctx.getDataDir()))
  // 清空调用日志
  svc.register('mcp:clearCallLogs', () => {
    clearCallLogs(ctx.getDataDir())
    return true
  })
  // 插件开发规范文档内容
  svc.register('mcp:getPluginSpec', () => {
    try {
      return { ok: true, content: readFileSync(pluginSpecPath(), 'utf-8') }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // Agent 工具使用指南内容
  svc.register('mcp:getAgentGuide', () => {
    try {
      return { ok: true, content: readFileSync(agentGuidePath(), 'utf-8') }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

function registerIpc(ctx: MainModuleContext): void {
  // 文件/对话框类通道保持 IPC 专属（UI 交互，不进业务层）
  ipcMain.handle('mcp:installPlugin', async () => {
    const result = await dialog.showOpenDialog({
      title: '安装 AGENT 插件',
      properties: ['openFile'],
      filters: [
        { name: 'ZDNotes 插件', extensions: ['ztool'] },
        { name: '压缩包', extensions: ['zip'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) return { ok: false, canceled: true }
    try {
      const manifest = extractPluginZip(result.filePaths[0], ctx.getDataDir())
      return { ok: true, id: manifest.id, name: manifest.name }
    } catch (e) {
      console.error('[mcp:installPlugin]', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // 下载插件开发规范为 Markdown
  ipcMain.handle('mcp:downloadPluginSpec', async () => {
    try {
      const content = readFileSync(pluginSpecPath(), 'utf-8')
      const result = await dialog.showSaveDialog({
        title: '保存插件开发规范',
        defaultPath: 'plugin-spec.md',
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      })
      if (result.canceled || !result.filePath) return { ok: false, canceled: true }
      writeFileSync(result.filePath, content, 'utf-8')
      return { ok: true, path: result.filePath }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
}

async function onStart(ctx: MainModuleContext): Promise<void> {
  currentToolRegistry = ctx.toolRegistry
  const toolRegistry = ctx.toolRegistry
  mcpIpc = await startMcpIpc({
    dataDir: ctx.getDataDir(),
    getDB: ctx.getDB,
    saveAsync: ctx.saveAsync,
    notify: () => ctx.send('data:changed'),
    registry: toolRegistry,
    appService: ctx.appService,
    // GUI 端点执行的调用：落盘 + 实时推送渲染层
    onCall: (call) => {
      const entry = makeCallLogEntry({ ...call, source: 'gui' })
      appendCallLog(ctx.getDataDir(), entry)
      ctx.send('mcp:callLogged', entry)
    },
  })
  // GUI 优先：启动即获取数据目录文件锁，成为权威写者（智能体 zdn-mcp 会尊重此锁）
  acquireGuiLock(ctx.getDataDir(), { port: mcpIpc.port, token: mcpIpc.token })
}

function onShutdown(ctx: MainModuleContext): void {
  if (mcpIpc) void mcpIpc.stop()
  mcpIpc = null
  releaseGuiLock(ctx.getDataDir())
}

export const mcpModule: FeatureModule = {
  id: 'mcp',
  name: 'AI 智能体（MCP）',
  kind: 'optional',
  defaultEnabled: true,
  registerIpc,
  appService,
  onStart,
  onShutdown,
}