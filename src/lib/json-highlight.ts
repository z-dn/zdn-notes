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
