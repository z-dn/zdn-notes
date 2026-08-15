import { useState, useEffect, useRef } from 'react'
import { setToast } from '@/lib/toast'

export function ToastContainer() {
  const [msg, setMsg] = useState('')
  const [phase, setPhase] = useState<'hidden' | 'visible' | 'leaving'>('hidden')
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const leaveTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    setToast((m: string) => {
      setMsg(m)
      setPhase('visible')
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setPhase('leaving'), 2500)
    })
    return () => {
      if (timer.current) clearTimeout(timer.current)
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    }
  }, [])

  useEffect(() => {
    if (phase !== 'leaving') return
    leaveTimer.current = setTimeout(() => setPhase('hidden'), 200)
  }, [phase])

  if (phase === 'hidden') return null

  return (
    <div
      className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg transition-all duration-200 ease-out ${
        phase === 'leaving' ? 'opacity-0 translate-y-1' : 'opacity-100 translate-y-0'
      }`}
    >
      {msg}
    </div>
  )
}
