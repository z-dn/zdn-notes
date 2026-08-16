import { useEffect, useState } from 'react'

// ===================================================================
// useFeature(id)：渲染层判断某平台模块是否启用。
// 标志来源：主进程 app:getFeatures（由 settings 表 module.<id> 解析）。
// 模块开关变更需要重启应用生效（与主进程装配时机一致），因此只加载一次。
// ===================================================================

const cache = new Map<string, Record<string, boolean> | null>()

export function useFeature(id: string): boolean {
  const [flags, setFlags] = useState<Record<string, boolean> | null>(
    cache.get('flags') ?? null,
  )

  useEffect(() => {
    if (flags) return
    let mounted = true
    window.electronAPI
      .getFeatures()
      .then((f) => {
        cache.set('flags', f)
        if (mounted) setFlags(f)
      })
      .catch(() => {
        /* 主进程不可用时保持禁用态 */
      })
    return () => {
      mounted = false
    }
  }, [flags])

  return flags ? flags[id] !== false : false
}