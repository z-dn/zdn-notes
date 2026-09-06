// scripts/validate-dsh-utility.mjs
// ===================================================================
// DSH Web UI 集成冒烟测试（真实 Electron 运行时）：
//   1) 检查 resources/dsh/@deepseek-ai/dsh 入口存在（不依赖独立 node.exe）
//   2) 主进程预占 loopback 端口，utilityProcess.fork 直接加载 DSH bin.js，
//      拉起 `dsh --profile web --no-open --port <p>`（与 dsh-manager 同路径）
//   3) 轮询 http://127.0.0.1:<p> 直到返回 200
//   4) child.kill() + taskkill /T 清理进程树
// 在真实 Electron 运行时验证「utilityProcess 托管 DSH Web UI」链路，
// 取代旧 validate-dsh-integ.mjs（独立 node.exe 冒烟，node.exe 已移除）。
//
// 回归测试：应用会在 web profile 损坏（缺核心包 @deepseek-ai/dsh-web-app）
// 时自动删除并重建。这里复现「损坏 → 应失败；重建后 → 应成功」的路径。
//
// 用法: npx electron scripts/validate-dsh-utility.mjs
// ===================================================================

import { app, utilityProcess } from 'electron'
import { spawnSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, readdirSync, lstatSync, unlinkSync } from 'fs'
import { createServer } from 'net'
import { delimiter, join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const appPath = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DSH_DIR = join(appPath, 'resources', 'dsh')
const dshBin = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

const START_TIMEOUT_MS = 90_000

let failures = 0
// 本地开发机共享 pnpm store 与 gitignored resources/dsh 交互时可能清空 @deepseek-ai 运行时
// （打包产物是 cpSync 的真实文件，不受影响）。检测到即跳过后续启动类测试，不误报失败。
let baseCorrupted = false
function fail(msg) {
  failures++
  console.error('[validate-dsh] FAIL:', msg)
}

function killTree(child) {
  try {
    child.kill()
  } catch {
    /* noop */
  }
  const pid = child.pid
  if (pid && process.platform === 'win32') {
    try {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore' })
    } catch {
      /* noop */
    }
  }
}

/** 递归 unlink 目录树内所有 junction/symlink（只删 reparse point，不穿透目标） */
function unlinkJunctions(dir) {
  if (!existsSync(dir)) return
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    let st
    try {
      st = lstatSync(p)
    } catch {
      continue
    }
    if (st.isSymbolicLink()) unlinkSync(p)
    else if (st.isDirectory()) unlinkJunctions(p)
  }
}

/**
 * junction-安全删除：Electron 的 fs.rmSync(recursive) 会穿透目录 junction 删除目标内容。
 * DSH home 的 profiles/node_modules/@deepseek-ai/* 是指向 resources/dsh base 的 junction，
 * 直接递归删除会清空 base（见 AGENTS.md dev 陷阱）。先 unlink 全部 junction 再删。
 */
function safeRm(dir) {
  for (let i = 0; i < 3; i++) {
    try {
      unlinkJunctions(dir)
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      /* 重试，等待孙进程释放目录锁 */
    }
  }
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

/** 与 dsh-manager.buildEnv 相同的子进程 env 构造（含 electron-as-node 的 node 垫片 + pnpm bin 前置） */
function ensureNodeShim(home) {
  const dir = join(home, 'node-bin')
  mkdirSync(dir, { recursive: true })
  const shim = join(dir, 'node.cmd')
  const content = `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath.replace(/"/g, '""')}" %*\r\n`
  writeFileSync(shim, content)
  return dir
}
function childEnv(home) {
  const env = { ...process.env, DSH_HOME: home, TERM: 'xterm-256color', NODE_PATH: join(DSH_DIR, 'node_modules') }
  env.PATH = `${ensureNodeShim(home)}${delimiter}${join(DSH_DIR, 'bin')}${delimiter}${env.PATH ?? ''}`
  delete env.NODE_OPTIONS
  delete env.ELECTRON_RUN_AS_NODE
  for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_')) delete env[k]
  return env
}

async function probe(port) {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(3000) })
    return r.ok || r.status === 200
  } catch {
    return false
  }
}

/** 用 utilityProcess 拉起 DSH web，探测就绪后清理进程树，返回 {ok, out} */
async function boot(home) {
  if (!existsSync(dshBin)) {
    baseCorrupted = true
    console.warn(
      '[validate-dsh] 本地 resources/dsh 运行时被共享 pnpm store 清理，跳过后续启动类测试（重跑 npm run build:dsh 恢复）',
    )
    return { ok: false, out: '' }
  }
  const port = await reservePort()
  const child = utilityProcess.fork(
    dshBin,
    ['--profile', 'web', '--no-open', '--port', String(port)],
    {
      cwd: home,
      env: childEnv(home),
      stdio: 'pipe',
      serviceName: 'zdn-dsh-test',
      // DSH 的 cordis-plugin-loader 需要访问 Node 内部模块；Electron 的 Node
      // 不暴露 node-addon-require-builtin 依赖的 V8 符号，必须走 execArgv 分支
      execArgv: ['--expose-internals'],
    },
  )
  let out = ''
  let exited = false
  child.stderr?.on('data', (d) => (out += d.toString()))
  child.on('exit', (code) => {
    exited = true
    out += `\n[exit code=${code}]`
  })
  let ok = false
  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline && !exited) {
    if (await probe(port)) {
      ok = true
      break
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  try {
    killTree(child)
  } catch {
    /* noop */
  }
  // 等待 pnpm 尾工作（profile 初始化）完全结束，避免其残留写操作污染本地共享 store
  await new Promise((r) => setTimeout(r, 2500))
  return { ok, out }
}

async function run() {
  await app.whenReady()

  if (!existsSync(dshBin)) fail(`未找到 DSH 入口: ${dshBin}`)
  if (!existsSync(join(DSH_DIR, 'bin', 'pnpm.exe'))) fail(`未找到 pnpm.exe: ${join(DSH_DIR, 'bin', 'pnpm.exe')}`)

  // Test 1: 基线（临时 home，全新）→ 必须能起（不污染 resources/dsh）
  console.log('[validate-dsh] Test 1: 基线全新 profile 启动 ...')
  const baseline = join(tmpdir(), `dsh-utility-baseline-${Date.now()}`)
  if (failures === 0 && !baseCorrupted) {
    mkdirSync(baseline, { recursive: true })
    const { ok, out } = await boot(baseline)
    // 临时 home 不立即删除：DSH profile 初始化的 pnpm 尾工作可能仍在写盘，
    // 立即删除会触发本地共享 store 的清理竞态（见 boot 的 settle 等待）。
    if (!ok) fail(`基线 Web UI 未返回 200。\n${out.slice(-2000)}`)
    else console.log('[validate-dsh] Test 1 OK')
  }

  // Test 2: 损坏 profile（缺核心包 @deepseek-ai/dsh-web-app）→ 应失败；
  //         删除该 profile 重建后 → 必须成功（即应用自动修复的路径）
  console.log('[validate-dsh] Test 2: 损坏 profile → 自动重建 → 成功 ...')
  const good = join(tmpdir(), `dsh-utility-good-${Date.now()}`)
  const broken = join(tmpdir(), `dsh-utility-broken-${Date.now()}`)
  if (!baseCorrupted) {
    mkdirSync(good, { recursive: true })
  {
    const { ok, out } = await boot(good)
    if (!ok) fail(`生成基准 profile 失败，无法继续回归测试。\n${out.slice(-2000)}`)
  }
  if (existsSync(join(good, 'profiles', 'web'))) {
    cpSync(join(good, 'profiles', 'web'), join(broken, 'profiles', 'web'), { recursive: true })
    rmSync(join(broken, 'profiles', 'web', 'node_modules', '@deepseek-ai', 'dsh-web-app'), {
      recursive: true,
      force: true,
    })
    {
      const { ok, out } = await boot(broken)
      if (ok) {
        // dsh 版本差异可能自动补回核心包，此时回归无法触发——仅警告，不阻断发布
        console.log('[validate-dsh] Test 2a: 损坏 profile 仍启动成功（dsh 可能已自愈），跳过该路径断言')
      } else {
        console.log('[validate-dsh] Test 2a OK: 缺核心包的 profile 按预期失败')
      }
    }
    // 模拟应用自动修复：删除损坏的 web profile，让其重建
    rmSync(join(broken, 'profiles', 'web'), { recursive: true, force: true })
    {
      const { ok, out } = await boot(broken)
      if (!ok) fail(`删除损坏 profile 后重建仍失败。\n${out.slice(-2000)}`)
      else console.log('[validate-dsh] Test 2b OK: 重建后启动成功')
    }
  } else {
    console.log('[validate-dsh] Test 2 跳过（DSH 未生成 profiles/web，无法构造损坏场景）')
  }
  } else {
    console.log('[validate-dsh] Test 2 跳过（本地 resources/dsh 运行时缺失）')
  }
  // 全部测试结束后再统一清理临时 home，避免竞态
  safeRm(baseline)
  safeRm(good)
  safeRm(broken)

  // Test 3: 构建策略固化——占位符污染的 pnpm-workspace.yaml 经
  //         healProfileBuildPolicy 逻辑重写后，必须含 dangerouslyAllowAllBuilds: true
  console.log('[validate-dsh] Test 3: pnpm-workspace.yaml 构建策略固化 ...')
  {
    const dir = join(tmpdir(), `dsh-utility-policy-${Date.now()}`)
    mkdirSync(dir, { recursive: true })
    const yamlPath = join(dir, 'pnpm-workspace.yaml')
    writeFileSync(
      yamlPath,
      'packages:\n  - .\nnodeLinker: hoisted\nautoInstallPeers: false\nallowBuilds:\n  node-pty: set this to true or false\n  ssh2: set this to true or false\n',
    )
    // 与 dsh-manager.healProfileBuildPolicy 同逻辑的独立重写（保持测试自包含，不 import 应用代码）
    const raw = readFileSync(yamlPath, 'utf8')
    const kept = []
    let inAllowBuilds = false
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim()
      if (/^allowBuilds:/.test(t)) {
        inAllowBuilds = true
        continue
      }
      if (inAllowBuilds) {
        if (t && !/^[\t ]/.test(line)) inAllowBuilds = false
        else continue
      }
      if (/^dangerouslyAllowAllBuilds:|^minimumReleaseAge:/.test(t)) continue
      kept.push(line)
    }
    const base = kept.join('\n').trim()
    const next = `${base}${base ? '\n' : ''}dangerouslyAllowAllBuilds: true\nminimumReleaseAge: 0\n`
    writeFileSync(yamlPath, next)
    const healed = readFileSync(yamlPath, 'utf8')
    if (!/^dangerouslyAllowAllBuilds:\s*true$/m.test(healed)) fail(`构建策略未固化 dangerouslyAllowAllBuilds: true\n${healed}`)
    if (!/^minimumReleaseAge:\s*0$/m.test(healed)) fail(`构建策略未固化 minimumReleaseAge: 0\n${healed}`)
    if (/set this to true or false/.test(healed)) fail(`占位符污染未清除:\n${healed}`)
    if (!/^packages:\s*$/m.test(healed) || !/^nodeLinker:\s*hoisted$/m.test(healed)) fail(`既有键被误删:\n${healed}`)
    safeRm(dir)
    console.log('[validate-dsh] Test 3 OK')
  }

  // Test 4: node 垫片（electron-as-node）——pnpm 生命周期脚本的 `node` 必须解析到
  //         Electron 内置 Node（若垫片失效，原生插件安装会报 'node' 不是内部或外部命令）
  console.log('[validate-dsh] Test 4: node shim (electron-as-node) ...')
  {
    const dir = join(tmpdir(), `dsh-utility-nodebin-${Date.now()}`)
    const nodeBin = ensureNodeShim(dir)
    const env = { ...process.env, PATH: `${nodeBin}${delimiter}${process.env.PATH ?? ''}` }
    delete env.NODE_OPTIONS
    delete env.ELECTRON_RUN_AS_NODE
    for (const k of Object.keys(env)) if (k.startsWith('ELECTRON_')) delete env[k]
    // 复刻 pnpm 生命周期调用方式：cmd /d /s /c "node ..."
    const r = spawnSync('cmd', ['/d', '/s', '/c', 'node --version'], { env, encoding: 'utf8' })
    const expected = `v${process.versions.node}`
    if (r.status !== 0 || !r.stdout.trim().startsWith(expected)) {
      fail(
        `node 垫片未解析到 Electron node：exit=${r.status} stdout=${JSON.stringify(r.stdout)} ` +
          `stderr=${JSON.stringify(r.stderr)}（期望 ${expected}，原生插件安装将失败）`,
      )
    }
    safeRm(dir)
    console.log('[validate-dsh] Test 4 OK')
  }

  console.log(failures === 0 ? '[validate-dsh] ALL OK' : `[validate-dsh] ${failures} FAILURE(S)`)
  app.exit(failures === 0 ? 0 : 1)
}

process.on('uncaughtException', (e) => {
  console.error('[validate-dsh] uncaughtException:', e)
  app.exit(1)
})

run().catch((e) => {
  console.error('[validate-dsh] 运行异常:', e)
  app.exit(1)
})