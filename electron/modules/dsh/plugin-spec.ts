// ===================================================================
// DSH 插件管理的纯逻辑部分：spec 校验 + profile 依赖解析。
// 独立成模块便于单元测试（不依赖 electron）。
//
// 背景见 docs/dsh-integration-plan.md 插件管理节：
// `dsh plugin add/remove` 是 pnpm 转发器，对账逻辑保证「用户装的插件
// = profile package.json 的 dependencies」（模板内置 bundle 不进依赖）。
// ===================================================================

import { join } from 'path'
import { load, FAILSAFE_SCHEMA } from 'js-yaml'
import { Range, rcompare, satisfies, valid, validRange } from 'semver'

export interface DshPluginInfo {
  name: string
  version: string
}

/**
 * 校验插件标识（npm 包名 / name@version / github:owner/repo / 本地路径 spec）。
 * 作为单个 argv 元素原样转发给 CLI，因此只需拒绝：
 * 空串、以 - 开头（防被当 flag）、以及空白/引号/控制字符（防参数注入）。
 */
export function isValidPluginSpec(spec: string): boolean {
  if (!spec || spec.length > 300) return false
  if (spec.startsWith('-')) return false
  // 允许：字母数字 @ / . : + ~ - _ #（覆盖 scope 名、版本段、github: 协议、file: 相对路径、
  //       git URL fragment 如 github:owner/repo#path:/packages/sub）
  return /^[A-Za-z0-9@/.:+~#_-]+$/.test(spec)
}

/**
 * 从 profile 目录的 package.json 原文解析已安装插件列表。
 * 只取 dependencies（devDependencies 不是 `dsh plugin add` 的产物）。
 * 解析失败抛错，由调用方包装为失败结果。
 */
export function parseInstalledPlugins(raw: string): DshPluginInfo[] {
  const pkg = JSON.parse(raw) as { dependencies?: Record<string, string> }
  return Object.entries(pkg.dependencies ?? {})
    .map(([name, version]) => ({ name, version: version ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 从 pnpm 错误输出解析所有被拦截 build scripts 的包名。
 * 输入示例："Ignored build scripts: cloudflared@0.7.3, cpu-features@0.0.10"
 * 输出：["cloudflared", "cpu-features"]（去掉版本号，@scope/name 安全），去重。
 * 无匹配时返回空数组。
 */
export function parseIgnoredBuildPackages(stderr: string): string[] {
  const m = stderr.match(/Ignored build scripts:\s*([^\n]+)/)
  if (!m) return []
  return [
    ...new Set(
      m[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pkg) => {
          // lastIndexOf 保证 @scope/name 只去掉尾部版本号
          const i = pkg.lastIndexOf('@')
          return i > 0 ? pkg.slice(0, i) : pkg
        }),
    ),
  ]
}

/**
 * 单锚点判定：该目录下的包能否作为一个合法的 bundle 层。
 * 除声明 `dsh.bundle.patch` 外，还要求声明的 patch 文件**真实存在**——
 * DSH `loadOverlayPatches` 对 bundle 声明的 overlay 文件做硬读取，缺失即
 * 启动硬崩（dsh-opencode-zen 事故：上游 `files: ["lib"]` 把 cordis.patch.yml
 * 过滤掉了）。声明在而文件缺失视为不可解析，由 computeBundleSync 剔出 bundles。
 * 读坏 package.json 视为不可解析。
 */
export function isBundleAnchorResolvable(
  pkgDir: string,
  readText: (p: string) => string | null,
  exists: (p: string) => boolean,
): boolean {
  const raw = readText(join(pkgDir, 'package.json'))
  if (raw === null) return false
  try {
    const pkg = JSON.parse(raw) as { dsh?: { bundle?: { patch?: unknown } } }
    const patch = pkg.dsh?.bundle?.patch
    if (typeof patch !== 'string' || !patch) return false
    return exists(join(pkgDir, patch))
  } catch {
    return false
  }
}

/**
 * 双向对齐 bundles 层列表与依赖账本（根治「pnpm 失败后 reconcile 未执行」
 * 留下的半成品状态：依赖已记录但 bundle 层缺失 → DSH 不加载）。
 *
 * 规则（isResolvableBundle 与 DSH resolveBundleDir 语义一致：
 * profile/node_modules 或安装目录/node_modules 任一锚点可解析出 dsh.bundle
 * 声明、且声明的 patch 文件真实存在）：
 * - 追加：依赖包可解析且不在 bundles → 加入
 * - 移除：bundles 条目已不可解析（含 remove 失败留下的脏条目）→ 剔除
 * - 保留：内置 bundle（dsh-base/dsh-web-app 等）经安装目录锚点解析成功，永不误删
 */
export function computeBundleSync(
  currentBundles: string[],
  deps: Record<string, unknown>,
  isResolvableBundle: (name: string) => boolean,
): { bundles: string[]; changed: boolean } {
  let changed = false
  const result = [...currentBundles]
  for (const name of Object.keys(deps)) {
    if (isResolvableBundle(name) && !result.includes(name)) {
      result.push(name)
      changed = true
    }
  }
  const kept = result.filter((name) => {
    const ok = isResolvableBundle(name)
    if (!ok) changed = true
    return ok
  })
  return { bundles: kept, changed }
}

/** web profile 必须声明的核心 bundle（webServer 服务来源；缺失即 v1.8.2 损坏） */
export const CORE_WEB_BUNDLE = '@deepseek-ai/dsh-web-app'

/**
 * 判定 web profile 是否需要「删掉重建」（自愈触发条件）。
 *
 * 只依据 manifest（package.json 的 dsh.profile.bundles），不查物理 node_modules：
 * 在此部署下核心包经 junction 回退层解析，`profiles/web/node_modules` 永远不存在，
 * 按物理路径判断会恒真误删用户插件。仅当 bundles 缺失核心 web 包（真·v1.8.2
 * 损坏）或 manifest 不可读时才需要重建。
 */
export function shouldRebuildWebProfile(raw: string | null): boolean {
  if (!raw) return true
  try {
    const manifest = JSON.parse(raw) as { dsh?: { profile?: { bundles?: string[] } } }
    const bundles = manifest.dsh?.profile?.bundles
    if (!Array.isArray(bundles)) return true
    return !bundles.includes(CORE_WEB_BUNDLE)
  } catch {
    return true
  }
}

/**
 * 安装前后依赖集 diff，得出本次新增的包名（github: spec 安装后落盘的是
 * 包真实 name，无法从 spec 反推，只能 diff）。before 为 null（profile 不存在）
 * 时返回空数组——首次初始化不回滚模板依赖。
 */
export function findNewDependencies(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): string[] {
  if (before === null) return []
  return Object.keys(after).filter((name) => !(name in before))
}

/**
 * 在预检失败输出里匹配本次新增的包名（输出含包路径/包名即视为失败与之相关）。
 * 返回命中的包名（按 newDeps 顺序），无命中返回空数组。
 */
export function matchCulprit(newDeps: string[], output: string): string[] {
  if (!output) return []
  return newDeps.filter((name) => output.includes(name))
}

// ===================================================================
// 插件安全门（v1.9+，dsh-opencode-zen / dsh-llm 被误装事故驱动）：
// G1 安装前兼容性预检 + G2 安装后复核（peer/重复 patch id）+ G3 import 预检
// + S 启动崩溃自动隔离。纯逻辑集中在此，便于单测（不依赖 electron）。
// ===================================================================

export type ClassifiedPluginSpec =
  { kind: 'registry'; name: string; version?: string } | { kind: 'other' }

/**
 * 把插件 spec 分类：registry（可查 npm registry 做预检）/ other（github:/file: 等）。
 * registry 形态：`[@scope/]name` 可选 `@version|@tag`；含 :（协议）、/（路径）等一律 other。
 */
export function classifyPluginSpec(spec: string): ClassifiedPluginSpec {
  const m = spec.match(/^((?:@[A-Za-z0-9][\w.-]*\/)?[A-Za-z0-9][\w.-]*)(?:@(.+))?$/)
  if (!m) return { kind: 'other' }
  return m[2] ? { kind: 'registry', name: m[1], version: m[2] } : { kind: 'registry', name: m[1] }
}

/** 插件声明 DSH 版本要求的 4 个候选键（按优先级），全部未声明返回 null */
export function dshRequirementOf(manifest: {
  dsh?: { engines?: { dsh?: unknown }; compatibility?: { dsh?: unknown } }
  engines?: { dsh?: unknown }
  peerDependencies?: Record<string, string>
}): string | null {
  const candidates = [
    manifest.dsh?.engines?.dsh,
    manifest.engines?.dsh,
    manifest.peerDependencies?.['@deepseek-ai/dsh'],
    manifest.dsh?.compatibility?.dsh,
  ]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
  }
  return null
}

export interface CompatCheckOptions {
  /** 插件 package.json（registry manifest 或已落盘安装 manifest） */
  manifest: Record<string, unknown>
  /** 当前内置 DSH 版本；null = 不可用（跳过 DSH 版本检查，fail-open） */
  dshVersion: string | null
  /** 当前运行时 Node 版本（process.versions.node） */
  nodeVersion: string
  /** 从运行时（base/profile node_modules）解析 @deepseek-ai/* peer 的实际版本；不可解析返回 null（fail-open） */
  resolveRuntimePackageVersion: (pkgName: string) => string | null
}

/**
 * G1/G2 兼容性检查：DSH 版本要求（4 键回退）、engines.node、@deepseek-ai/* peer 范围。
 * 返回问题描述列表；空数组 = 通过。规则：
 * - 声明了范围但拿不到实际版本 → 跳过该项（fail-open，交给 pnpm/预检）
 * - 范围语法无效 → 跳过（fail-open）
 * - 范围有效且实际版本不满足 → 记为问题（fail-closed）
 */
export function checkPluginCompatibility(opts: CompatCheckOptions): string[] {
  const issues: string[] = []
  const m = opts.manifest as {
    engines?: { node?: unknown }
    peerDependencies?: Record<string, string>
  } & Parameters<typeof dshRequirementOf>[0]

  const dshRange = dshRequirementOf(m)
  if (dshRange && opts.dshVersion && validRange(dshRange)) {
    if (!satisfies(opts.dshVersion, dshRange, { includePrerelease: true })) {
      issues.push(`插件要求 DSH ${dshRange}，当前内置 DSH 为 ${opts.dshVersion}`)
    }
  }

  const nodeRange = typeof m.engines?.node === 'string' ? m.engines.node.trim() : ''
  if (
    nodeRange &&
    validRange(nodeRange) &&
    !satisfies(opts.nodeVersion, nodeRange, { includePrerelease: true })
  ) {
    issues.push(`插件要求 Node ${nodeRange}，当前运行时为 ${opts.nodeVersion}`)
  }

  for (const [name, range] of Object.entries(m.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/')) continue
    const actual = opts.resolveRuntimePackageVersion(name)
    if (!actual || !validRange(range)) continue
    if (!satisfies(actual, range, { includePrerelease: true })) {
      issues.push(`插件依赖 ${name}@${range}，当前运行时为 ${actual}`)
    }
  }
  return issues
}

export interface PatchEntry {
  id: string
  name?: string
}

/**
 * 从 cordis.patch.yml 原文收集所有 loader entry（insert 列表 + 顶层条目）的 id/name。
 * 解析前剥离 `!!js/...` 标签（FAILSAFE_SCHEMA 不认识自定义标签；提取 id 不需要函数体）。
 * YAML 解析失败返回空数组（name 映射不可用时调用方跳过依赖 name 的路径）。
 */
export function collectPatchEntries(patchText: string): PatchEntry[] {
  const cleaned = patchText.replace(/!!js\/\S+/g, '')
  const entries: PatchEntry[] = []
  try {
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk)
        return
      }
      if (node && typeof node === 'object') {
        const obj = node as Record<string, unknown>
        if (typeof obj.id === 'string' && obj.id) {
          entries.push({ id: obj.id, name: typeof obj.name === 'string' ? obj.name : undefined })
        }
        if (Array.isArray(obj.insert)) walk(obj.insert)
      }
    }
    walk(load(cleaned, { schema: FAILSAFE_SCHEMA }))
    return entries
  } catch {
    return []
  }
}

/** 收集 patch 里全部 entry id（去重）。YAML 解析失败时退化为行扫描兜底。 */
export function collectPatchEntryIds(patchText: string): string[] {
  const entries = collectPatchEntries(patchText)
  if (entries.length > 0) return [...new Set(entries.map((e) => e.id))]
  const ids = new Set<string>()
  for (const line of patchText.split(/\r?\n/)) {
    const m = line.match(/^\s*(?:-\s*)?id:\s*['"]?([A-Za-z0-9@/._-]+)['"]?\s*(?:#.*)?$/)
    if (m) ids.add(m[1])
  }
  return [...ids]
}

export interface BootFailure {
  kind: 'import' | 'apply' | 'pending'
  /** loader entry id（可直接隔离；pending 类只有 name） */
  entryId?: string
  /** insert 的 name（可能带子路径，如 @scope/pkg/sub） */
  entryName?: string
  /** pending 类等待的服务名 */
  service?: string
  detail: string
}

/**
 * 从启动 stderr 解析可归因到具体插件 entry 的失败。
 * 形态（见 v1.8.2 / dsh-opencode-zen 事故）：
 * 1. failed to import loader entry <id> (<name>)     —— 模块导入失败
 * 2. failed to apply loader entry <id> (<name>)      —— entry 激活失败（排除 cordis Include 包装层）
 * 3. <name>: pending (waiting for service: <svc>)     —— 服务缺失挂起
 * 无法归因到 entry 时返回 null（不隔离，走既有端口重试/报错路径）。
 */
export function parseBootFailure(stderr: string): BootFailure | null {
  if (!stderr) return null
  let m = stderr.match(/failed to import loader entry (\S+) \(([^)]+)\)/)
  if (m) return { kind: 'import', entryId: m[1], entryName: m[2], detail: m[0] }
  m = stderr.match(/failed to apply loader entry (\S+) \(([^)]+)\)/)
  if (m && !(m[1] === 'include' && m[2] === 'cordis:include')) {
    return { kind: 'apply', entryId: m[1], entryName: m[2], detail: m[0] }
  }
  m = stderr.match(/(\S+): pending \(waiting for ([^)]+)\)/)
  if (m) {
    const waiting = m[2]
    return {
      kind: 'pending',
      entryName: m[1],
      service: waiting.startsWith('service:') ? waiting.slice(8).trim() : waiting,
      detail: m[0],
    }
  }
  return null
}

/** parseBootFailure 的多命中版本：用于升级预演完整列出所有加载失败的 entry。 */
export function parseBootFailures(stderr: string): BootFailure[] {
  if (!stderr) return []
  const out: BootFailure[] = []
  const seen = new Set<string>()
  const push = (failure: BootFailure, key: string): void => {
    if (seen.has(key)) return
    seen.add(key)
    out.push(failure)
  }
  let m: RegExpExecArray | null
  const importRe = /failed to import loader entry (\S+) \(([^)]+)\)/g
  while ((m = importRe.exec(stderr))) {
    push({ kind: 'import', entryId: m[1], entryName: m[2], detail: m[0] }, `import:${m[1]}`)
  }
  const applyRe = /failed to apply loader entry (\S+) \(([^)]+)\)/g
  while ((m = applyRe.exec(stderr))) {
    if (m[1] === 'include' && m[2] === 'cordis:include') continue
    push({ kind: 'apply', entryId: m[1], entryName: m[2], detail: m[0] }, `apply:${m[1]}`)
  }
  const pendingRe = /(\S+): pending \(waiting for ([^)]+)\)/g
  while ((m = pendingRe.exec(stderr))) {
    const waiting = m[2]
    push(
      {
        kind: 'pending',
        entryName: m[1],
        service: waiting.startsWith('service:') ? waiting.slice(8).trim() : waiting,
        detail: m[0],
      },
      `pending:${m[1]}`,
    )
  }
  return out
}

// ---- 自动隔离块（写入 profile cordis.patch.yml，marker 注释保证幂等与可恢复）----

export const QUARANTINE_MARKER = '# zdn-quarantine'

/** 渲染隔离块：后续 patch 条目按 id 覆盖先前声明，disabled: true 生效（loader 不加载） */
export function renderQuarantineBlock(entryId: string): string {
  return [
    `${QUARANTINE_MARKER} begin ${entryId} (auto-disabled by ZDNotes; restore via 插件管理)`,
    `- id: ${entryId}`,
    '  disabled: true',
    `${QUARANTINE_MARKER} end ${entryId}`,
    '',
  ].join('\n')
}

export function hasQuarantineBlock(patchText: string, entryId: string): boolean {
  return patchText.includes(`${QUARANTINE_MARKER} begin ${entryId}`)
}

/** 移除指定 entry 的隔离块（恢复用）；无该块时原样返回 */
export function removeQuarantineBlocks(patchText: string, entryId: string): string {
  const begin = `${QUARANTINE_MARKER} begin ${entryId}`
  const end = `${QUARANTINE_MARKER} end ${entryId}`
  const out: string[] = []
  let skipping = false
  for (const line of patchText.split(/\r?\n/)) {
    const t = line.trimStart()
    if (!skipping && t.startsWith(begin)) {
      skipping = true
      continue
    }
    if (skipping) {
      if (t.startsWith(end)) skipping = false
      continue
    }
    out.push(line)
  }
  return out.join('\n')
}

export interface QuarantineRecord {
  entryId: string
  /** entry name（可能为子路径）；pending 类隔离时由 patch 映射得到 */
  name?: string
  /** 触发隔离的错误摘要 */
  reason: string
  /** 隔离时间戳（ms） */
  at: number
}

/** 解析隔离台账（DSH home/zdn-quantine.json）；空/损坏返回空数组 */
export function parseQuarantineLedger(raw: string | null): QuarantineRecord[] {
  if (!raw) return []
  try {
    const doc = JSON.parse(raw) as unknown
    if (!Array.isArray(doc)) return []
    return doc.filter(
      (r): r is QuarantineRecord =>
        !!r && typeof r === 'object' && typeof (r as QuarantineRecord).entryId === 'string',
    )
  } catch {
    return []
  }
}

// ===================================================================
// 运行时兼容性体检 / 升级前预演（纯逻辑，便于单测）：
// 复用 checkPluginCompatibility，不重复实现版本规则。
// ===================================================================

export interface PluginManifestEntry {
  name: string
  version: string
  /** 是否进入 profiles/web 的 dsh.profile.bundles 加载层 */
  active: boolean
  /** 已落盘 manifest；不可读为 null（fail-open：跳过检查，不误报） */
  manifest: Record<string, unknown> | null
}

export type PluginCompatStatusKind = 'ok' | 'incompatible' | 'inactive'

export interface PluginCompatStatus {
  name: string
  version: string
  active: boolean
  status: PluginCompatStatusKind
  issues: string[]
}

/**
 * 已装插件体检：对每个插件跑 checkPluginCompatibility（当前运行时），汇总状态。
 * 状态优先级：有问题 → incompatible；无问题但未进 bundles → inactive；否则 ok。
 */
export function summarizePluginStatuses(opts: {
  plugins: PluginManifestEntry[]
  dshVersion: string | null
  nodeVersion: string
  resolveRuntimePackageVersion: (pkgName: string) => string | null
}): PluginCompatStatus[] {
  return opts.plugins.map((p) => {
    const issues = p.manifest
      ? checkPluginCompatibility({
          manifest: p.manifest,
          dshVersion: opts.dshVersion,
          nodeVersion: opts.nodeVersion,
          resolveRuntimePackageVersion: opts.resolveRuntimePackageVersion,
        })
      : []
    const status: PluginCompatStatusKind =
      issues.length > 0 ? 'incompatible' : p.active ? 'ok' : 'inactive'
    return { name: p.name, version: p.version, active: p.active, status, issues }
  })
}

export interface PluginUpgradeImpact {
  name: string
  version: string
  issues: string[]
}

/**
 * 升级前预演：把每个已装插件的版本要求对「目标 DSH 版本 + 目标核心包版本」求解。
 * targetCoreVersions 由目标 dsh manifest 的 @deepseek-ai/* 依赖（minVersion）构成。
 * manifest 不可读的插件跳过（fail-open）；只返回会失效（breaking）的插件。
 */
export function simulatePluginsAgainstTarget(opts: {
  plugins: PluginManifestEntry[]
  targetDshVersion: string | null
  targetCoreVersions: Record<string, string>
  nodeVersion: string
}): PluginUpgradeImpact[] {
  const impacts: PluginUpgradeImpact[] = []
  for (const p of opts.plugins) {
    if (!p.manifest) continue
    const issues = checkPluginCompatibility({
      manifest: p.manifest,
      dshVersion: opts.targetDshVersion,
      nodeVersion: opts.nodeVersion,
      resolveRuntimePackageVersion: (n) => opts.targetCoreVersions[n] ?? null,
    })
    if (issues.length > 0) impacts.push({ name: p.name, version: p.version, issues })
  }
  return impacts
}

// ---- 安装完整性（空目录/入口缺失）----

/**
 * 从 loader entry name 提取包名：entry name 可能带子路径（`@scope/pkg/sub`、`pkg/sub`），
 * 非包说明符（`cordis:include`、`node:fs` 等带协议前缀）返回 null。
 */
export function packageNameFromEntry(name: string): string | null {
  const n = name.trim()
  if (!n || /^[a-z]+:/i.test(n)) return null
  const m = n.match(/^((?:@[A-Za-z0-9][\w.-]*\/)?[A-Za-z0-9][\w.-]*)/)
  return m ? m[1] : null
}

/** package.json 中可验证的入口候选：main / exports 字符串叶子 / index.js（跳过模式与 URL） */
function entryFileCandidates(pkg: { main?: unknown; exports?: unknown }): string[] {
  const out = new Set<string>()
  const add = (v: unknown): void => {
    if (typeof v === 'string' && v && !v.includes('*') && !/^[a-z]+:/i.test(v)) {
      out.add(v.replace(/^\.\//, ''))
    } else if (Array.isArray(v)) {
      v.forEach(add)
    } else if (v && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(add)
    }
  }
  add(pkg.main)
  add(pkg.exports)
  out.add('index.js')
  return [...out]
}

export interface PackageIntegrityResult {
  name: string
  ok: boolean
  reason?: string
}

/**
 * 安装完整性校验：包目录存在 → package.json 可读 → 声明的入口至少一个真实文件。
 * 用于发现「pnpm 认为已装、实际是空目录/入口缺失」的坏安装（升级探针会因此启动失败）。
 */
export function checkPackageInstallIntegrity(opts: {
  name: string
  packageDir: string | null
  readText: (p: string) => string | null
  exists: (p: string) => boolean
}): PackageIntegrityResult {
  const { name, packageDir } = opts
  if (!packageDir) return { name, ok: false, reason: '依赖目录不存在' }
  const raw = opts.readText(join(packageDir, 'package.json'))
  if (raw === null) return { name, ok: false, reason: 'package.json 缺失（空目录/未装完整）' }
  let pkg: { main?: unknown; exports?: unknown }
  try {
    pkg = JSON.parse(raw) as { main?: unknown; exports?: unknown }
  } catch {
    return { name, ok: false, reason: 'package.json 无法解析' }
  }
  const candidates = entryFileCandidates(pkg)
  if (candidates.some((rel) => opts.exists(join(packageDir, rel)))) return { name, ok: true }
  return { name, ok: false, reason: `入口文件缺失（尝试：${candidates.slice(0, 3).join(' / ')}）` }
}

/**
 * 从 DSH 启动 stderr 提取「找不到的插件包」。
 * 形态：`Cannot find package 'D:\...\node_modules\@scope\pkg\index.js'` → `@scope/pkg`。
 */
export function parseMissingPluginPackages(stderr: string): string[] {
  if (!stderr) return []
  const out = new Set<string>()
  const re = /Cannot find (?:package|module) '([^']+)'/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stderr))) {
    const raw = m[1].replace(/\\/g, '/')
    const idx = raw.lastIndexOf('node_modules/')
    const spec = idx >= 0 ? raw.slice(idx + 'node_modules/'.length) : raw
    const pkg = packageNameFromEntry(spec)
    if (pkg) out.add(pkg)
  }
  return [...out]
}

/**
 * 两个版本号的 major.minor 是否相同；任一非法/缺失返回 false。
 * 用于阻止跨 minor（如 0.1.x → 0.2.x）运行时升级——0.2 会迁移 profile 且插件不兼容。
 */
export function sameMinorVersion(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false
  const pa = a.match(/^(\d+)\.(\d+)\./)
  const pb = b.match(/^(\d+)\.(\d+)\./)
  return !!pa && !!pb && pa[1] === pb[1] && pa[2] === pb[2]
}

// ===================================================================
// 升级前完整闭包兼容性（v1.9.1）：
// 只查 profile 顶层依赖会漏掉 @linxin666/dsh-web-all 里的传递插件
// （dsh-better-sidebar / dsh-i18n 等）——它们才是 0.2.x 升级真正崩掉的包。
// ===================================================================

export interface PluginClosureNode {
  name: string
  version: string
  manifest: Record<string, unknown> | null
  /** 到达该节点的顶层来源（顶层包自身即 root） */
  root: string
  /** 父包名；顶层为 null */
  parent: string | null
}

/**
 * 从顶层依赖 + bundle patch entry 包名出发，BFS 遍历每个第三方包的 dependencies。
 * 跳过 @deepseek-ai/* 运行时包与 devDependencies（它们由运行时提供，不是插件）。
 * 环与重复包由 visited 集合截断，节点数上限防病态依赖图。
 */
export function collectPluginClosure(opts: {
  roots: string[]
  readManifest: (name: string) => Record<string, unknown> | null
  maxNodes?: number
}): PluginClosureNode[] {
  const maxNodes = opts.maxNodes ?? 500
  const out: PluginClosureNode[] = []
  const seen = new Set<string>()
  const queue: Array<{ name: string; root: string; parent: string | null }> = []
  for (const raw of opts.roots) {
    const name = raw.trim()
    if (!name || seen.has(name) || name.startsWith('@deepseek-ai/')) continue
    seen.add(name)
    queue.push({ name, root: name, parent: null })
  }
  while (queue.length > 0 && out.length < maxNodes) {
    const cur = queue.shift() as { name: string; root: string; parent: string | null }
    const manifest = opts.readManifest(cur.name)
    const version = typeof manifest?.version === 'string' ? manifest.version : ''
    out.push({ name: cur.name, version, manifest, root: cur.root, parent: cur.parent })
    if (!manifest) continue
    const deps = (manifest.dependencies ?? {}) as Record<string, unknown>
    for (const child of Object.keys(deps)) {
      if (child.startsWith('@deepseek-ai/') || seen.has(child)) continue
      seen.add(child)
      queue.push({ name: child, root: cur.root, parent: cur.name })
    }
  }
  return out
}

/**
 * 版本范围是否含上界（semver 已把 ^ / ~ / x-range / 精确版本展开为比较符）。
 * 仅 `>=x`（含 `*`）这类开放范围返回 false —— 跨 minor 时不能据此判定兼容。
 */
export function rangeHasUpperBound(range: string): boolean {
  try {
    const r = new Range(range, { includePrerelease: true })
    return r.set.every((set) =>
      set.some(
        (c) => c.operator === '<' || c.operator === '<=' || (c.operator === '' && c.value !== ''),
      ),
    )
  } catch {
    return false
  }
}

export interface TargetCompatOptions {
  /** 插件 manifest（已落盘或 registry 候选版本） */
  manifest: Record<string, unknown>
  /** 目标 DSH 版本 */
  targetDshVersion: string | null
  /** 目标运行时实际安装的 @deepseek-ai/* 包版本表（缺失 = 目标不再提供该 peer） */
  targetCoreVersions: Record<string, string | undefined>
  /** 运行时 Node 版本 */
  nodeVersion: string
  /** 目标与当前是否跨 minor（跨 minor 时开放/缺失声明记为 warning） */
  crossMinor: boolean
}

export type CompatSeverity = 'error' | 'warning'

export interface TargetCompatIssue {
  severity: CompatSeverity
  message: string
}

/** 是否为 DSH 插件包（有 dsh 声明 / DSH 版本要求 / @deepseek-ai/* peer）；普通 JS 库返回 false */
export function isDshPluginManifest(manifest: Record<string, unknown>): boolean {
  const m = manifest as {
    dsh?: unknown
    engines?: { dsh?: unknown }
    peerDependencies?: Record<string, string>
  }
  if (m.dsh && typeof m.dsh === 'object') return true
  if (typeof m.engines?.dsh === 'string' && m.engines.dsh.trim()) return true
  return Object.keys(m.peerDependencies ?? {}).some((n) => n.startsWith('@deepseek-ai/'))
}

/**
 * 升级专用严格兼容判定（区别于安装期 checkPluginCompatibility 的 fail-open）：
 * - error（硬阻断）：目标运行时缺少插件声明的 @deepseek-ai/* peer（0.2.x 移除/改名的典型形态）、
 *   peer 版本不符、DSH 版本范围不满足、Node 不符
 * - warning（不阻断，交给实机预演裁决）：跨 minor 且 DSH 要求为开放区间/未声明/无效
 * 同 minor 保持既有宽松语义，避免历史插件误报。
 */
export function checkPluginAgainstTarget(opts: TargetCompatOptions): TargetCompatIssue[] {
  const issues: TargetCompatIssue[] = []
  const m = opts.manifest as {
    engines?: { node?: unknown }
    peerDependencies?: Record<string, string>
  } & Parameters<typeof dshRequirementOf>[0]
  const hasCorePeer = Object.keys(m.peerDependencies ?? {}).some((n) =>
    n.startsWith('@deepseek-ai/'),
  )

  const dshRange = dshRequirementOf(m)
  if (!dshRange) {
    if (opts.crossMinor && !hasCorePeer) {
      issues.push({
        severity: 'warning',
        message: '未声明 DSH 版本要求（跨 minor 未验证，交给实机预演）',
      })
    }
  } else if (!validRange(dshRange)) {
    if (opts.crossMinor) {
      issues.push({ severity: 'warning', message: `DSH 版本要求无效：${dshRange}` })
    }
  } else if (!opts.targetDshVersion) {
    if (opts.crossMinor) {
      issues.push({ severity: 'warning', message: '目标 DSH 版本未知，无法验证' })
    }
  } else if (!satisfies(opts.targetDshVersion, dshRange, { includePrerelease: true })) {
    issues.push({
      severity: 'error',
      message: `插件要求 DSH ${dshRange}，目标为 ${opts.targetDshVersion}`,
    })
  } else if (opts.crossMinor && !rangeHasUpperBound(dshRange)) {
    issues.push({
      severity: 'warning',
      message: `插件声明 DSH ${dshRange}（无上界），跨 minor 未验证，交给实机预演`,
    })
  }

  const nodeRange = typeof m.engines?.node === 'string' ? m.engines.node.trim() : ''
  if (
    nodeRange &&
    validRange(nodeRange) &&
    !satisfies(opts.nodeVersion, nodeRange, { includePrerelease: true })
  ) {
    issues.push({
      severity: 'error',
      message: `插件要求 Node ${nodeRange}，当前运行时为 ${opts.nodeVersion}`,
    })
  }

  for (const [name, range] of Object.entries(m.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/') || !validRange(range)) continue
    const actual = opts.targetCoreVersions[name]
    if (!actual) {
      issues.push({ severity: 'error', message: `目标运行时缺少 peer 包 ${name}` })
      continue
    }
    if (!satisfies(actual, range, { includePrerelease: true })) {
      issues.push({
        severity: 'error',
        message: `插件依赖 ${name}@${range}，目标运行时为 ${actual}`,
      })
    }
  }
  return issues
}

/** 在候选版本里取满足兼容判定的最高版本；无兼容版本返回 null。 */
export function selectHighestCompatibleVersion(
  versions: string[],
  isCompatible: (version: string) => boolean,
): string | null {
  const candidates = versions.filter((v) => valid(v)).sort(rcompare)
  for (const v of candidates) {
    if (isCompatible(v)) return v
  }
  return null
}
