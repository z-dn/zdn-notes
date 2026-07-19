import { useRef, useEffect } from 'react'

interface DescriptionMinimapProps {
  content: string
}

const COLORS = {
  dark: {
    bg: 'rgba(30,30,30,0.5)',
    h1: { bar: '#e5c07b', bg: 'rgba(229,192,123,0.18)' },
    h2: { bar: '#d19a66', bg: 'rgba(209,154,102,0.14)' },
    h3: { bar: '#c0a050', bg: 'rgba(192,160,80,0.1)' },
    code: { bar: '#569cd6', bg: 'rgba(86,156,214,0.1)' },
    list: { bar: '#98c379', bg: 'rgba(152,195,121,0.12)' },
    quote: { bar: '#6a737d', bg: 'rgba(106,115,125,0.08)' },
    text: { bar: 'rgba(150,150,150,0.12)' },
  },
  light: {
    bg: 'rgba(245,245,245,0.5)',
    h1: { bar: '#795e26', bg: 'rgba(121,94,38,0.12)' },
    h2: { bar: '#935e0a', bg: 'rgba(147,94,10,0.1)' },
    h3: { bar: '#7a5a00', bg: 'rgba(122,90,0,0.08)' },
    code: { bar: '#0451a5', bg: 'rgba(4,81,165,0.06)' },
    list: { bar: '#407f3a', bg: 'rgba(64,127,58,0.08)' },
    quote: { bar: '#6a737d', bg: 'rgba(106,115,125,0.06)' },
    text: { bar: 'rgba(100,100,100,0.1)' },
  },
}

function getLineStyle(trimmed: string, inCodeBlock: boolean, colors: typeof COLORS.dark): { bar: string; bg?: string } {
  if (inCodeBlock) return colors.code
  if (/^###\s/.test(trimmed)) return colors.h3
  if (/^##\s/.test(trimmed)) return colors.h2
  if (/^#\s/.test(trimmed)) return colors.h1
  if (/^[-*+]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed)) return colors.list
  if (/^>\s/.test(trimmed)) return colors.quote
  return colors.text
}

export function DescriptionMinimap({ content }: DescriptionMinimapProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    if (!container || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    function draw() {
      const rect = container!.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return

      const isDark = document.documentElement.classList.contains('dark')
      const colors = isDark ? COLORS.dark : COLORS.light

      const dpr = window.devicePixelRatio || 1
      const w = rect.width
      const h = rect.height
      canvas!.width = w * dpr
      canvas!.height = h * dpr
      canvas!.style.width = w + 'px'
      canvas!.style.height = h + 'px'
      ctx!.scale(dpr, dpr)

      const PAD = 6
      const drawW = w - PAD * 2
      const drawH = h - PAD * 2

      ctx!.fillStyle = colors.bg
      ctx!.fillRect(0, 0, w, h)

      const lines = content.split('\n')
      const nonEmpty = lines.filter((l) => l.trim()).length
      if (nonEmpty === 0) return

      const barHeight = Math.min(5, Math.max(1.5, drawH / lines.length))
      const offsetY = PAD

      let inCodeBlock = false

      lines.forEach((line, i) => {
        const trimmed = line.trim()

        if (trimmed.startsWith('```')) {
          inCodeBlock = !inCodeBlock
          return
        }

        if (!trimmed) return

        const y = offsetY + i * barHeight
        const style = getLineStyle(trimmed, inCodeBlock, colors)

        if (style.bg) {
          ctx!.fillStyle = style.bg
          ctx!.fillRect(PAD, y, drawW, barHeight)
        }

        const barWidth = Math.min(drawW, Math.max(4, (line.length / 100) * drawW * 0.85 + 4))
        ctx!.fillStyle = style.bar
        ctx!.fillRect(PAD, y, barWidth, barHeight)
      })
    }

    draw()

    const ro = new ResizeObserver(draw)
    ro.observe(container)

    const mo = new MutationObserver(draw)
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    return () => {
      ro.disconnect()
      mo.disconnect()
    }
  }, [content])

  return (
    <div ref={containerRef} className="h-full w-full">
      <canvas ref={canvasRef} className="block" />
    </div>
  )
}
