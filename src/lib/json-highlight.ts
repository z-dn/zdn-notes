export type JsonTokenType =
  'space' | 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punct' | 'bracket'

export interface JsonToken {
  text: string
  type: JsonTokenType
  depth?: number
}

export interface JsonLine {
  text: string
  startDepth: number
}

export const BRACKET_COLORS = [
  'text-red-500 dark:text-red-400',
  'text-orange-500 dark:text-orange-400',
  'text-amber-500 dark:text-amber-400',
  'text-emerald-600 dark:text-emerald-400',
  'text-sky-500 dark:text-sky-400',
  'text-violet-500 dark:text-violet-400',
]

export function tokenClass(t: JsonToken): string {
  switch (t.type) {
    case 'bracket':
      return BRACKET_COLORS[(t.depth ?? 0) % BRACKET_COLORS.length]
    case 'key':
      return 'text-blue-600 dark:text-blue-300'
    case 'string':
      return 'text-green-700 dark:text-green-400'
    case 'number':
      return 'text-orange-600 dark:text-orange-300'
    case 'boolean':
      return 'text-violet-600 dark:text-violet-300'
    case 'null':
      return 'text-red-600 dark:text-red-400'
    case 'punct':
      return 'text-muted-foreground'
    default:
      return ''
  }
}

const BOOLEANS = new Set(['true', 'false'])

export function tokenizeJson(json: string, startDepth = 0): JsonToken[] {
  const tokens: JsonToken[] = []
  const n = json.length
  let i = 0
  let depth = startDepth

  while (i < n) {
    const c = json[i]
    if (/\s/.test(c)) {
      let j = i
      while (j < n && /\s/.test(json[j])) j++
      tokens.push({ text: json.slice(i, j), type: 'space' })
      i = j
      continue
    }
    if (c === '"') {
      let j = i + 1
      while (j < n) {
        if (json[j] === '\\') {
          j += 2
          continue
        }
        if (json[j] === '"') {
          j++
          break
        }
        j++
      }
      let k = j
      while (k < n && /\s/.test(json[k])) k++
      tokens.push({ text: json.slice(i, j), type: json[k] === ':' ? 'key' : 'string' })
      i = j
      continue
    }
    if (c === '{' || c === '[') {
      tokens.push({ text: c, type: 'bracket', depth })
      depth++
      i++
      continue
    }
    if (c === '}' || c === ']') {
      depth = Math.max(0, depth - 1)
      tokens.push({ text: c, type: 'bracket', depth })
      i++
      continue
    }
    if (c === ':' || c === ',') {
      tokens.push({ text: c, type: 'punct' })
      i++
      continue
    }
    let j = i
    while (j < n && !/[\s{}[\]:,"]/.test(json[j])) j++
    const text = json.slice(i, j)
    const type: JsonTokenType = BOOLEANS.has(text) ? 'boolean' : text === 'null' ? 'null' : 'number'
    tokens.push({ text, type })
    i = j
  }

  return tokens
}

export function splitJsonLines(json: string): JsonLine[] {
  const lines: JsonLine[] = []
  if (!json) return lines
  let depth = 0
  let inString = false
  let cur = ''
  let startDepth = 0

  for (let i = 0; i < json.length; i++) {
    const c = json[i]
    if (inString) {
      cur += c
      if (c === '\\' && i + 1 < json.length) {
        cur += json[i + 1]
        i++
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      cur += c
      continue
    }
    if (c === '{' || c === '[') depth++
    else if (c === '}' || c === ']') depth = Math.max(0, depth - 1)
    if (c === '\n') {
      lines.push({ text: cur, startDepth })
      cur = ''
      startDepth = depth
      continue
    }
    cur += c
  }
  if (cur !== '' || lines.length === 0) lines.push({ text: cur, startDepth })

  return lines
}
