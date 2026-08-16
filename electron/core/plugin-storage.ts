import fs from 'fs'
import path from 'path'
import type { PluginStorage } from './contracts'

// ===================================================================
// 插件 KV 存储：按插件 id 作用域隔离，持久化到
// <dataDir>/agent-tools/<pluginId>/storage.json。
// 仅供插件工具在授权范围内使用（不进主库，避免第三方污染 tasks/settings）。
// ===================================================================

export function pluginStorageFile(dataDir: string, pluginId: string): string {
  return path.join(dataDir, 'agent-tools', pluginId, 'storage.json')
}

export function createPluginStorage(dataDir: string, pluginId: string): PluginStorage {
  const file = pluginStorageFile(dataDir, pluginId)

  function read(): Record<string, unknown> {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf-8')) as Record<string, unknown>
      return raw
    } catch {
      return {}
    }
  }

  function write(data: Record<string, unknown>): void {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8')
    } catch {
      /* 只读目录时忽略 */
    }
  }

  return {
    get(key) {
      return read()[key]
    },
    set(key, value) {
      const data = read()
      data[key] = value
      write(data)
    },
    delete(key) {
      const data = read()
      delete data[key]
      write(data)
    },
    clear() {
      write({})
    },
    keys() {
      return Object.keys(read())
    },
  }
}