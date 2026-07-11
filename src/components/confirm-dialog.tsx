import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { useFlipDialog } from '@/hooks/use-flip-dialog'

interface ConfirmStore {
  isOpen: boolean
  title: string
  message: string
  resolve: ((value: boolean) => void) | null
}

const useConfirmStore = create<ConfirmStore>(() => ({
  isOpen: false,
  title: '',
  message: '',
  resolve: null,
}))

export function showConfirm(title: string, message: string): Promise<boolean> {
  return new Promise((resolve) => {
    useConfirmStore.setState({ isOpen: true, title, message, resolve })
  })
}

export function ConfirmDialog() {
  const { isOpen, title, message } = useConfirmStore()
  const confirmedRef = useRef(false)
  const { contentRef, overlayRef, mounted, playClose } = useFlipDialog(isOpen, () => {
    const { resolve } = useConfirmStore.getState()
    resolve?.(confirmedRef.current)
    useConfirmStore.setState({ isOpen: false, title: '', message: '', resolve: null })
  })

  useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') confirmedRef.current = false
      if (e.key === 'Escape') playClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [isOpen, playClose])

  function handleClose(confirmed: boolean) {
    confirmedRef.current = confirmed
    playClose()
  }

  if (!mounted) return null

  return (
    <div className="fixed inset-0 z-50">
      <div ref={overlayRef} className="absolute inset-0 bg-black/40" onClick={() => handleClose(false)} />
      <div
        ref={contentRef}
        className="fixed left-1/2 top-1/2 w-full max-w-lg rounded-lg border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-2 text-center sm:text-left">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>
        <div className="mt-4 flex flex-col-reverse justify-end gap-2 sm:flex-row">
          <button
            onClick={() => handleClose(false)}
            className="mt-2 inline-flex items-center justify-center rounded-md border bg-background px-4 py-2 text-sm font-medium hover:bg-accent sm:mt-0"
          >
            取消
          </button>
          <button
            onClick={() => handleClose(true)}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            确定
          </button>
        </div>
      </div>
    </div>
  )
}
