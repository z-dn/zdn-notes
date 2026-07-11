import { useEffect, useRef, useState, useCallback } from 'react'

let lastClickX = 0
let lastClickY = 0

if (typeof document !== 'undefined') {
  document.addEventListener('mousedown', (e) => {
    lastClickX = e.clientX
    lastClickY = e.clientY
  })
}

export function useFlipDialog(open: boolean, onClose: () => void) {
  const [mounted, setMounted] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const isAnimating = useRef(false)
  const closeQueued = useRef(false)
  const originRef = useRef({ x: 0, y: 0 })

  useEffect(() => {
    if (open) setMounted(true)
  }, [open])

  const playOpen = useCallback(() => {
    const el = contentRef.current
    const ol = overlayRef.current
    if (!el || !ol || isAnimating.current) return
    isAnimating.current = true

    originRef.current = { x: lastClickX, y: lastClickY }

    el.style.visibility = 'hidden'
    el.style.opacity = '0'
    el.style.transition = 'none'
    el.style.transform = 'translate(-50%, -50%) scale(1)'
    ol.style.transition = 'none'
    ol.style.opacity = '0'

    void el.offsetHeight

    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const deltaX = originRef.current.x - cx
    const deltaY = originRef.current.y - cy

    el.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px)) scale(0.01)`

    void el.offsetHeight

    el.style.visibility = 'visible'
    el.style.opacity = '1'
    el.style.transition = 'transform 600ms cubic-bezier(0.34, 1.56, 0.64, 1), opacity 400ms ease-out'
    el.style.transform = 'translate(-50%, -50%) scale(1)'
    ol.style.transition = 'opacity 300ms ease-out'
    ol.style.opacity = '1'

    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== 'transform') return
      el.removeEventListener('transitionend', onEnd)
      isAnimating.current = false
      if (closeQueued.current) {
        closeQueued.current = false
        playCloseRef.current()
      }
    }
    el.addEventListener('transitionend', onEnd)
  }, [])

  const playClose = useCallback(() => {
    const el = contentRef.current
    const ol = overlayRef.current
    if (!el || !ol) return
    if (isAnimating.current) {
      closeQueued.current = true
      return
    }
    isAnimating.current = true

    const rect = el.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    const deltaX = originRef.current.x - cx
    const deltaY = originRef.current.y - cy

    el.style.transition = 'transform 300ms ease-in, opacity 250ms ease-in'
    el.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px)) scale(0.01)`
    el.style.opacity = '0'
    ol.style.transition = 'opacity 250ms ease-in'
    ol.style.opacity = '0'

    const onEnd = (e: TransitionEvent) => {
      if (e.propertyName !== 'transform') return
      el.removeEventListener('transitionend', onEnd)
      isAnimating.current = false
      setMounted(false)
      onClose()
    }
    el.addEventListener('transitionend', onEnd)
  }, [onClose])

  const playCloseRef = useRef(playClose)
  playCloseRef.current = playClose

  useEffect(() => {
    if (open && mounted) {
      requestAnimationFrame(() => playOpen())
    }
  }, [open, mounted, playOpen])

  return { contentRef, overlayRef, mounted, playClose }
}
