export interface MinimapScroll {
  progress: number
  clientHeight: number
  scrollHeight: number
}

let sourceEl: HTMLElement | null = null
let sourceScrollHandler: (() => void) | null = null
let lastContent: string | null = null
const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((fn) => fn())
}

export function setMinimapSource(el: HTMLElement | null) {
  if (sourceEl === el) return
  if (sourceEl && sourceScrollHandler) {
    sourceEl.removeEventListener('scroll', sourceScrollHandler)
  }
  sourceEl = el
  sourceScrollHandler = el ? emit : null
  if (el && sourceScrollHandler) {
    el.addEventListener('scroll', sourceScrollHandler, { passive: true })
  }
  emit()
}

export function publishMinimapContent(content: string | null) {
  lastContent = content
  emit()
}

export function getMinimapContent(): string | null {
  return lastContent
}

export function getMinimapScroll(): MinimapScroll | null {
  if (!sourceEl) return null
  const { scrollTop, scrollHeight, clientHeight } = sourceEl
  return {
    progress: scrollHeight > 0 ? scrollTop / scrollHeight : 0,
    clientHeight,
    scrollHeight,
  }
}

export function jumpMinimapTo(frac: number) {
  const el = sourceEl
  if (!el) return
  const max = el.scrollHeight - el.clientHeight
  if (max <= 0) return
  const target = Math.min(max, Math.max(0, frac * el.scrollHeight - el.clientHeight / 2))
  el.scrollTo({ top: target })
}

export function subscribeMinimap(fn: () => void): () => void {
  listeners.add(fn)
  return () => {
    listeners.delete(fn)
  }
}
