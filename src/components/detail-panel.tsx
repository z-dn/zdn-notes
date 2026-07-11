import { useState, useEffect, useRef, useMemo } from 'react'
import { marked } from 'marked'
import { format } from 'date-fns'
import { zhCN } from 'date-fns/locale'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { useTaskStore } from '@/stores/task-store'
import { useCategoryStore } from '@/stores/category-store'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Calendar } from '@/components/ui/calendar'
import { Badge } from '@/components/ui/badge'
import { PRIORITY_COLORS } from './task-item'
import type { Priority } from '@/types/task'

const PRIORITY_OPTIONS: Priority[] = ['P0', 'P1', 'P2', 'P3']

export function DetailPanel() {
  const selectedTask = useTaskStore((s) => s.selectedTask)
  const updateTask = useTaskStore((s) => s.updateTask)
  const tasks = useTaskStore((s) => s.tasks)
  const categories = useCategoryStore((s) => s.categories)
  const [description, setDescription] = useState('')
  const [title, setTitle] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [newTag, setNewTag] = useState('')
  const [newOwner, setNewOwner] = useState('')
  const [previewMode, setPreviewMode] = useState(false)
  const tagInput = useRef<HTMLInputElement>(null)
  const titleTimer = useRef<number>(undefined)
  const descTimer = useRef<number>(undefined)
  const ownerInputRef = useRef<HTMLInputElement>(null)
  const [showOwnerDropdown, setShowOwnerDropdown] = useState(false)

  useEffect(() => {
    if (selectedTask) {
      setTitle(selectedTask.title)
      setDescription(selectedTask.description || '')
      setNewOwner('')
      setDueDate(
        selectedTask.dueDate
          ? new Date(selectedTask.dueDate).toISOString().slice(0, 10)
          : '',
      )
      setStartDate(
        selectedTask.startDate
          ? new Date(selectedTask.startDate).toISOString().slice(0, 10)
          : '',
      )
    }
  }, [selectedTask])

  const recentOwners = useMemo(() => {
    const seen = new Set<string>()
    return [...tasks]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .filter((t) => {
        if (!t.owner || t.owner === selectedTask?.owner || seen.has(t.owner)) return false
        seen.add(t.owner)
        return true
      })
      .slice(0, 10)
      .map((t) => t.owner)
  }, [tasks, selectedTask?.owner])

  const filteredOwners = showOwnerDropdown
    ? recentOwners.filter((o) => !newOwner || o.toLowerCase().includes(newOwner.toLowerCase()))
    : []

  if (!selectedTask) {
    return (
      <div key="no-task" className="animate-fade-slide-up flex h-full items-center justify-center text-sm text-muted-foreground">
        选择一个任务查看详情
      </div>
    )
  }

  return (
    <div key={selectedTask.id} className="animate-fade-slide-up flex h-full flex-col gap-4 overflow-y-auto p-4">
      <Input
        value={title}
        onChange={(e) => {
          setTitle(e.target.value)
          clearTimeout(titleTimer.current)
          titleTimer.current = setTimeout(() => {
            const trimmed = e.target.value.trim()
            if (trimmed && trimmed !== selectedTask.title) {
              updateTask({ id: selectedTask.id, title: trimmed })
            }
          }, 500)
        }}
        onBlur={() => {
          clearTimeout(titleTimer.current)
          if (title.trim() && title !== selectedTask.title) {
            updateTask({ id: selectedTask.id, title: title.trim() })
          } else if (!title.trim()) {
            setTitle(selectedTask.title)
          }
        }}
        className="h-8 border-0 bg-transparent p-0 text-lg font-semibold shadow-none focus-visible:ring-0"
      />

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">优先级</span>
        <div className="flex gap-1">
          {PRIORITY_OPTIONS.map((p) => (
            <button
              key={p}
              onClick={() => updateTask({ id: selectedTask.id, priority: p })}
              className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${
                selectedTask.priority === p
                  ? PRIORITY_COLORS[p] + ' border'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground shrink-0">分类</span>
        <Select
          value={selectedTask.categoryId ?? ''}
          onChange={(v) => updateTask({ id: selectedTask.id, categoryId: v || '__uncategorized' })}
          options={[
            { value: '', label: '未分类' },
            ...categories.filter((c) => c.id !== '__uncategorized').map((c) => ({ value: c.id, label: c.name })),
          ]}
          placeholder="未分类"
          className="flex-1"
        />
      </div>

      <div className="space-y-1">
        <div className="flex flex-wrap gap-1">
          {selectedTask.tags.map((tag) => (
            <Badge key={tag} variant="secondary" className="text-[10px]">
              #{tag}
              <button
                onClick={() => updateTask({
                  id: selectedTask.id,
                  tags: selectedTask.tags.filter((t) => t !== tag),
                })}
                className="ml-1 hover:text-destructive"
              >
                ✕
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            ref={tagInput}
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTag.trim()) {
                updateTask({ id: selectedTask.id, tags: [...selectedTask.tags, newTag.trim()] })
                setNewTag('')
              }
            }}
            placeholder="添加标签..."
            className="h-6 flex-1 rounded border border-input bg-transparent px-2 text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
        </div>
      </div>

      <div className="space-y-1 relative">
        <div className="flex flex-wrap gap-1">
          {selectedTask.owner && (
            <Badge variant="secondary" className="text-[10px]">
              @{selectedTask.owner}
              <button
                onClick={() => updateTask({ id: selectedTask.id, owner: '' })}
                className="ml-1 hover:text-destructive"
              >
                ✕
              </button>
            </Badge>
          )}
        </div>
        <div className="relative">
          <input
            ref={ownerInputRef}
            value={newOwner}
            onChange={(e) => {
              setNewOwner(e.target.value)
              setShowOwnerDropdown(true)
            }}
            onFocus={() => setShowOwnerDropdown(true)}
            onBlur={() => setShowOwnerDropdown(false)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newOwner.trim()) {
                updateTask({ id: selectedTask.id, owner: newOwner.trim() })
                setNewOwner('')
                setShowOwnerDropdown(false)
              }
              if (e.key === 'Escape') {
                setShowOwnerDropdown(false)
              }
            }}
            placeholder="添加负责人..."
            className="h-6 w-full rounded border border-input bg-transparent px-2 text-[11px] outline-none focus:ring-1 focus:ring-ring"
          />
          {showOwnerDropdown && filteredOwners.length > 0 && (
            <div
              onMouseDown={(e) => e.preventDefault()}
              className="absolute left-0 right-0 top-full z-50 mt-1 max-h-40 overflow-y-auto rounded-md border border-input bg-popover shadow-md"
            >
              {filteredOwners.map((owner) => (
                <button
                  key={owner}
                  type="button"
                  onMouseDown={() => {
                    updateTask({ id: selectedTask.id, owner })
                    setNewOwner('')
                    setShowOwnerDropdown(false)
                    ownerInputRef.current?.blur()
                  }}
                  className={`flex w-full items-center px-2 py-1.5 text-left text-xs transition-colors ${
                    owner === selectedTask.owner
                      ? 'bg-accent text-foreground font-medium'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground'
                  }`}
                >
                  {owner}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground/60">开始日期</label>
        <div className="flex gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={`flex h-7 flex-1 items-center rounded-md border border-input bg-background px-2 text-xs transition-colors hover:bg-accent ${
                  startDate ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {startDate
                  ? format(new Date(startDate + 'T00:00:00'), 'M月d日 EEE', { locale: zhCN })
                  : '选择日期'}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={startDate ? new Date(startDate + 'T00:00:00') : undefined}
                onSelect={(selected: Date | undefined) => {
                  if (selected) {
                    const val = format(selected, 'yyyy-MM-dd')
                    setStartDate(val)
                    updateTask({ id: selectedTask.id, startDate: new Date(val + 'T00:00:00').getTime() })
                  }
                }}
                locale={zhCN}
                weekStartsOn={1}
              />
            </PopoverContent>
          </Popover>
          {startDate && (
            <button
              onClick={() => {
                setStartDate('')
                updateTask({ id: selectedTask.id, startDate: null })
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input bg-background text-xs text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground/60">截止日期</label>
        <div className="flex gap-1">
          <Popover>
            <PopoverTrigger asChild>
              <button
                className={`flex h-7 flex-1 items-center rounded-md border border-input bg-background px-2 text-xs transition-colors hover:bg-accent ${
                  dueDate ? 'text-foreground' : 'text-muted-foreground'
                }`}
              >
                {dueDate
                  ? format(new Date(dueDate + 'T00:00:00'), 'M月d日 EEE', { locale: zhCN })
                  : '选择日期'}
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto p-0">
              <Calendar
                mode="single"
                selected={dueDate ? new Date(dueDate + 'T00:00:00') : undefined}
                onSelect={(selected: Date | undefined) => {
                  if (selected) {
                    const val = format(selected, 'yyyy-MM-dd')
                    setDueDate(val)
                    updateTask({ id: selectedTask.id, dueDate: new Date(val + 'T23:59:00').getTime() })
                  }
                }}
                locale={zhCN}
                weekStartsOn={1}
              />
            </PopoverContent>
          </Popover>
          {dueDate && (
            <button
              onClick={() => {
                setDueDate('')
                updateTask({ id: selectedTask.id, dueDate: null })
              }}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-input bg-background text-xs text-muted-foreground/40 hover:text-muted-foreground hover:bg-accent transition-colors"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs text-muted-foreground">描述</label>
          <button
            onClick={() => setPreviewMode((p) => !p)}
            className="text-[10px] text-muted-foreground/50 hover:text-foreground"
          >
            {previewMode ? '编辑' : '预览'}
          </button>
        </div>
        {previewMode ? (
          <div
            className="h-full min-h-[80px] w-full overflow-y-auto rounded-md border border-input bg-transparent p-2 text-sm [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_pre]:rounded [&_pre]:bg-muted [&_pre]:p-2 [&_pre]:text-xs [&_blockquote]:border-l-2 [&_blockquote]:border-muted [&_blockquote]:pl-2 [&_blockquote]:text-muted-foreground [&_h1]:text-lg [&_h1]:font-bold [&_h2]:text-base [&_h2]:font-semibold [&_h3]:text-sm [&_h3]:font-medium"
            dangerouslySetInnerHTML={{ __html: marked.parse(description || '', { async: false }) as string }}
          />
        ) : (
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value)
              clearTimeout(descTimer.current)
              descTimer.current = setTimeout(() => {
                updateTask({ id: selectedTask.id, description: e.target.value })
              }, 500)
            }}
            onBlur={() => {
              clearTimeout(descTimer.current)
              if (description !== selectedTask.description) {
                updateTask({ id: selectedTask.id, description })
              }
            }}
            placeholder="支持 Markdown 格式..."
            className="h-full min-h-[80px] w-full resize-none rounded-md border border-input bg-transparent p-2 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        )}
      </div>

      <div className="pt-2 text-xs text-muted-foreground/70">
        创建于 {new Date(selectedTask.createdAt).toLocaleString('zh-CN')}
      </div>
    </div>
  )
}
