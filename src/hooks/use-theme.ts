import { useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'

export function useTheme() {
  const savedTheme = useSettingsStore((s) => s.saved.theme)

  useEffect(() => {
    function apply(theme: 'light' | 'dark') {
      document.documentElement.classList.toggle('dark', theme === 'dark')
    }

    window.electronAPI?.setThemeSource?.(savedTheme)

    if (savedTheme === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)')
      apply(mq.matches ? 'dark' : 'light')
      const handler = (e: MediaQueryListEvent) => apply(e.matches ? 'dark' : 'light')
      mq.addEventListener('change', handler)
      return () => mq.removeEventListener('change', handler)
    } else {
      apply(savedTheme)
    }
  }, [savedTheme])
}
