import fs from 'fs'
import path from 'path'
import { app } from 'electron'
import { pluginRoot } from '../core/plugin-loader'
import { getAllSettings, setSetting } from './database/settings-dao'

// ===================================================================
// 内置插件 seed（首次启动播种）。
// 应用随包内置 `resources/agent-tools/http`（extraResources 打包到
// process.resourcesPath/agent-tools），首次启动复制到数据目录
// agent-tools/ 下，写入 settings 标记避免重复。
// 内置插件 ztool.json 标 builtin:true → 管理页不可卸载。
// ===================================================================

const SEED_KEY_PREFIX = 'plugins.seeded.'

/** 内置插件源目录（dev：项目根/resources；prod：process.resourcesPath/agent-tools） */
export function builtinPluginsSource(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'agent-tools')
  }
  return path.join(app.getAppPath(), 'resources', 'agent-tools')
}

function copyDir(srcDir: string, destDir: string): void {
  fs.mkdirSync(destDir, { recursive: true })
  for (const name of fs.readdirSync(srcDir)) {
    const src = path.join(srcDir, name)
    const stat = fs.statSync(src)
    if (stat.isDirectory()) {
      copyDir(src, path.join(destDir, name))
    } else {
      fs.copyFileSync(src, path.join(destDir, name))
    }
  }
}

/** 确保内置插件已 seed 到数据目录；返回本次是否执行了播种 */
export function ensureBuiltinPlugins(dataDir: string): boolean {
  const source = builtinPluginsSource()
  if (!fs.existsSync(source)) return false

  let seededAny = false
  for (const id of fs.readdirSync(source)) {
    const src = path.join(source, id)
    if (!fs.statSync(src).isDirectory()) continue
    const key = SEED_KEY_PREFIX + id
    const settings = getAllSettings()
    if (settings[key] === 'true') continue

    const dest = path.join(pluginRoot(dataDir), id)
    if (fs.existsSync(dest)) {
      // 已存在同名目录（如用户手动安装过）则视为已 seed
      setSetting(key, 'true')
      continue
    }
    copyDir(src, dest)
    setSetting(key, 'true')
    seededAny = true
    console.log(`[seed] 已播种内置插件: ${id}`)
  }
  return seededAny
}

export function seedKeyFor(id: string): string {
  return SEED_KEY_PREFIX + id
}