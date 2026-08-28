// scripts/check-dsh-package.mjs
// ===================================================================
// 打包后完整性门禁：确认 win-unpacked 携带完整 DSH 运行时。
// 背景：electron-builder 会过滤复制源根级的 node_modules（util/filter.js），
// extraResources 方式曾致 v1.8.1 发布包静默缺失 DSH 入口。
// 用法: node scripts/check-dsh-package.mjs [unpackedResourcesDshDir]
// ===================================================================

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const appPath = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const base = process.argv[2] ?? join(appPath, 'release', 'win-unpacked', 'resources', 'dsh')

// 插件生态（如 @linxin666/dsh-web-all@0.3.6）要求 dsh >=0.1.1-rc.1，
// 打包产物低于该版本即静默丢失终端等插件功能，必须阻断发布。
const MIN_DSH_VERSION = '0.1.1-rc.1'

function verNum(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/)
  if (!m) return [0, 0, 0, 0]
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4] ?? 0)]
}
function gte(a, b) {
  const A = verNum(a)
  const B = verNum(b)
  for (let i = 0; i < 4; i++) {
    if (A[i] !== B[i]) return A[i] > B[i]
  }
  return true
}

const required = [
  'node.exe',
  join('bin', 'pnpm.exe'),
  join('node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
]

const missing = required.filter((p) => !existsSync(join(base, p)))
if (missing.length > 0) {
  console.error(`[check-dsh-package] FAIL: 打包产物缺少 DSH 运行时（基准目录 ${base}）:`)
  for (const m of missing) console.error(`  - ${m}`)
  console.error('[check-dsh-package] 请先运行 npm run build:dsh 再重新打包。')
  process.exit(1)
}

const dshPkgPath = join(base, 'node_modules', '@deepseek-ai', 'dsh', 'package.json')
if (!existsSync(dshPkgPath)) {
  console.error(`[check-dsh-package] FAIL: 未找到 ${dshPkgPath}`)
  process.exit(1)
}
const dshVersion = JSON.parse(readFileSync(dshPkgPath, 'utf8')).version
if (typeof dshVersion !== 'string' || !gte(dshVersion, MIN_DSH_VERSION)) {
  console.error(
    `[check-dsh-package] FAIL: DSH 运行时版本 ${dshVersion} 低于要求的 ${MIN_DSH_VERSION}` +
      '（插件生态如 dsh-web-all 依赖 >=0.1.1-rc.1）',
  )
  console.error('[check-dsh-package] 请用 DSH_VERSION 指定更高版本并重跑 npm run build:dsh。')
  process.exit(1)
}

console.log(`[check-dsh-package] OK: ${base} 携带完整 DSH 运行时（v${dshVersion}）`)
