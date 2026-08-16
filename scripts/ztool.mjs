#!/usr/bin/env node
// ===================================================================
// ztool — ZDNotes 插件打包/安装 CLI（P5）
//
// 用法：
//   node scripts/ztool.mjs init <dir> [id]              # 脚手架新插件
//   node scripts/ztool.mjs build <dir> [-o out.ztool]   # 校验并打包 .ztool
//   node scripts/ztool.mjs install <file.ztool> [dataDir]  # 解压到 agent-tools/
//   node scripts/ztool.mjs list <dataDir>               # 列出已安装插件
//
// 包格式：zip（内含 ztool.json + 入口 JS + 资源）。解压目录名 = 插件 id。
// ===================================================================

import fs from 'fs'
import path from 'path'
import os from 'os'
import AdmZip from 'adm-zip'

const PLUGIN_API_VERSION = 1
const MANIFEST = 'ztool.json'

function defaultUserDataDir() {
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'zdn-notes')
  }
  return path.join(os.homedir(), '.config', 'zdn-notes')
}

function resolveDataDir(dataDir) {
  if (dataDir) return dataDir
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(defaultUserDataDir(), 'data-location.json'), 'utf-8'))
    if (cfg.path && cfg.path.trim()) return cfg.path
  } catch {
    return defaultUserDataDir()
  }
}

function readManifest(pluginDir) {
  const file = path.join(pluginDir, MANIFEST)
  if (!fs.existsSync(file)) throw new Error(`缺少 ${MANIFEST}（插件清单）`)
  const manifest = JSON.parse(fs.readFileSync(file, 'utf-8'))
  if (!manifest.id || typeof manifest.id !== 'string') throw new Error('ztool.json 缺少 id')
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`apiVersion 应为 ${PLUGIN_API_VERSION}，当前 ${manifest.apiVersion}`)
  }
  return manifest
}

function initPlugin(dir, id) {
  const target = path.resolve(dir)
  if (!id) id = path.basename(target)
  fs.mkdirSync(target, { recursive: true })
  const manifest = {
    id,
    name: id,
    version: '1.0.0',
    apiVersion: PLUGIN_API_VERSION,
    entry: 'index.js',
    author: '',
    description: '新的 ZDNotes 插件',
    permissions: [],
  }
  const entry = `// ${id} 插件入口（运行于受限沙箱，只能使用 ctx 授权能力）
module.exports = {
  tools: [
    {
      key: '${id}:hello',
      name: '${id}_hello',
      label: 'Hello',
      description: '回显一条消息',
      inputSchema: {
        type: 'object',
        properties: { msg: { type: 'string', description: '消息内容' } },
      },
      run: async (ctx, args) => {
        return { ok: true, echo: args.msg ?? 'hello', pluginId: ctx.pluginId }
      },
    },
  ],
}
`
  fs.writeFileSync(path.join(target, MANIFEST), JSON.stringify(manifest, null, 2) + '\n', 'utf-8')
  fs.writeFileSync(path.join(target, 'index.js'), entry, 'utf-8')
  console.log(`已创建插件脚手架: ${target}`)
  console.log('编辑 ztool.json 与 index.js 后运行: node scripts/ztool.mjs build ' + target)
}

function buildPlugin(pluginDir, outFile) {
  const dir = path.resolve(pluginDir)
  const manifest = readManifest(dir)
  const entry = path.join(dir, manifest.entry || 'index.js')
  if (!fs.existsSync(entry)) throw new Error(`入口不存在: ${entry}`)

  const zip = new AdmZip()
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name)
    if (fs.statSync(full).isDirectory()) {
      zip.addLocalFolder(full, name)
    } else {
      zip.addLocalFile(full)
    }
  }
  const out = path.resolve(outFile || path.join(process.cwd(), `${manifest.id}.ztool`))
  zip.writeZip(out)
  console.log(`已打包: ${out}`)
  console.log(`插件: ${manifest.name} (${manifest.id}) v${manifest.version}`)
}

function installPlugin(pkg, dataDir) {
  const zip = new AdmZip(path.resolve(pkg))
  const entries = zip.getEntries()
  const manifestEntry = entries.find((e) => e.entryName === MANIFEST)
  if (!manifestEntry) throw new Error(`${pkg} 内缺少 ${MANIFEST}`)
  const manifest = JSON.parse(manifestEntry.getData().toString('utf-8'))
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new Error(`apiVersion 应为 ${PLUGIN_API_VERSION}`)
  }
  const target = path.join(resolveDataDir(dataDir), 'agent-tools', manifest.id)
  fs.mkdirSync(target, { recursive: true })
  zip.extractAllTo(target, true)
  console.log(`已安装到: ${target}`)
  console.log('若 GUI 正在运行，agent-tools 目录已热重载（无需重启）。')
}

function listPlugins(dataDir) {
  const root = path.join(resolveDataDir(dataDir), 'agent-tools')
  if (!fs.existsSync(root)) {
    console.log('未安装插件')
    return
  }
  for (const name of fs.readdirSync(root)) {
    const mf = path.join(root, name, MANIFEST)
    if (!fs.existsSync(mf)) continue
    try {
      const m = JSON.parse(fs.readFileSync(mf, 'utf-8'))
      console.log(`- ${m.name} (${m.id}) v${m.version}  tools=${m.tools?.length ?? 0}`)
    } catch {
      console.log(`- ${name}（ztool.json 无效）`)
    }
  }
}

const args = process.argv.slice(2)
const cmd = args[0]
const rest = args.slice(1)

function flagValue(name) {
  const i = rest.indexOf(name)
  return i >= 0 ? rest[i + 1] : undefined
}

try {
  switch (cmd) {
    case 'init':
      initPlugin(rest[0], rest[1])
      break
    case 'build':
      buildPlugin(rest[0], flagValue('-o'))
      break
    case 'install':
      installPlugin(rest[0], rest[1])
      break
    case 'list':
      listPlugins(rest[0])
      break
    case '--help':
    case '-h':
    case undefined:
      console.log(`
ztool — ZDNotes 插件 CLI
  用法:
    node scripts/ztool.mjs init <dir> [id]                 新建插件脚手架
    node scripts/ztool.mjs build <dir> [-o out.ztool]      校验并打包
    node scripts/ztool.mjs install <file.ztool> [dataDir]  安装插件
    node scripts/ztool.mjs list [dataDir]                  列出插件
`)
      break
    default:
      console.error(`未知命令: ${cmd}`)
      process.exit(1)
  }
} catch (e) {
  console.error('ztool:', e.message)
  process.exit(1)
}