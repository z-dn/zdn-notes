import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

const MotionContext = createContext(false)

export function useMotionSuppress(): boolean {
  return useContext(MotionContext)
}

function MotionSuppress({ active, children }: { active: boolean; children: ReactNode }) {
  const parent = useContext(MotionContext)
  return <MotionContext.Provider value={parent || active}>{children}</MotionContext.Provider>
}

interface FadeBlockProps {
  show: boolean
  children: ReactNode
  className?: string
  duration?: number
}

export function FadeBlock({ show, children, className, duration = 200 }: FadeBlockProps) {
  const suppress = useMotionSuppress()
  const mountSuppressRef = useRef(suppress)
  const [state, setState] = useState<'hidden' | 'shown' | 'leaving'>(show ? 'shown' : 'hidden')
  const stateRef = useRef(state)
  stateRef.current = state
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = undefined
    }
    if (show) {
      if (stateRef.current !== 'shown') setState('shown')
    } else if (stateRef.current === 'shown') {
      setState('leaving')
      timerRef.current = setTimeout(() => setState('hidden'), duration)
    }
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [show, duration])

  if (state === 'hidden') return null

  const animateIn = !mountSuppressRef.current && state === 'shown'

  return (
    <div className={cn(state === 'leaving' ? 'animate-fade-out' : animateIn ? 'animate-fade-slide-up' : '', className)}>
      {children}
    </div>
  )
}

interface CollapseProps {
  open: boolean
  children: ReactNode
  className?: string
  openClass?: string
}

export function Collapse({ open, children, className, openClass = 'h-1/2' }: CollapseProps) {
  return (
    <div
      className={cn(
        'min-h-0 overflow-hidden transition-[height] duration-200 ease-out',
        open ? openClass : '',
        className,
      )}
      style={open ? undefined : { height: 0 }}
    >
      {children}
    </div>
  )
}

interface FadeSwitchProps {
  current: string
  render: (key: string) => ReactNode
  className?: string
  duration?: number
}

export function FadeSwitch({ current, render, className, duration = 200 }: FadeSwitchProps) {
  const [display, setDisplay] = useState(current)
  const [leaving, setLeaving] = useState(false)
  const [entering, setEntering] = useState(false)
  const swapTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const enterTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const leavingRef = useRef(false)

  useEffect(() => {
    if (current === display) {
      if (leavingRef.current) {
        leavingRef.current = false
        setLeaving(false)
      }
      return
    }
    if (swapTimer.current) clearTimeout(swapTimer.current)
    leavingRef.current = true
    setLeaving(true)
    swapTimer.current = setTimeout(() => {
      leavingRef.current = false
      setDisplay(current)
      setLeaving(false)
      setEntering(true)
      enterTimer.current = setTimeout(() => setEntering(false), duration)
    }, duration)
    return () => {
      if (swapTimer.current) clearTimeout(swapTimer.current)
    }
  }, [current, display, duration])

  useEffect(
    () => () => {
      if (enterTimer.current) clearTimeout(enterTimer.current)
    },
    [],
  )

  const active = leaving || entering

  return (
    <MotionSuppress active={active}>
      <div
        className={cn(
          leaving ? 'animate-fade-out' : entering ? 'animate-fade-slide-up' : '',
          className,
        )}
      >
        {render(display)}
      </div>
    </MotionSuppress>
  )
}
