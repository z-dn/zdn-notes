import { ipcMain, dialog, app } from 'electron'
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { startMcpIpc } from '../../main/mcp-ipc'
import type { McpIpcServer } from '../../main/mcp-ipc'
import { desktopBridge } from '../../main/desktop-bridge'
import { configFileForDataDir } from '../../mcp/config'
import { loadConfig, writeConfig } from '../../mcp/config'
import { acquireGuiLock, releaseGuiLock } from '../../mcp/lock'
import { listPlugins, extractPluginZip, uninstallPlugin } from './plugins'
import { pluginRoot } from '../../core/plugin-loader'
import type { ToolRegistry } from '../../core/tool-registry'
import type { FeatureModule, MainModuleContext } from '../../core/contracts'

let mcpIpc: McpIpcServer | null = null
let currentToolRegistry: ToolRegistry | undefined

/** 插件开发规范文档路径：dev 读仓库 docs/，prod 读 extraResources 打包的 plugin-spec.md */
export function pluginSpecPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'plugin-spec.md')
  }
  return join(app.getAppPath(), 'docs', 'plugin-spec.md')
}

export function getMcpIpc(): McpIpcServer | null {
  return mcpIpc
}

/** 热重载时由 app-shell 更新当前注册表引用（getCatalog/listPlugins 读取它） */
export function setCurrentToolRegistry(registry: ToolRegistry | undefined): void {
  currentToolRegistry = registry
}

function registerIpc(ctx: MainModuleContext): void {
  currentToolRegistry = ctx.toolRegistry
  const getCatalogMap = () => currentToolRegistry?.toCatalog()
  ipcMain.handle('mcp:getConfig', () =>
    loadConfig({ configFile: configFileForDataDir(ctx.getDataDir()), catalog: getCatalogMap() }),
  )
  ipcMain.handle('mcp:setConfig', (_e, cfg: unknown) => {
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
  ipcMain.handle('mcp:getCatalog', () => {
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
        capabilities: t.pluginPermissions ?? [],
      }))
      .sort((a, b) =>
        a.kind === b.kind ? a.label.localeCompare(b.label) : a.kind === 'builtin' ? -1 : 1,
      )
    return { tools }
  })
  // 已安装插件清单（内置聚合 + 第三方）
  ipcMain.handle('mcp:listPlugins', () => listPlugins(ctx.getDataDir(), currentToolRegistry))
  // 从 .ztool 安装插件
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
  // 卸载插件
  ipcMain.handle('mcp:uninstallPlugin', (_e, id: string) => {
    try {
      const removed = uninstallPlugin(ctx.getDataDir(), id)
      return { ok: true, removed }
    } catch (e) {
      console.error('[mcp:uninstallPlugin]', e)
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  })
  // 插件目录路径（供渲染层展示/打开）
  ipcMain.handle('mcp:getPluginsDir', () => pluginRoot(ctx.getDataDir()))
  // 插件开发规范文档内容
  ipcMain.handle('mcp:getPluginSpec', () => {
    try {
      return { ok: true, content: readFileSync(pluginSpecPath(), 'utf-8') }
    } catch (e) {
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
    desktopBridge,
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
  onStart,
  onShutdown,
}
