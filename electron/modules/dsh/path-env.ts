// ===================================================================
// PATH 环境工具（纯逻辑，便于单元测试）。
//
// 背景：应用可能被裁剪 PATH 的环境启动（如 opencode 桌面进程的子进程
// 不含系统/用户注册表 PATH），导致 DSH server 继承后缺 git / vfox 等
// 工具目录（终端 vfox 报错、git 面板认不出仓库）。buildEnv 从注册表
// 读取系统+用户 PATH 补全，这里提供展开与合并两个纯函数。
// ===================================================================

/** 展开 PATH 里的 %VAR% 占位（从 env + 常见兜底取值；未知变量保留原样） */
export function expandPathVars(path: string, env: Record<string, string | undefined>): string {
  const fallback: Record<string, string> = {
    SystemRoot: 'C:\\Windows',
    SystemDrive: 'C:',
  }
  return path.replace(/%([^%]+)%/g, (m, name: string) => {
    const v = env[name] ?? fallback[name]
    return v !== undefined ? v : m
  })
}

/** 合并两份 PATH（现有在前、补充在后，保序、去重、忽略空段） */
export function mergePathDirs(existing: string, additions: string): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of [...existing.split(';'), ...additions.split(';')]) {
    const t = raw.trim()
    if (t === '') continue
    const key = t.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(t)
  }
  return out.join(';')
}