import { useRef, useEffect, useCallback } from 'react'
import {
  subscribeMinimap,
  getMinimapContent,
  getMinimapScroll,
  jumpMinimapTo,
} from '@/lib/minimap-bus'

interface DescriptionMinimapProps {
  content: string
}

const COLORS = {
  dark: {
    bg: 'rgba(30,30,30,0.5)',
    h1: { bar: '#e8e8e8', bg: 'rgba(255,255,255,0.14)' },
    h2: { bar: '#c9c9c9', bg: 'rgba(255,255,255,0.1)' },
    h3: { bar: '#aaaaaa', bg: 'rgba(255,255,255,0.07)' },
    code: { bar: 'rgba(190,190,190,0.5)', bg: 'rgba(255,255,255,0.05)' },
    list: { bar: 'rgba(170,170,170,0.4)', bg: 'rgba(255,255,255,0.04)' },
    quote: { bar: 'rgba(150,150,150,0.3)', bg: 'rgba(255,255,255,0.03)' },
    text: { bar: 'rgba(150,150,150,0.25)' },
  },
  light: {
    bg: 'rgba(245,245,245,0.5)',
    h1: { bar: '#3a3a3a', bg: 'rgba(0,0,0,0.12)' },
    h2: { bar: '#5a5a5a', bg: 'rgba(0,0,0,0.09)' },
    h3: { bar: '#7a7a7a', bg: 'rgba(0,0,0,0.06)' },
    code: { bar: 'rgba(70,70,70,0.45)', bg: 'rgba(0,0,0,0.05)' },
    list: { bar: 'rgba(90,90,90,0.35)', bg: 'rgba(0,0,0,0.04)' },
    quote: { bar: 'rgba(110,110,110,0.25)', bg: 'rgba(0,0,0,0.03)' },
    text: { bar: 'rgba(120,120,120,0.25)' },
  },
}

type Palette = (typeof COLORS.dark)

const PAD = 6
const MAX_ROW = 6

function viewportTint(alpha: number): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--color-ring').trim()
  const m = raw.match(/^hsl\(\s*([\d.]+)\s+([\d.]+%)\s+([\d.]+%)/)
  if (m) return `hsla(${m[1]} ${m[2]} ${m[3]} / ${alpha})`
  return `rgba(120,120,120,${alpha})`
}

function getLineStyle(trimmed: string, inCodeBlock: boolean, colors: Palette): { bar: string; bg?: string } {
  if (inCodeBlock) return colors.code
  if (/^###\s/.test(trimmed)) return colors.h3
  if (/^##\s/.test(trimmed)) return colors.h2
  if (/^#\s/.test(trimmed)) return colors.h1
  if (/^[-*+]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) return colors.list
  if (/^>\s/.test(trimmed)) return colors.quote
  return colors.text
}

function getLineWeight(trimmed: string, inCodeBlock: boolean): number {
  if (!trimmed) return 0.4
  if (inCodeBlock) return 1
  if (/^#\s/.test(trimmed)) return 1.5
  if (/^##\s/.test(trimmed)) return 1.35
  if (/^###\s/.test(trimmed)) return 1.2
  if (/^!\[/.test(trimmed)) return 2
  if (/^([-*_])\s*\1\s*\1$/.test(trimmed)) return 0.8
  return 1
}

function contentLength(line: string): number {
  let s = line.trim()
  s = s.replace(/^#{1,6}\s+/, '')
  s = s.replace(/^>+\s?/, '')
  s = s.replace(/^[-*+]\s+/, '')
  s = s.replace(/^\d+[.)]\s+/, '')
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
  s = s.replace(/[`*_~]/g, '')
  s = s.replace(/<[^>]*>/g, '')
  return s.length
}

export function DescriptionMinimap({ content }: DescriptionMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const contentRef = useRef(content)
  contentRef.current = content

  const draw = useCallback(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    const isDark = document.documentElement.classList.contains('dark')
    const colors = isDark ? COLORS.dark : COLORS.light

    const dpr = window.devicePixelRatio || 1
    const w = rect.width
    const h = rect.height
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = w + 'px'
    canvas.style.height = h + 'px'
    ctx.scale(dpr, dpr)

    const drawW = w - PAD * 2
    const drawH = h - PAD * 2

    ctx.fillStyle = colors.bg
    ctx.fillRect(0, 0, w, h)

    const source = getMinimapContent()
    const text = source ?? contentRef.current
    const lines = text.split('\n')

    let inCodeBlock = false
    const meta = lines.map((line) => {
      const trimmed = line.trim()
      if (trimmed.startsWith('```')) {
        inCodeBlock = !inCodeBlock
        return { weight: 0, inCode: false }
      }
      return { weight: getLineWeight(trimmed, inCodeBlock), inCode: inCodeBlock }
    })

    const totalWeight = meta.reduce((sum, m) => sum + m.weight, 0)
    if (totalWeight === 0) return

    const rowH = Math.min(MAX_ROW, drawH / totalWeight)
    const docH = totalWeight * rowH

    let y = PAD
    meta.forEach((m, i) => {
      if (m.weight <= 0) return
      const trimmed = lines[i].trim()
      const h = m.weight * rowH
      const style = getLineStyle(trimmed, m.inCode, colors)

      if (style.bg) {
        ctx.fillStyle = style.bg
        ctx.fillRect(PAD, y, drawW, h)
      }

      const measure = m.inCode ? trimmed.length : contentLength(trimmed)
      const barWidth = Math.min(drawW, Math.max(4, (measure / 100) * drawW * 0.85 + 4))
      ctx.fillStyle = style.bar
      ctx.fillRect(PAD, y, barWidth, h)
      y += h
    })

    const scroll = getMinimapScroll()
    if (!scroll || scroll.scrollHeight <= 0) return
    const vh = Math.min(docH, (scroll.clientHeight / scroll.scrollHeight) * docH)
    const vy = PAD + scroll.progress * docH

    ctx.fillStyle = viewportTint(0.3)
    ctx.fillRect(PAD, vy, drawW, vh)
  }, [])

  useEffect(() => {
    draw()
    const unsub = subscribeMinimap(draw)

    const ro = new ResizeObserver(draw)
    if (containerRef.current) ro.observe(containerRef.current)

    const mo = new MutationObserver(draw)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => {
      unsub()
      ro.disconnect()
      mo.disconnect()
    }
  }, [draw])

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const drawH = rect.height - PAD * 2
    if (drawH <= 0) return
    const frac = Math.min(1, Math.max(0, (e.clientY - rect.top - PAD) / drawH))
    jumpMinimapTo(frac)
  }, [])

  return (
    <div ref={containerRef} className="h-full w-full cursor-pointer" onClick={handleClick}>
      <canvas ref={canvasRef} className="block" />
    </div>
  )
}
