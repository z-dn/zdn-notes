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

// 硬性下限 0.1.5-rc.2：
//   1) dsh-subprocess-local 在此版本为 spawn 补了 windowsHide（pwsh 工具不再闪黑窗）
//   2) 0.1.5 起 web server 需要 ?token= 鉴权，GUI 已按完整 URL 访问，旧版降级会错配
//   3) 插件生态（如 @linxin666/dsh-web-all@0.3.6）要求 >=0.1.1-rc.1，此下限自然覆盖
// 打包产物低于该版本即缺失修复/功能，必须阻断发布。
const MIN_DSH_VERSION = '0.1.5-rc.2'

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

// cordis 核心五件套精确版本断言（事故门禁）。
// 背景：dsh@0.1.5-rc.2 对这五个包声明的是 ^ 浮动范围，全新构建（CI/release 无本地
// lockfile 缓存时）解析到 loader 1.0.5（Entry.init 不再 await fiber 激活）+
// hmr 1.0.19（新增 async *[Service.init]，激活需等 I/O）后，与 rc.2 runProfile 的
// 时序契约断层：watchUserPatches 读 ctx.get("hmr") 时 fiber 尚在 state 1，
// 打包版必报 "user patch-layer watching requires the Cordis HMR service" 并退出。
// 这些值与 resources/dsh/pnpm-lock.yaml 一致；升级 DSH 版本时若上游有意变更
// （如 dsh@0.1.5-rc.3 已自带精确钉同组版本），须同步更新本表与 lockfile。
const EXPECTED_RUNTIME = {
  cordis: '4.0.2',
  'cordis-plugin-loader': '1.0.3',
  'cordis-plugin-hmr': '1.0.17',
  'cordis-plugin-timer': '1.1.4',
  'cordis-plugin-include': '1.0.7',
}
const drifted = []
for (const [pkg, expected] of Object.entries(EXPECTED_RUNTIME)) {
  const pkgPath = join(base, 'node_modules', '@deepseek-ai', pkg, 'package.json')
  if (!existsSync(pkgPath)) {
    drifted.push(`${pkg}: 缺失（期望 ${expected}）`)
    continue
  }
  const actual = JSON.parse(readFileSync(pkgPath, 'utf8')).version
  if (actual !== expected) drifted.push(`${pkg}: ${actual}（期望 ${expected}）`)
}
if (drifted.length > 0) {
  console.error(
    `[check-dsh-package] FAIL: cordis 运行时版本漂移（基准目录 ${base}），与 pnpm-lock.yaml 不一致:`,
  )
  for (const d of drifted) console.error(`  - ${d}`)
  console.error(
    '[check-dsh-package] 请确认 resources/dsh/pnpm-lock.yaml 在位后重跑 npm run build:dsh 再重新打包。',
  )
  process.exit(1)
}

// vendor patch 门禁（v1.8.1 事故同款教训：产物静默丢修复必须阻断发布）。
// build-dsh.mjs 为 dsh-win32-process 的 CreateProcess 调用点补 CREATE_NO_WINDOW
// （0x08000000，pwsh 工具黑窗修复），最大值标记 134218756 = 1028|0x08000000。
// 上游修复 dsh-subprocess-local 时漏了本文件，patch 失去意义后再放宽本断言。
const win32ProcessPath = join(
  base,
  'node_modules',
  '@deepseek-ai',
  'dsh-win32-process',
  'lib',
  'index.js',
)
if (existsSync(win32ProcessPath)) {
  const win32Src = readFileSync(win32ProcessPath, 'utf8')
  if (!win32Src.includes('134218756')) {
    console.error(
      '[check-dsh-package] FAIL: dsh-win32-process 缺少 CREATE_NO_WINDOW vendor patch（pwsh 工具会闪黑窗）',
    )
    console.error('[check-dsh-package] 请重跑 npm run build:dsh 重新应用 patch。')
    process.exit(1)
  }
} else {
  console.error(`[check-dsh-package] FAIL: 未找到 ${win32ProcessPath}`)
  process.exit(1)
}

console.log(
  `[check-dsh-package] OK: ${base} 携带完整 DSH 运行时（v${dshVersion}，cordis 五件套已钉版，黑窗 patch 在位）`,
)
