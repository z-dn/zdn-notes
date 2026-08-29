// ===================================================================
// DSH 侧边栏终端 shell 解析的兼容性加固（纯逻辑，便于单元测试）。
//
// 背景：dsh-better-sidebar 的 defaultShell() 在 Windows 上扫描 PATH 里
// 第一个存在的 pwsh.exe，而 Microsoft Store 会向
// %LOCALAPPDATA%\Microsoft\WindowsApps 投放「应用执行别名」桩文件
// （0 字节 reparse point）。node-pty 的 ConPTY spawn 无法解析该别名桩，
// 终端报 "File not found"。dsh-better-sidebar 提供 DSH_SIDEBAR_SHELL
// 环境变量作为自动解析之上的覆盖点（优先级仅低于用户显式 config.shell），
// 本模块据此返回一个确定可 spawn 的 shell：
//   - 候选目录里存在真实 pwsh.exe（size > 0）→ 返回其全路径；
//   - 仅存在别名桩 → 返回收件箱 powershell.exe 全路径（兜底）；
//   - 无任何 pwsh → undefined（插件默认解析本身安全，不干预）。
// 候选顺序与 dsh-better-sidebar 的 windowsPwshCandidateDirs 保持一致：
// PATH 各段 → ProgramW6432/ProgramFiles 的 PowerShell 7(/7-preview)
// → LOCALAPPDATA 的 PowerShell 7(/7-preview)。
// ===================================================================

import { existsSync, statSync } from 'fs'
import { delimiter, join } from 'path'

export interface ShellResolveOptions {
  /** 平台覆盖（测试用），缺省 process.platform */
  platform?: NodeJS.Platform
  /** 环境覆盖（测试用），缺省 process.env */
  env?: NodeJS.ProcessEnv
  /** 路径存在性探针，缺省 existsSync */
  exists?: (p: string) => boolean
  /** 是否为「真实可执行」文件（非 0 字节别名桩），缺省 statSync size > 0 */
  isReal?: (p: string) => boolean
}

/** 收集与 dsh-better-sidebar windowsPwshCandidateDirs 同语义的候选目录（保序、去重） */
function candidateDirs(env: NodeJS.ProcessEnv): string[] {
  const dirs: string[] = []
  for (const entry of (env.PATH ?? '').split(delimiter)) {
    const trimmed = entry.trim()
    if (trimmed !== '') dirs.push(trimmed)
  }
  for (const pf of [env.ProgramW6432, env.ProgramFiles]) {
    if (pf !== undefined && pf.trim() !== '') {
      dirs.push(join(pf, 'PowerShell', '7'))
      dirs.push(join(pf, 'PowerShell', '7-preview'))
    }
  }
  const localAppData = env.LOCALAPPDATA
  if (localAppData !== undefined && localAppData.trim() !== '') {
    dirs.push(join(localAppData, 'Microsoft', 'PowerShell', '7'))
    dirs.push(join(localAppData, 'Microsoft', 'PowerShell', '7-preview'))
    dirs.push(join(localAppData, 'Programs', 'PowerShell', '7'))
    dirs.push(join(localAppData, 'Programs', 'PowerShell', '7-preview'))
  }
  return [...new Set(dirs)]
}

/**
 * 解析 DSH_SIDEBAR_SHELL 覆盖值；无需干预时返回 undefined。
 * 返回「第一个真实可用的 pwsh.exe」或「收件箱 powershell.exe」，二者均为
 * node-pty 可直接 spawn 的真实可执行文件。
 */
export function resolveSidebarShellOverride(opts: ShellResolveOptions = {}): string | undefined {
  const platform = opts.platform ?? process.platform
  const env = opts.env ?? process.env
  const exists = opts.exists ?? existsSync
  const isReal =
    opts.isReal ??
    ((p: string): boolean => {
      try {
        return statSync(p).size > 0
      } catch {
        return false
      }
    })
  if (platform !== 'win32') return undefined

  let sawStub = false
  for (const dir of candidateDirs(env)) {
    const candidate = join(dir, 'pwsh.exe')
    if (!exists(candidate)) continue
    if (isReal(candidate)) return candidate
    sawStub = true
  }
  if (!sawStub) return undefined

  const systemRoot = env.SystemRoot !== undefined && env.SystemRoot.trim() !== '' ? env.SystemRoot : 'C:\\Windows'
  const inbox = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return exists(inbox) ? inbox : 'powershell.exe'
}