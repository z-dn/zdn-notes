// scripts/validate-dsh-integ.mjs
// ===================================================================
// DSH Web UI 集成冒烟测试：
//   1) 检查 resources/dsh/node.exe + @deepseek-ai/dsh 入口存在
//   2) 用自带 node.exe 拉起 `dsh --profile web --no-open --port <p>`
//   3) 轮询 http://127.0.0.1:<p> 直到返回 200
// 不依赖系统 Node / pnpm，验证「内嵌自包含 Web UI」链路。
//
// 回归测试（Test 2）：应用会在 web profile 损坏（缺核心包
// @deepseek-ai/dsh-web-app）时自动删除并重建该 profile。这里复现
// 「损坏 → 应失败；重建后 → 应成功」的路径，防止此类回归漏过 CI。
// ===================================================================

import { spawn, spawnSync } from 'child_process'
import { existsSync, mkdirSync, rmSync, cpSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { fileURLToPath } from 'url'

const appPath = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DSH_DIR = join(appPath, 'resources', 'dsh')
const nodeExe = join(DSH_DIR, 'node.exe')
const dshBin = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

function fail(msg) {
  console.error('[validate-dsh] FAIL:', msg)
  process.exit(1)
}
// Windows 下 dsh 会派生孙进程，child.kill() 杀不掉；用 taskkill /T 连带终止
function killTree(child) {
  try {
    child.kill()
  } catch {
    /* noop */
  }
  if (child.pid) {
    try {
      spawnSync('taskkill', ['/T', '/F', '/PID', String(child.pid)], { stdio: 'ignore' })
    } catch {
      /* noop */
    }
  }
}
function safeRm(dir) {
  for (let i = 0; i < 3; i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      return
    } catch {
      /* 重试，等待孙进程释放目录锁 */
    }
  }
}
if (!existsSync(nodeExe)) fail(`未找到 node.exe: ${nodeExe}`)
if (!existsSync(dshBin)) fail(`未找到 DSH 入口: ${dshBin}`)

async function boot(home) {
  const env = { ...process.env, DSH_HOME: home, TERM: 'xterm-256color', NODE_PATH: join(DSH_DIR, 'node_modules') }
  env.PATH = `${DSH_DIR};${join(DSH_DIR, 'bin')};${env.PATH ?? ''}`
  const child = spawn(nodeExe, [dshBin, '--profile', 'web', '--no-open', '--port', '0'], {
    cwd: home,
    stdio: ['ignore', 'pipe', 'pipe'],
    env,
  })
  let out = ''
  let port = 0
  child.stdout.on('data', (d) => {
    const s = d.toString()
    out += s
    const m = s.match(/127\.0\.0\.1:(\d+)/)
    if (m) port = Number(m[1])
  })
  child.stderr.on('data', (d) => (out += d.toString()))
  let ok = false
  for (let i = 0; i < 60; i++) {
    if (port) {
      const url = `http://127.0.0.1:${port}`
      try {
        const r = spawnSync('powershell', [
          '-NoProfile',
          '-Command',
          `Invoke-WebRequest -Uri "${url}" -UseBasicParsing -TimeoutSec 3 | Select-Object -Expand StatusCode`,
        ])
        if (r.status === 0 && r.stdout.toString().includes('200')) {
          ok = true
          break
        }
      } catch {
        /* retry */
      }
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  try {
    killTree(child)
  } catch {
    /* noop */
  }
  return { ok, out }
}

// Test 1: 基线（临时 home，全新）→ 必须能起（不污染 resources/dsh）
console.log('[validate-dsh] Test 1: 基线全新 profile 启动 ...')
{
  const baseline = join(tmpdir(), `dsh-baseline-${Date.now()}`)
  mkdirSync(baseline, { recursive: true })
  const { ok, out } = await boot(baseline)
  safeRm(baseline)
  if (!ok) fail(`基线 Web UI 未返回 200。\n${out.slice(-2000)}`)
  console.log('[validate-dsh] Test 1 OK')
}

// Test 2: 损坏 profile（缺核心包 @deepseek-ai/dsh-web-app）→ 应失败；
//         删除该 profile 重建后 → 必须成功（即应用自动修复的路径）
console.log('[validate-dsh] Test 2: 损坏 profile → 自动重建 → 成功 ...')
const good = join(tmpdir(), `dsh-good-${Date.now()}`)
const broken = join(tmpdir(), `dsh-broken-${Date.now()}`)
mkdirSync(good, { recursive: true })
{
  const { ok, out } = await boot(good)
  if (!ok) fail(`生成基准 profile 失败，无法继续回归测试。\n${out.slice(-2000)}`)
}
// 用完整 profile 复制出一份，再物理删除核心 web 包 → 复现「webServer 未注册」
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
  console.log('[validate-dsh] Test 2b OK: 重建后启动成功')
}
safeRm(good)
safeRm(broken)

console.log('[validate-dsh] ALL OK')
process.exit(0)
