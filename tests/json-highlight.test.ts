import { describe, it, expect } from 'vitest'
import { splitJsonLines, tokenizeJson } from '../src/lib/json-highlight'

describe('tokenizeJson', () => {
  it('tokenizes an empty object with matching bracket depth', () => {
    const tokens = tokenizeJson('{}')
    expect(tokens).toEqual([
      { text: '{', type: 'bracket', depth: 0 },
      { text: '}', type: 'bracket', depth: 0 },
    ])
  })

  it('increments bracket depth per nesting level', () => {
    const tokens = tokenizeJson('{"a":[1]}')
    expect(tokens.filter((t) => t.type === 'bracket').map((t) => t.depth)).toEqual([0, 1, 1, 0])
  })

  it('marks string keys before a colon as keys', () => {
    const tokens = tokenizeJson('{"a":"b"}')
    expect(tokens[1]).toEqual({ text: '"a"', type: 'key' })
    expect(tokens[3]).toEqual({ text: '"b"', type: 'string' })
  })

  it('classifies literals and numbers', () => {
    const tokens = tokenizeJson('[true,false,null,42]')
    expect(tokens.map((t) => [t.text, t.type])).toEqual([
      ['[', 'bracket'],
      ['true', 'boolean'],
      [',', 'punct'],
      ['false', 'boolean'],
      [',', 'punct'],
      ['null', 'null'],
      [',', 'punct'],
      ['42', 'number'],
      [']', 'bracket'],
    ])
  })

  it('handles escaped quotes inside a string', () => {
    const tokens = tokenizeJson('{"a":"x\\"y"}')
    expect(tokens).toContainEqual({ text: '"x\\"y"', type: 'string' })
  })

  it('preserves whitespace tokens', () => {
    const tokens = tokenizeJson('{ }')
    expect(tokens).toContainEqual({ text: ' ', type: 'space' })
  })
})

describe('tokenizeJson with startDepth', () => {
  it('offsets bracket depths by startDepth', () => {
    const tokens = tokenizeJson('[\n 1\n]', 2)
    expect(tokens.filter((t) => t.type === 'bracket').map((t) => t.depth)).toEqual([2, 2])
  })
})

describe('splitJsonLines', () => {
  it('returns empty for empty input', () => {
    expect(splitJsonLines('')).toEqual([])
  })

  it('splits lines and records inherited depth', () => {
    const lines = splitJsonLines('{\n  "a": 1\n}')
    expect(lines).toEqual([
      { text: '{', startDepth: 0 },
      { text: '  "a": 1', startDepth: 1 },
      { text: '}', startDepth: 1 },
    ])
  })

  it('ignores braces inside strings', () => {
    const lines = splitJsonLines('{\n  "a": "{x}"\n}')
    expect(lines.map((l) => l.startDepth)).toEqual([0, 1, 1])
    expect(lines[2].text).toBe('}')
  })

  it('tracks depth across a multi-line array', () => {
    const lines = splitJsonLines('[\n  1,\n  2\n]')
    expect(lines.map((l) => l.startDepth)).toEqual([0, 1, 1, 1])
  })

  it('handles escaped quotes inside strings', () => {
    const lines = splitJsonLines('{\n  "a": "x\\"y{"\n}')
    expect(lines.map((l) => l.startDepth)).toEqual([0, 1, 1])
  })

  it('round-trips with tokenizeJson to keep rainbow depth across lines', () => {
    const json = '{\n  "a": [\n    1\n  ]\n}'
    const lines = splitJsonLines(json)
    const tokens = tokenizeJson(lines[3].text, lines[3].startDepth)
    const bracket = tokens.find((t) => t.type === 'bracket')
    expect(bracket?.depth).toBe(1)
  })
})
