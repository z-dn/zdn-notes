import { existsSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'

// ===================================================================
// 运行时 vendor patch：为 @deepseek-ai/dsh-win32-process 的 CreateProcess 调用点
// 补 CREATE_NO_WINDOW (0x08000000)，修 pwsh 工具黑窗（见 AGENTS.md v1.8.10 条目）。
//
// 与 scripts/build-dsh.mjs 的 patchWin32Process 同源（构建期 + 运行期升级各跑一次）。
// 运行期做 best-effort：目标子串不存在（上游已修/改名）时跳过并在结果里说明，绝不阻断；
// 构建期则硬失败（脚本分叉，见 build-dsh.mjs）。升级新版本后若上游已修复，本 patch 自然跳过。
// 写入用 rm+rewrite，避免踩共享 store 的就地改写。
// ===================================================================

const NO_WINDOW = 0x08000000

export interface VendorPatchResult {
  /** 本次是否改写了文件 */
  applied: boolean
  /** 是否跳过（文件缺失/目标不存在/无法归因），跳过时 reason 有值 */
  skipped: boolean
  reason?: string
}

const APP_BOOT_MARKER = 'zdn-require-builtin-fallback'
const APP_BOOT_PATTERN =
  /function internalModules\(\) \{\s*const addon = createRequire\(import\.meta\.url\)\("node-addon-require-builtin"\);\s*const esmModule = addon\.requireBuiltin\("internal\/modules\/esm\/loader"\);\s*const cjsModule = addon\.requireBuiltin\("internal\/modules\/cjs\/loader"\);\s*const cjsHelpers = addon\.requireBuiltin\("internal\/modules\/helpers"\);\s*const esmUtils = addon\.requireBuiltin\("internal\/modules\/esm\/utils"\);\s*const esmResolve = addon\.requireBuiltin\("internal\/modules\/esm\/resolve"\);/

const APP_BOOT_REPLACEMENT = `function internalModules() {
	// ${APP_BOOT_MARKER}: Electron run-as-node + --expose-internals can require internals directly.
	// Keep the addon as fallback for hosts whose V8 fingerprint is supported by it.
	const requireInternal = (id) => {
		const req = createRequire(import.meta.url);
		if (process.execArgv.includes("--expose-internals")) {
			try { return req(id) } catch {}
		}
		return req("node-addon-require-builtin").requireBuiltin(id);
	};
	const esmModule = requireInternal("internal/modules/esm/loader");
	const cjsModule = requireInternal("internal/modules/cjs/loader");
	const cjsHelpers = requireInternal("internal/modules/helpers");
	const esmUtils = requireInternal("internal/modules/esm/utils");
	const esmResolve = requireInternal("internal/modules/esm/resolve");`

/**
 * DSH 0.1.7+ 的 dsh-app-boot 会无条件走 node-addon-require-builtin；
 * 该 addon 0.1.6+ 不支持 Electron 42，0.1.5 在 Electron 42 也拿不到 V8 符号。
 * 但 Electron run-as-node + --expose-internals 可直接 require 内部模块，
 * 因此把 app-boot 的 internalModules() 改成“内置 require 优先、addon 兜底”。
 * 幂等；上游若已改为 require-first 或删除该函数则跳过。
 */
export function applyDshAppBootRequirePatch(baseDir: string): VendorPatchResult {
  const file = join(baseDir, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
  if (!existsSync(file)) {
    return {
      applied: false,
      skipped: true,
      reason: '未找到 dsh-app-boot/lib/index.js（上游可能已移除或改名）',
    }
  }
  let src: string
  try {
    src = readFileSync(file, 'utf8')
  } catch (e) {
    return {
      applied: false,
      skipped: true,
      reason: `读取失败：${e instanceof Error ? e.message : String(e)}`,
    }
  }
  if (src.includes(APP_BOOT_MARKER)) {
    return { applied: false, skipped: false, reason: '已 patch，无需改动' }
  }
  const matches = src.match(new RegExp(APP_BOOT_PATTERN.source, 'g'))
  if (!matches || matches.length === 0) {
    return {
      applied: false,
      skipped: true,
      reason: 'dsh-app-boot internalModules 目标不存在（上游可能已改为 require-first）',
    }
  }
  if (matches.length > 1) {
    return {
      applied: false,
      skipped: true,
      reason: `dsh-app-boot internalModules 目标不唯一（${matches.length} 处）`,
    }
  }
  const out = src.replace(APP_BOOT_PATTERN, APP_BOOT_REPLACEMENT)
  try {
    // 与 win32 patch 一致：rm + rewrite，避免共享 store 的就地改写
    rmSync(file, { force: true })
    writeFileSync(file, out)
  } catch (e) {
    return {
      applied: false,
      skipped: true,
      reason: `写入失败：${e instanceof Error ? e.message : String(e)}`,
    }
  }
  return { applied: true, skipped: false }
}

/** 三个 CreateProcess 调用点的替换规则（与 build-dsh.mjs 保持一致）。 */
const REPLACEMENTS: Array<{ from: string; to: string }> = [
  // spawnCurrentTokenJobProcess（pwsh 工具主路径）：CREATE_UNICODE_ENV|CREATE_SUSPENDED
  { from: ', 1, 1028, environment,', to: `, 1, ${1028 | NO_WINDOW}, environment,` },
  // spawnPipedProcess（sandbox 管道执行）
  { from: 'args), 0, startupInfo,', to: `args), ${NO_WINDOW}, startupInfo,` },
  // spawnInheritedJobProcess（sandbox 继承 stdio 执行）
  { from: 'commandLine, 4, startupInfo', to: `commandLine, ${4 | NO_WINDOW}, startupInfo` },
]

/**
 * 对给定运行时根目录应用 CREATE_NO_WINDOW vendor patch（幂等）。
 * 返回 applied（本次改写）/ skipped（不动，reason 说明）。
 */
export function applyWin32ProcessNoWindowPatch(baseDir: string): VendorPatchResult {
  const file = join(baseDir, 'node_modules', '@deepseek-ai', 'dsh-win32-process', 'lib', 'index.js')
  if (!existsSync(file)) {
    return {
      applied: false,
      skipped: true,
      reason: '未找到 dsh-win32-process/lib/index.js（上游可能已移除或改名）',
    }
  }
  let src: string
  try {
    src = readFileSync(file, 'utf8')
  } catch (e) {
    return {
      applied: false,
      skipped: true,
      reason: `读取失败：${e instanceof Error ? e.message : String(e)}`,
    }
  }
  let out = src
  for (const { from, to } of REPLACEMENTS) {
    const count = out.split(from).length - 1
    if (count === 1) {
      out = out.replace(from, to)
    } else if (count === 0) {
      if (!out.includes(to)) {
        return {
          applied: false,
          skipped: true,
          reason: `patch 目标不存在（上游可能已修）：${from}`,
        }
      }
      // 已含目标形态，继续
    } else {
      return { applied: false, skipped: true, reason: `patch 目标不唯一（${count} 处）：${from}` }
    }
  }
  if (out === src) return { applied: false, skipped: false, reason: '已 patch，无需改动' }
  try {
    rmSync(file, { force: true })
    writeFileSync(file, out)
  } catch (e) {
    return {
      applied: false,
      skipped: true,
      reason: `写入失败：${e instanceof Error ? e.message : String(e)}`,
    }
  }
  return { applied: true, skipped: false }
}
