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
}

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    const m = validateManifest(JSON.stringify(VALID_MANIFEST), 'test')
    expect(m.id).toBe('http')
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
  it('lists installed plugins with tools', () => {
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

describe('插件依赖：清单校验 / 卸载保护 / 列表展示', () => {
  function writePluginDir(id: string, extra: Record<string, unknown> = {}): string {
    const dir = path.join(pluginRoot(dataDir), id)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'ztool.json'),
      JSON.stringify({ id, version: '1.0.0', apiVersion: 1, entry: 'index.js', ...extra }),
      'utf-8',
    )
    fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { tools: [] }', 'utf-8')
    return dir
  }

  it('validateManifest 接受合法 dependencies', () => {
    const m = validateManifest(
      JSON.stringify({ ...VALID_MANIFEST, dependencies: { b: '^1.0.0' } }),
      'test',
    )
    expect(m.dependencies).toEqual({ b: '^1.0.0' })
  })

  it('validateManifest 拒绝非法 dependencies', () => {
    expect(() =>
      validateManifest(JSON.stringify({ ...VALID_MANIFEST, dependencies: { http: '*' } }), 'test'),
    ).toThrow(/不能依赖自己/)
    expect(() =>
      validateManifest(JSON.stringify({ ...VALID_MANIFEST, dependencies: { b: 'abc' } }), 'test'),
    ).toThrow(/版本范围非法/)
  })

  it('卸载被依赖插件默认阻止并列出依赖方，force 可强制', () => {
    writePluginDir('core')
    writePluginDir('consumer', { dependencies: { core: '*' } })
    expect(() => uninstallPlugin(dataDir, 'core')).toThrow(/consumer 依赖此插件/)
    expect(fs.existsSync(path.join(pluginRoot(dataDir), 'core'))).toBe(true)
    expect(uninstallPlugin(dataDir, 'core', { force: true })).toBe(true)
    expect(fs.existsSync(path.join(pluginRoot(dataDir), 'core'))).toBe(false)
  })

  it('依赖方移除后可正常卸载被依赖插件', () => {
    writePluginDir('core')
    writePluginDir('consumer', { dependencies: { core: '*' } })
    expect(uninstallPlugin(dataDir, 'consumer')).toBe(true)
    expect(uninstallPlugin(dataDir, 'core')).toBe(true)
  })

  it('listPlugins 携带依赖/依赖方信息，缺依赖展示错误', () => {
    writePluginDir('core', { version: '1.5.0' })
    writePluginDir('consumer', { dependencies: { core: '^1.0.0' } })
    writePluginDir('lonely', { dependencies: { ghost: '*' } })
    const plugins = listPlugins(dataDir)
    const core = plugins.find((p) => p.id === 'core')
    const consumer = plugins.find((p) => p.id === 'consumer')
    const lonely = plugins.find((p) => p.id === 'lonely')
    expect(core?.dependencies).toBeUndefined()
    expect(core?.dependents).toEqual(['consumer'])
    expect(consumer?.dependencies).toEqual({ core: '^1.0.0' })
    expect(consumer?.error).toBeUndefined()
    expect(lonely?.error).toMatch(/缺少依赖: ghost/)
  })
})