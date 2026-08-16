// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import AdmZip from 'adm-zip'
import {
  listPlugins,
  validateManifest,
  extractPluginZip,
  uninstallPlugin,
} from '../electron/modules/mcp/plugins'
import { pluginRoot } from '../electron/core/plugin-loader'
import { ToolRegistry } from '../electron/core/tool-registry'
import { TASK_TOOLS } from '../electron/modules/tasks/tools'

let dirs: string[] = []
let dataDir: string

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-plugins-mgr-'))
  dirs.push(d)
  return d
}

beforeEach(() => {
  dirs = []
  dataDir = tmpDir()
})

afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

function makeZip(entries: Record<string, string | Buffer>): string {
  const zip = new AdmZip()
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8'))
  }
  const pkg = path.join(dataDir, 'pkg.ztool')
  zip.writeZip(pkg)
  return pkg
}

const VALID_MANIFEST = {
  id: 'http',
  name: 'HTTP 请求',
  version: '1.0.0',
  apiVersion: 1,
  entry: 'index.js',
  permissions: ['http:request'],
}

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const m = validateManifest(JSON.stringify(VALID_MANIFEST), 'test')
    expect(m.id).toBe('http')
    expect(m.permissions).toEqual(['http:request'])
  })

  it('rejects non-matching apiVersion', () => {
    expect(() =>
      validateManifest(JSON.stringify({ ...VALID_MANIFEST, apiVersion: 99 }), 'test'),
    ).toThrow(/apiVersion/)
  })

  it('rejects illegal ids (path traversal / weird chars)', () => {
    for (const bad of ['../evil', 'a/b', 'a b', 'a"b', '']) {
      expect(() => validateManifest(JSON.stringify({ ...VALID_MANIFEST, id: bad }), 'test')).toThrow(
        /id 非法/,
      )
    }
  })
})

describe('extractPluginZip', () => {
  it('extracts valid .ztool into agent-tools/<id>', () => {
    const pkg = makeZip({
      'ztool.json': JSON.stringify(VALID_MANIFEST),
      'index.js': 'module.exports = { tools: [] }',
    })
    const manifest = extractPluginZip(pkg, dataDir)
    expect(manifest.id).toBe('http')
    const target = path.join(pluginRoot(dataDir), 'http')
    expect(fs.existsSync(path.join(target, 'index.js'))).toBe(true)
  })

  it('rejects zip without ztool.json', () => {
    const pkg = makeZip({ 'foo.js': 'x' })
    expect(() => extractPluginZip(pkg, dataDir)).toThrow(/缺少 ztool.json/)
  })

  it('rejects zip containing path traversal entries', () => {
    const zip = new AdmZip()
    zip.addFile('ztool.json', Buffer.from(JSON.stringify(VALID_MANIFEST), 'utf-8'))
    zip.addFile('evil.txt', Buffer.from('pwned', 'utf-8'))
    // 直接改写 entry 名制造真实路径穿越条目（AdmZip 的 addFile 会净化 ../）
    zip.getEntries()[0].entryName = '../evil.txt'
    const pkg = path.join(dataDir, 'pkg-traversal.ztool')
    zip.writeZip(pkg)
    expect(() => extractPluginZip(pkg, dataDir)).toThrow(/非法路径|越界/)
  })
})

describe('listPlugins / uninstallPlugin', () => {
  it('lists installed plugins with tools/permissions', () => {
    const dir = path.join(pluginRoot(dataDir), 'http')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'ztool.json'), JSON.stringify(VALID_MANIFEST), 'utf-8')
    fs.writeFileSync(
      path.join(dir, 'index.js'),
      `module.exports = { tools: [{ key: 'http:request', name: 'http_request', label: 'HTTP', description: 'x', inputSchema: {}, run: () => 'ok' }] }`,
      'utf-8',
    )
    const plugins = listPlugins(dataDir)
    expect(plugins).toHaveLength(1)
    expect(plugins[0]).toMatchObject({ id: 'http', name: 'HTTP 请求', version: '1.0.0' })
    expect(plugins[0].permissions).toEqual(['http:request'])
    expect(plugins[0].tools[0].name).toBe('http_request')
  })

  it('skips corrupt manifest dirs without crashing', () => {
    const dir = path.join(pluginRoot(dataDir), 'broken')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'ztool.json'), 'not json', 'utf-8')
    expect(listPlugins(dataDir)).toEqual([])
  })

  it('uninstalls a plugin dir', () => {
    const dir = path.join(pluginRoot(dataDir), 'http')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'ztool.json'), JSON.stringify(VALID_MANIFEST), 'utf-8')
    expect(uninstallPlugin(dataDir, 'http')).toBe(true)
    expect(fs.existsSync(dir)).toBe(false)
    expect(uninstallPlugin(dataDir, 'http')).toBe(false) // 已不存在
  })

  it('rejects uninstall of traversal ids', () => {
    expect(() => uninstallPlugin(dataDir, '../evil')).toThrow(/id 非法/)
  })

  it('aggregates builtin registry tools as a non-removable builtin plugin', () => {
    const reg = new ToolRegistry()
    reg.registerAll(TASK_TOOLS)
    const plugins = listPlugins(dataDir, reg)
    expect(plugins[0]).toMatchObject({
      id: '__builtin__',
      name: '待办任务',
      builtin: true,
      dir: '',
    })
    expect(plugins[0].tools.length).toBe(TASK_TOOLS.length)
    expect(plugins[0].tools.some((t) => t.key === 'task:create')).toBe(true)
    // 内置聚合不可卸载
    expect(() => uninstallPlugin(dataDir, '__builtin__')).toThrow(/不可卸载/)
  })

  it('rejects uninstall of builtin file plugin (ztool.json builtin:true)', () => {
    const dir = path.join(pluginRoot(dataDir), 'http')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'ztool.json'),
      JSON.stringify({ ...VALID_MANIFEST, builtin: true }),
      'utf-8',
    )
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { tools: [] }', 'utf-8')
    expect(() => uninstallPlugin(dataDir, 'http')).toThrow(/不可卸载/)
    expect(fs.existsSync(dir)).toBe(true) // 未被删除
  })

  it('reports builtin flag on listed plugins', () => {
    const dir = path.join(pluginRoot(dataDir), 'http')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'ztool.json'),
      JSON.stringify({ ...VALID_MANIFEST, builtin: true }),
      'utf-8',
    )
    fs.writeFileSync(
      path.join(dir, 'index.js'),
      `module.exports = { tools: [{ key: 'http:request', name: 'http_request', label: 'HTTP', description: 'x', inputSchema: {}, run: () => 'ok' }] }`,
      'utf-8',
    )
    const plugins = listPlugins(dataDir)
    expect(plugins[0].builtin).toBe(true)
  })
})