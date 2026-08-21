// scripts/validate-dsh-integ.mjs
// ===================================================================
// DSH Web UI 集成冒烟测试：
//   1) 检查 resources/dsh/node.exe + @deepseek-ai/dsh 入口存在
//   2) 用自带 node.exe 拉起 `dsh --profile web --no-open --port <p>`
//   3) 轮询 http://127.0.0.1:<p> 直到返回 200
// 不依赖系统 Node / pnpm，验证「内嵌自包含 Web UI」链路。
// ===================================================================

import { spawn, spawnSync } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const appPath = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DSH_DIR = join(appPath, 'resources', 'dsh')
const nodeExe = join(DSH_DIR, 'node.exe')
const dshBin = join(DSH_DIR, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')

function fail(msg) {
  console.error('[validate-dsh] FAIL:', msg)
  process.exit(1)
}

if (!existsSync(nodeExe)) fail(`未找到 node.exe: ${nodeExe}`)
if (!existsSync(dshBin)) fail(`未找到 DSH 入口: ${dshBin}`)

console.log('[validate-dsh] 启动 dsh --profile web (--port 0, OS 选端口) ...')
const child = spawn(nodeExe, [dshBin, '--profile', 'web', '--no-open', '--port', '0'], {
  cwd: DSH_DIR,
  stdio: ['ignore', 'pipe', 'pipe'],
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
for (let i = 0; i < 40; i++) {
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

child.kill()
if (!ok) {
  fail(`Web UI 未在 http://127.0.0.1:${port} 返回 200。\n输出:\n${out.slice(-2000)}`)
}
console.log(`[validate-dsh] OK: Web UI 在 http://127.0.0.1:${port} 正常返回 200`)
process.exit(0)
