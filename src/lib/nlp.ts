import * as chrono from 'chrono-node'
import type { Priority } from '@/types/task'

export interface NLPResult {
  title: string
  priority: Priority | null
  dueDate: number | null
  startDate: number | null
  tags: string[]
  owner: string | null
}

function extractPriority(text: string): { priority: Priority | null; rest: string } {
  let priority: Priority | null = null

  const rest = text
    .replace(/(?:^|\s)!!!(?=\s|$)/g, () => { priority = 'P0'; return '' })
    .replace(/(?:^|\s)!!(?=\s|$)/g, () => { if (!priority) priority = 'P1'; return '' })
    .replace(/(?:^|\s)!(?=\s|$)/g, () => { if (!priority) priority = 'P2'; return '' })
    .replace(/(?:^|\s)(P[0-3])(?=\s|$)/gi, (_, p) => {
      if (!priority) priority = p.toUpperCase() as Priority
      return ''
    })

  return { priority, rest: rest.replace(/\s+/g, ' ').trim() }
}

function extractTags(text: string): { tags: string[]; rest: string } {
  const tags: string[] = []
  const rest = text.replace(
    /(?:^|\s)#([\p{L}\p{N}_-]+)/gu,
    (_, name) => { tags.push(name); return '' },
  )
  return { tags, rest: rest.replace(/\s+/g, ' ').trim() }
}

function extractOwner(text: string): { owner: string | null; rest: string } {
  let owner: string | null = null
  const rest = text.replace(
    /(?:^|\s)@([\p{L}\p{N}_-]+)/u,
    (_, name) => { owner = name; return '' },
  )
  return { owner, rest: rest.replace(/\s+/g, ' ').trim() }
}

function extractTime(text: string): { dueDate: number | null; rest: string } {
  let results = chrono.parse(text)
  if (results.length === 0 && chrono.zh) {
    results = chrono.zh.parse(text)
  }
  if (results.length === 0) return { dueDate: null, rest: text }

  const result = results[0] as {
    text: string
    start: { date(): Date; isCertain(key: string): boolean }
  }
  const start = result.start
  const date = start.date()
  const dueDate = start.isCertain('hour')
    ? date.getTime()
    : new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59).getTime()

  const rest = text.replace(result.text, '').trim()
  return { dueDate, rest }
}

export function parseNLP(input: string): NLPResult {
  const text = input.trim()
  if (!text) {
    return { title: '', priority: null, dueDate: null, startDate: null, tags: [], owner: null }
  }

  const { priority, rest: afterPriority } = extractPriority(text)
  const { owner, rest: afterProject } = extractOwner(afterPriority)
  const { tags, rest: afterTags } = extractTags(afterProject)
  const { dueDate, rest: afterTime } = extractTime(afterTags)

  const title = afterTime.replace(/\s+/g, ' ').trim()

  return { title, priority, dueDate, startDate: null, tags, owner }
}
