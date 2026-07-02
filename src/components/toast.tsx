import { useState, useEffect, useRef } from 'react'
import { setToast } from '@/lib/toast'

export function ToastContainer() {
  const [msg, setMsg] = useState('')
  const [visible, setVisible] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    setToast((m: string) => {
      setMsg(m)
      setVisible(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setVisible(false), 2500)
    })
  }, [])

  if (!visible) return null

  return (
    <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md bg-foreground px-4 py-2 text-sm text-background shadow-lg transition-opacity">
      {msg}
    </div>
  )
}
