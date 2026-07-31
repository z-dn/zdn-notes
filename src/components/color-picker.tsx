import { useState } from 'react'
import { HexColorPicker } from 'react-colorful'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

interface ColorPickerProps {
  value: string
  onChange: (color: string) => void
  onOpenChange?: (open: boolean) => void
}

export function ColorPicker({ value, onChange, onOpenChange }: ColorPickerProps) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        onOpenChange?.(o)
      }}
    >
      <PopoverTrigger asChild>
        <button
          className="h-4 w-4 cursor-pointer rounded-full border border-input"
          style={{
            background:
              'conic-gradient(red, #f97316, #eab308, #22c55e, #06b6d4, #3b82f6, #8b5cf6, #ec4899, red)',
          }}
          title="自定义颜色"
        />
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        className="w-56 p-3"
        onClick={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <HexColorPicker
          color={value}
          onChange={onChange}
          style={{ width: '100%', height: 180 }}
        />
        <div className="mt-2 flex items-center gap-1.5 rounded-md border border-input px-2 py-1 text-xs">
          <span className="text-muted-foreground">#</span>
          <input
            value={value.replace('#', '')}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9a-fA-F]/g, '').slice(0, 6)
              if (raw.length === 6 || raw.length === 3) {
                onChange('#' + raw.toLowerCase())
              }
            }}
            className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
            placeholder="000000"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}
