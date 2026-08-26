// scripts/copy-dsh-runtime.cjs
// ===================================================================
// electron-builder afterPack 钩子：把 resources/dsh 整树拷入产物。
//
// 为什么不用 extraResources：app-builder-lib 的 createFilter 硬编码丢弃
// 复制源根级的 node_modules（util/filter.js），v1.8.1 发布包因此静默
// 缺失 DSH 入口。钩子直接 fs.cpSync，不经过该过滤器。
// ===================================================================

const { cpSync, existsSync, mkdirSync } = require('fs')
const { join } = require('path')

// 只携带运行必需项，排除本地开发残留（dsh-home/、install 日志等）
const RUNTIME_ENTRIES = ['node.exe', 'bin', 'node_modules', 'package.json', 'pnpm-lock.yaml']

module.exports = async function afterPack(context) {
  const src = join(context.packager.projectDir, 'resources', 'dsh')
  if (!existsSync(join(src, 'node.exe'))) {
    throw new Error(
      `[copy-dsh-runtime] 未找到 ${join(src, 'node.exe')}，请先运行 npm run build:dsh 再打包`,
    )
  }
  const dest = join(context.appOutDir, 'resources', 'dsh')
  mkdirSync(dest, { recursive: true })
  for (const entry of RUNTIME_ENTRIES) {
    const from = join(src, entry)
    if (!existsSync(from)) continue
    console.log(`[copy-dsh-runtime] ${from} -> ${join(dest, entry)}`)
    cpSync(from, join(dest, entry), { recursive: true })
  }
}
