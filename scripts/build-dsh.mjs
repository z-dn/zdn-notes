// scripts/build-dsh.mjs
// ===================================================================
// 预装 DSH（DeepSeek Harness）官方 Web UI 运行时到 resources/dsh：
//   - 自带 console-subsystem node.exe（与系统 Node 隔离）
//   - 用 pnpm --node-linker=hoisted 安装 @deepseek-ai/dsh（真实文件，便于打包）
//   - `dsh web` 是普通 HTTP 服务，无需 profile 初始化（不同于 TUI 方案）
//   - 自带 pnpm standalone exe（bin/pnpm.exe）：供运行期 `dsh plugin`
//     安装/卸载 profile 插件用（dsh plugin 是 pnpm 转发器，依赖 PATH）
//
// 用法: npm run build:dsh
//   DSH_NODE_VERSION 可覆盖 node 版本（默认 24）
//   DSH_PNPM_VERSION 可覆盖 pnpm 版本（默认 11.23.0）
//   DSH_FORCE 设为 1 强制重装
// ===================================================================

import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, copyFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const appPath = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DSH_DIR = join(appPath, 'resources', 'dsh')
const NODE_VERSION = process.env.DSH_NODE_VERSION || '24'
const PNPM_VERSION = process.env.DSH_PNPM_VERSION || '11.23.0'
const FORCE = process.env.DSH_FORCE === '1'

function run(cmd, args, opts) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
  if (r.status !== 0) {
    console.error(`\n[build-dsh] 命令失败: ${cmd} ${args.join(' ')} (exit ${r.status})`)
    process.exit(1)
  }
}

function findPnpm() {
  // 首选自带 standalone exe：真 .exe 不受 Node 对 .cmd 的 spawn 封锁（EINVAL），
  // 且 CI 无需预装 pnpm（downloadPnpm 已先行落位）
  const bundled = join(DSH_DIR, 'bin', 'pnpm.exe')
  if (process.platform === 'win32' && existsSync(bundled)) {
    if (spawnSync(bundled, ['--version'], { stdio: 'ignore' }).status === 0) return bundled
  }
  const sh = process.platform === 'win32' ? '.cmd' : ''
  const candidates = [`pnpm${sh}`, 'pnpm']
  for (const c of candidates) {
    if (spawnSync(c, ['--version'], { stdio: 'ignore' }).status === 0) return c
  }
  return null
}

function downloadNode() {
  const nodeExe = join(DSH_DIR, 'node.exe')
  if (existsSync(nodeExe) && !FORCE) {
    console.log('[build-dsh] node.exe 已存在，跳过下载')
    return
  }
  const arch = 'x64'
  const url = `https://nodejs.org/dist/v${NODE_VERSION}.0.0/node-v${NODE_VERSION}.0.0-win-${arch}.zip`
  console.log(`[build-dsh] 下载 Node v${NODE_VERSION}.0.0: ${url}`)
  const tmpZip = join(DSH_DIR, 'node.zip')
  if (process.platform === 'win32') {
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Invoke-WebRequest -Uri "${url}" -OutFile "${tmpZip}"`,
    ])
    console.log('[build-dsh] 解压 node.zip ...')
    const tmp = join(DSH_DIR, '_node_tmp')
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true })
    mkdirSync(tmp, { recursive: true })
    run('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -Force -Path "${tmpZip}" -DestinationPath "${tmp}"`,
    ])
    const inner = join(tmp, `node-v${NODE_VERSION}.0.0-win-${arch}`)
    copyFileSync(join(inner, 'node.exe'), nodeExe)
    rmSync(tmp, { recursive: true, force: true })
    rmSync(tmpZip, { force: true })
  } else {
    run('curl', ['-L', '-o', tmpZip, url])
    run('unzip', ['-o', tmpZip, '-d', DSH_DIR])
    const inner = join(DSH_DIR, `node-v${NODE_VERSION}.0.0-win-${arch}`)
    copyFileSync(join(inner, 'node.exe'), nodeExe)
    rmSync(inner, { recursive: true, force: true })
    rmSync(tmpZip, { force: true })
  }
  console.log('[build-dsh] node.exe 就绪')
}

function installDsh() {
  const nodeModules = join(DSH_DIR, 'node_modules')
  if (existsSync(nodeModules) && !FORCE) {
    console.log('[build-dsh] node_modules 已存在，跳过安装（DSH_FORCE=1 可强制）')
    ensurePkgJsonTypeModule()
    return
  }
  const pnpm = findPnpm()
  if (!pnpm) {
    console.error('[build-dsh] 未找到 pnpm，请先安装: npm i -g pnpm')
    process.exit(1)
  }
  console.log(`[build-dsh] 用 ${pnpm} 安装 @deepseek-ai/dsh (hoisted) ...`)
  rmSync(nodeModules, { recursive: true, force: true })
  const pkgJson = join(DSH_DIR, 'package.json')
  if (!existsSync(pkgJson)) {
    // type:module 消除 pnpm worker.js 的 MODULE_TYPELESS_PACKAGE_JSON 警告
    writeFileSync(
      pkgJson,
      JSON.stringify({ name: 'dsh-runtime', private: true, type: 'module' }, null, 2),
    )
  }
  // node-linker=hoisted：产生真实文件而非 symlink，便于 electron-builder 收集
  // ignore-scripts：dsh 树为预构建产物，且规避 pnpm≥11 的 build-scripts 拦截门
  run(pnpm, ['add', '@deepseek-ai/dsh', '--node-linker=hoisted', '--ignore-scripts'], {
    cwd: DSH_DIR,
    env: { ...process.env, npm_config_node_linker: 'hoisted' },
  })
  console.log('[build-dsh] DSH 安装完成')
}

/** 已存在的 package.json 只补 type 字段（不动 pnpm add 记录的 dependencies） */
function ensurePkgJsonTypeModule() {
  const pkgJson = join(DSH_DIR, 'package.json')
  if (!existsSync(pkgJson)) return
  try {
    const pkg = JSON.parse(readFileSync(pkgJson, 'utf8'))
    if (pkg.type !== 'module') {
      pkg.type = 'module'
      writeFileSync(pkgJson, JSON.stringify(pkg, null, 2))
    }
  } catch {
    /* 解析失败时保留原文件 */
  }
}

function downloadPnpm() {
  const binDir = join(DSH_DIR, 'bin')
  const dest = join(binDir, 'pnpm.exe')
  if (existsSync(dest) && !FORCE) {
    console.log('[build-dsh] pnpm.exe 已存在，跳过下载')
    return
  }
  // pnpm ≥11 的 release 资产是 zip（包含 pnpm.exe + dist/ + node_modules/），
  // pnpm.exe 启动时需要 dist/pnpm.mjs，需整体解压到 bin/ 目录。
  const url = `https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-win32-x64.zip`
  const tmpZip = join(binDir, 'pnpm.zip')
  console.log(`[build-dsh] 下载 pnpm v${PNPM_VERSION}: ${url}`)
  mkdirSync(binDir, { recursive: true })
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Invoke-WebRequest -Uri "${url}" -OutFile "${tmpZip}"`,
  ])
  console.log('[build-dsh] 解压 pnpm.zip ...')
  run('powershell', [
    '-NoProfile',
    '-Command',
    `Expand-Archive -Force -Path "${tmpZip}" -DestinationPath "${binDir}"`,
  ])
  rmSync(tmpZip, { force: true })
  if (!existsSync(dest)) {
    console.error(`[build-dsh] 解压后未找到 pnpm.exe: ${dest}`)
    process.exit(1)
  }
  console.log('[build-dsh] pnpm.exe 就绪')
}

function main() {
  mkdirSync(DSH_DIR, { recursive: true })
  downloadNode()
  // pnpm.exe 必须先于 installDsh 落位：findPnpm 首选它，CI 无系统 pnpm 也能装
  downloadPnpm()
  installDsh()
  console.log('\n[build-dsh] 完成。resources/dsh 已就绪（自包含 Web UI 运行时 + pnpm）。')
}

main()
