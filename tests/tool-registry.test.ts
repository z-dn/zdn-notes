import { describe, it, expect, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ToolRegistry } from '../electron/core/tool-registry'
import { TASK_TOOLS } from '../electron/modules/tasks/tools'
import { loadConfig, writeConfig } from '../electron/mcp/config'

const dirs: string[] = []

function tmpFile(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-tool-registry-'))
  dirs.push(d)
  return path.join(d, 'agent-mcp-config.json')
}

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

function pluginTool(key: string, name: string, opts?: { defaultEnabled?: boolean; danger?: boolean }) {
  return {
    key,
    name,
    label: name,
    description: 'plugin tool',
    inputSchema: {},
    defaultEnabled: opts?.defaultEnabled,
    danger: opts?.danger,
    kind: 'plugin' as const,
    run: () => 'ok',
  }
}

describe('ToolRegistry + config 动态 key（P2/P3）', () => {
  it('buildMcpTools only exposes whitelisted tools', () => {
    const reg = new ToolRegistry()
    reg.registerAll(TASK_TOOLS)
    reg.register(pluginTool('http:request', 'http_request'))

    // 默认配置：task 工具全开 + http:request 按 defaultEnabled 决定
    const tools = reg.buildMcpTools({ enabled: true, permissions: { 'task:create': true, 'http:request': false } })
    const names = tools.map((t) => t.name)
    expect(names).toContain('task_create')
    expect(names).not.toContain('http_request')
  })

  it('writeConfig/loadConfig 保留插件 key（不再被过滤）', () => {
    const f = tmpFile()
    const catalog = {
      'task:create': { label: '创建任务', default: true, danger: false },
      'http:request': { label: 'HTTP 请求', default: true, danger: false },
    }
    writeConfig(f, { permissions: { 'http:request': true } }, catalog)
    const cfg = loadConfig({ configFile: f, catalog })
    expect(cfg.permissions['http:request']).toBe(true)
    expect(cfg.permissions['task:create']).toBe(true) // 来自目录默认
    // 未知 key 仍会被过滤
    writeConfig(f, { permissions: { 'bogus:op': true } }, catalog)
    expect(loadConfig({ configFile: f, catalog }).permissions['bogus:op']).toBeUndefined()
  })

  it('toCatalog 派生配置目录（内置+插件统一）', () => {
    const reg = new ToolRegistry()
    reg.registerAll(TASK_TOOLS)
    reg.register(pluginTool('http:request', 'http_request', { defaultEnabled: false, danger: true }))
    const catalog = reg.toCatalog()
    expect(catalog['task:create']).toMatchObject({ label: '创建任务', default: true })
    expect(catalog['http:request']).toMatchObject({ default: false, danger: true })
  })
})