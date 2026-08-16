// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const mocks = vi.hoisted(() => ({
  appPath: '',
  userData: '',
}))

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => mocks.appPath,
    getPath: () => mocks.userData,
  },
}))

import { ensureBuiltinPlugins, builtinPluginsSource, seedKeyFor } from '../electron/main/seed-plugins'
import { pluginRoot } from '../electron/core/plugin-loader'
import { getDB, initDB, closeDB } from '../electron/main/database'

let dirs: string[] = []
let dataDir: string
let appPath: string

function tmpDir(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'zdn-seed-'))
  dirs.push(d)
  return d
}

beforeEach(async () => {
  dirs = []
  dataDir = tmpDir()
  appPath = tmpDir()
  mocks.appPath = appPath
  mocks.userData = tmpDir()
  // 让主进程 getDataDir() 指向本测试数据目录
  fs.mkdirSync(mocks.userData, { recursive: true })
  fs.writeFileSync(
    path.join(mocks.userData, 'data-location.json'),
    JSON.stringify({ path: dataDir }),
    'utf-8',
  )
  await initDB()
})

afterEach(async () => {
  closeDB()
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true })
})

describe('builtinPluginsSource', () => {
  it('resolves to project resources in dev', () => {
    expect(builtinPluginsSource()).toBe(path.join(appPath, 'resources', 'agent-tools'))
  })
})

describe('ensureBuiltinPlugins', () => {
  it('seeds builtin http plugin on first run and marks seeded', () => {
    const src = path.join(appPath, 'resources', 'agent-tools', 'http')
    fs.mkdirSync(src, { recursive: true })
    fs.writeFileSync(path.join(src, 'ztool.json'), JSON.stringify({ id: 'http', builtin: true }), 'utf-8')
    fs.writeFileSync(path.join(src, 'index.js'), 'module.exports = { tools: [] }', 'utf-8')

    const seeded = ensureBuiltinPlugins(dataDir)
    expect(seeded).toBe(true)
    const dest = path.join(pluginRoot(dataDir), 'http')
    expect(fs.existsSync(path.join(dest, 'ztool.json'))).toBe(true)
    const settings = getDB().exec(`SELECT value FROM settings WHERE key = '${seedKeyFor('http')}'`)
    expect(settings[0].values[0][0]).toBe('true')
  })

  it('is idempotent: second run does not re-copy', () => {
    const src = path.join(appPath, 'resources', 'agent-tools', 'http')
    fs.mkdirSync(src, { recursive: true })
    fs.writeFileSync(path.join(src, 'ztool.json'), JSON.stringify({ id: 'http', builtin: true }), 'utf-8')
    fs.writeFileSync(path.join(src, 'index.js'), 'module.exports = { tools: [] }', 'utf-8')

    ensureBuiltinPlugins(dataDir)
    const dest = path.join(pluginRoot(dataDir), 'http')
    fs.writeFileSync(path.join(dest, 'index.js'), 'changed', 'utf-8')
    const seeded = ensureBuiltinPlugins(dataDir)
    expect(seeded).toBe(false)
    expect(fs.readFileSync(path.join(dest, 'index.js'), 'utf-8')).toBe('changed')
  })

  it('returns false when builtin source missing', () => {
    expect(ensureBuiltinPlugins(dataDir)).toBe(false)
  })
})