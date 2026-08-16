import fs from 'fs'
import path from 'path'
import os from 'os'

// 独立进程无法使用 electron.app 定位数据目录，这里用与 data-location.ts 等价但
// 不依赖 Electron 的解析逻辑：读 data-location.json，否则回退到默认 userData。
// Electron 默认 userData = %APPDATA%/<app name>，app name 取自 package.json 的 name (zdn-notes)。
// 同时支持环境变量与显式 dataDir 参数覆盖，便于本机自定义。

const CONFIG_FILE = 'data-location.json'
const DB_ENTRY = 'zdn-notes.db'

export function defaultUserDataDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')
    return path.join(base, 'zdn-notes')
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'zdn-notes')
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'zdn-notes')
}

export function userDataConfigPath(): string {
  return path.join(defaultUserDataDir(), CONFIG_FILE)
}

export function readDataDirConfig(): string {
  try {
    const raw = JSON.parse(fs.readFileSync(userDataConfigPath(), 'utf-8')) as { path?: string }
    if (typeof raw.path === 'string' && raw.path.trim()) return raw.path
  } catch {
    /* 配置缺失或无效 */
  }
  return ''
}

export function resolveDataDir(): string {
  const fromEnv = process.env.ZDNOTES_DATA_DIR?.trim()
  if (fromEnv) return fromEnv
  const custom = readDataDirConfig()
  return custom || defaultUserDataDir()
}

export function resolveDbPath(overrides?: { dataDir?: string }): string {
  const dir = overrides?.dataDir?.trim() || resolveDataDir()
  return path.join(dir, DB_ENTRY)
}
