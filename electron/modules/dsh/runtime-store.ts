import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs'
import { join } from 'path'
import { runtimeVersionDirName } from './runtime-policy'

export interface RuntimeStateEntry {
  version: string
  /** 相对用户运行时根目录的目录；版本目录为 versions/<v>，旧布局为 . */
  dir: string
  at: number
  vendorPatchApplied?: boolean
}

export interface RuntimeState {
  version: string
  dir: string
  at: number
  vendorPatchApplied?: boolean
  previous?: RuntimeStateEntry
}

export function activeStatePath(root: string): string {
  return join(root, 'active.json')
}

export function readVersionFromDir(dir: string): string | null {
  try {
    const pkg = JSON.parse(
      readFileSync(join(dir, 'node_modules', '@deepseek-ai', 'dsh', 'package.json'), 'utf8'),
    )
    return typeof pkg.version === 'string' ? pkg.version : null
  } catch {
    return null
  }
}

function readLegacyMeta(
  root: string,
): { version: string; at: number; vendorPatchApplied?: boolean } | null {
  try {
    const raw = readFileSync(join(root, 'zdn-runtime.json'), 'utf8')
    const m = JSON.parse(raw) as {
      version?: unknown
      at?: unknown
      vendorPatchApplied?: unknown
    }
    if (typeof m?.version !== 'string') return null
    return {
      version: m.version,
      at: typeof m.at === 'number' ? m.at : 0,
      vendorPatchApplied: m.vendorPatchApplied === true,
    }
  } catch {
    return null
  }
}

export function readRuntimeState(
  root: string,
  hasBin: (dir: string) => boolean,
): RuntimeState | null {
  try {
    const raw = readFileSync(activeStatePath(root), 'utf8')
    const s = JSON.parse(raw) as RuntimeState
    if (typeof s?.version === 'string' && typeof s?.dir === 'string' && hasBin(join(root, s.dir))) {
      return s
    }
  } catch {
    /* 没有/损坏 active.json：回退旧布局 */
  }
  if (!hasBin(root)) return null
  const meta = readLegacyMeta(root)
  const version = meta?.version ?? readVersionFromDir(root)
  if (!version) return null
  return {
    version,
    dir: '.',
    at: meta?.at ?? 0,
    vendorPatchApplied: meta?.vendorPatchApplied,
  }
}

export function writeRuntimeState(root: string, state: RuntimeState): void {
  mkdirSync(root, { recursive: true })
  const tmp = join(root, 'active.json.tmp')
  writeFileSync(tmp, JSON.stringify(state, null, 2))
  renameSync(tmp, activeStatePath(root))
}

/**
 * 旧版单目录布局（root/node_modules）迁入 versions/<v> 并写 active.json。
 * 返回迁移后的 state；无需迁移/失败返回 null。
 */
export function migrateLegacyRuntime(
  root: string,
  hasBin: (dir: string) => boolean,
): RuntimeState | null {
  if (existsSync(activeStatePath(root))) return null
  if (!hasBin(root)) return null
  if (existsSync(join(root, 'versions'))) return null
  const meta = readLegacyMeta(root)
  const version = meta?.version ?? readVersionFromDir(root)
  if (!version) return null
  const rel = join('versions', runtimeVersionDirName(version))
  const dest = join(root, rel)
  mkdirSync(dest, { recursive: true })
  for (const name of [
    'node_modules',
    'package.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'zdn-runtime.json',
  ]) {
    const from = join(root, name)
    if (existsSync(from)) renameSync(from, join(dest, name))
  }
  const state: RuntimeState = {
    version,
    dir: rel,
    at: meta?.at ?? Date.now(),
    vendorPatchApplied: meta?.vendorPatchApplied,
  }
  writeRuntimeState(root, state)
  return state
}
