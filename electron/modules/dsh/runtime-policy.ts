import { rcompare, satisfies, valid as validSemver, validRange } from 'semver'

/** 当前 registry 上支持 Electron 43+ 的 addon；只用于版本目录的声明兼容性展示 */
export const ADDON_HOST_VERSION = '0.1.9'

export interface HostRuntimeInfo {
  electron: string | null
  node: string
  /** Electron 42 的 dsh-app-boot 需要运行期 internal-require 补丁 */
  appBootPatchRequired: boolean
}

export interface RuntimeVersionMeta {
  version: string
  publishedAt: number | null
  addonRange: string | null
  deprecated: string | null
  tags: string[]
  /** 宿主 Electron 的 addon 是否满足该版本声明；无声明为 null */
  hostAddonCompatible: boolean | null
}

export function electronMajor(version = process.versions.electron): number | null {
  const major = Number.parseInt(String(version ?? '').split('.')[0] ?? '', 10)
  return Number.isFinite(major) && major > 0 ? major : null
}

export function hostRuntimeInfo(electronVersion = process.versions.electron): HostRuntimeInfo {
  const major = electronMajor(electronVersion)
  return {
    electron: electronVersion || null,
    node: process.versions.node,
    appBootPatchRequired: major !== null && major < 43,
  }
}

/** 用户覆盖层清单 */
export function buildRuntimePackageJson(ref: string): Record<string, unknown> {
  return {
    name: 'zdn-dsh-runtime',
    private: true,
    type: 'module',
    dependencies: { '@deepseek-ai/dsh': ref },
  }
}

/** 版本目录名：只保留 semver 常见字符，杜绝路径穿越 */
export function runtimeVersionDirName(version: string): string {
  return version.replace(/[^0-9A-Za-z._+-]/g, '_')
}

export function isAddonRangeCompatible(
  addonRange: string | null | undefined,
  hostAddon: string | null,
): boolean | null {
  if (!addonRange || !hostAddon || !validRange(addonRange)) return null
  try {
    return satisfies(hostAddon, addonRange, { includePrerelease: true })
  } catch {
    return null
  }
}

/**
 * 推荐目标：显式锁定的版本优先；否则同 minor 最高未忽略版本；
 * 没有同 minor 候选时回退到 latest/next（仍然只返回未忽略版本）。
 * 返回值可能是 current 本身（表示已是最新）。
 */
export function pickRecommendedRuntime(opts: {
  current: string | null
  versions: RuntimeVersionMeta[]
  distTags: Record<string, string> | null
  pinned: string | null
  ignored: string[]
}): string | null {
  const { current, versions, distTags, pinned, ignored } = opts
  if (pinned && validSemver(pinned)) return pinned
  const ignoredSet = new Set(ignored)
  const available = versions
    .map((v) => v.version)
    .filter((v) => validSemver(v) && !ignoredSet.has(v))
  if (current && validSemver(current)) {
    const currentMinor = current.split('.').slice(0, 2).join('.')
    const sameMinor = available
      .filter((v) => v.split('.').slice(0, 2).join('.') === currentMinor)
      .sort(rcompare)
    if (sameMinor[0]) return sameMinor[0]
  }
  const tagged = [distTags?.latest, distTags?.next]
    .filter((v): v is string => !!v && !!validSemver(v) && !ignoredSet.has(v))
    .sort(rcompare)
  if (tagged[0]) return tagged[0]
  return available.sort(rcompare)[0] ?? null
}
