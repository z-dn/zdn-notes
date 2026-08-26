// scripts/check-dsh-package.mjs
// ===================================================================
// 打包后完整性门禁：确认 win-unpacked 携带完整 DSH 运行时。
// 背景：electron-builder 会过滤复制源根级的 node_modules（util/filter.js），
// extraResources 方式曾致 v1.8.1 发布包静默缺失 DSH 入口。
// 用法: node scripts/check-dsh-package.mjs [unpackedResourcesDshDir]
// ===================================================================

import { existsSync } from 'fs'
import { join } from 'path'
import { fileURLToPath } from 'url'

const appPath = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const base = process.argv[2] ?? join(appPath, 'release', 'win-unpacked', 'resources', 'dsh')

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
console.log(`[check-dsh-package] OK: ${base} 携带完整 DSH 运行时`)
