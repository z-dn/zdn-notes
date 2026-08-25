// ===================================================================
// DSH 插件管理的纯逻辑部分：spec 校验 + profile 依赖解析。
// 独立成模块便于单元测试（不依赖 electron）。
//
// 背景见 docs/dsh-integration-plan.md 插件管理节：
// `dsh plugin add/remove` 是 pnpm 转发器，对账逻辑保证「用户装的插件
// = profile package.json 的 dependencies」（模板内置 bundle 不进依赖）。
// ===================================================================

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
 * 双向对齐 bundles 层列表与依赖账本（根治「pnpm 失败后 reconcile 未执行」
 * 留下的半成品状态：依赖已记录但 bundle 层缺失 → DSH 不加载）。
 *
 * 规则（isResolvableBundle 与 DSH resolveBundleDir 语义一致：
 * profile/node_modules 或安装目录/node_modules 任一锚点可解析出 dsh.bundle 声明）：
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
