import { describe, it, expect } from 'vitest'
import { parseNLP } from '../src/lib/nlp'

describe('parseNLP', () => {
  it('returns empty result for empty input', () => {
    expect(parseNLP('')).toEqual({ title: '', priority: null, dueDate: null, startDate: null, tags: [], owner: null })
    expect(parseNLP('   ')).toEqual({ title: '', priority: null, dueDate: null, startDate: null, tags: [], owner: null })
  })

  it('returns title when no special tokens', () => {
    const r = parseNLP('Buy groceries')
    expect(r.title).toBe('Buy groceries')
    expect(r.priority).toBeNull()
    expect(r.dueDate).toBeNull()
    expect(r.tags).toEqual([])
    expect(r.owner).toBeNull()
  })

  describe('priority', () => {
    it('extracts P0-P3 priority', () => {
      expect(parseNLP('Task P0').priority).toBe('P0')
      expect(parseNLP('Task P1').priority).toBe('P1')
      expect(parseNLP('Task P2').priority).toBe('P2')
      expect(parseNLP('Task P3').priority).toBe('P3')
    })

    it('extracts lowercase priority', () => {
      expect(parseNLP('task p0').priority).toBe('P0')
    })

    it('extracts !!! as P0', () => {
      const r = parseNLP('Urgent !!!')
      expect(r.priority).toBe('P0')
      expect(r.title).toBe('Urgent')
    })

    it('extracts !! as P1', () => {
      const r = parseNLP('Important !!')
      expect(r.priority).toBe('P1')
      expect(r.title).toBe('Important')
    })

    it('extracts ! as P2', () => {
      const r = parseNLP('Normal !')
      expect(r.priority).toBe('P2')
    })

    it('first priority wins', () => {
      const r = parseNLP('Task P0 P1')
      expect(r.priority).toBe('P0')
    })

    it('ignores illegal priority like P4', () => {
      const r = parseNLP('Task P4')
      expect(r.priority).toBeNull()
    })

    it('does not extract priority from middle of word', () => {
      const r = parseNLP('SP0rts')
      expect(r.priority).toBeNull()
    })
  })

  describe('tags', () => {
    it('extracts single tag', () => {
      const r = parseNLP('Review code #work')
      expect(r.tags).toEqual(['work'])
      expect(r.title).toBe('Review code')
    })

    it('extracts multiple tags', () => {
      const r = parseNLP('#work #urgent Task')
      expect(r.tags).toEqual(['work', 'urgent'])
    })

    it('supports hyphens in tag names', () => {
      const r = parseNLP('#deep-work Task')
      expect(r.tags).toEqual(['deep-work'])
    })

    it('does not treat # inside word as tag', () => {
      const r = parseNLP('C# programming')
      expect(r.tags).toEqual([])
    })
  })

  describe('owner', () => {
    it('extracts owner', () => {
      const r = parseNLP('Deploy @server')
      expect(r.owner).toBe('server')
      expect(r.title).toBe('Deploy')
    })

    it('extracts first owner only', () => {
      const r = parseNLP('@work @home Task')
      expect(r.owner).toBe('work')
    })
  })

  describe('time', () => {
    it('parses absolute date', () => {
      const r = parseNLP('Meeting 2026-03-26')
      expect(r.dueDate).not.toBeNull()
      // 2026-03-26 23:59 local time
      const d = new Date(r.dueDate!)
      expect(d.getFullYear()).toBe(2026)
      expect(d.getMonth()).toBe(2) // 0-indexed
      expect(d.getDate()).toBe(26)
      expect(d.getHours()).toBe(23)
      expect(d.getMinutes()).toBe(59)
    })

    it('parses date with time', () => {
      const r = parseNLP('Meeting 2026-03-26 15:30')
      expect(r.dueDate).not.toBeNull()
      const d = new Date(r.dueDate!)
      expect(d.getFullYear()).toBe(2026)
      expect(d.getMonth()).toBe(2)
      expect(d.getDate()).toBe(26)
      expect(d.getHours()).toBe(15)
      expect(d.getMinutes()).toBe(30)
    })

    it('cleans time text from title', () => {
      const r = parseNLP('Buy milk tomorrow')
      expect(r.title).not.toContain('tomorrow')
    })
  })

  describe('combined input', () => {
    it('parses complex NLP input', () => {
      const r = parseNLP('明天下午3点开会 @工作 P0 #紧急')
      expect(r.title).toBe('开会')
      expect(r.priority).toBe('P0')
      expect(r.owner).toBe('工作')
      expect(r.tags).toEqual(['紧急'])
      expect(r.dueDate).not.toBeNull()
      // 明天 = July 2 (relative to test date assumption)
      // 下午3点 = 15:00
    })

    it('parses example from requirements', () => {
      const r = parseNLP('明天下午3点写周报 #工作 P1')
      expect(r.title).toBe('写周报')
      expect(r.priority).toBe('P1')
      expect(r.tags).toEqual(['工作'])
      expect(r.dueDate).not.toBeNull()
    })
  })

  describe('edge cases', () => {
    it('handles emoji in title', () => {
      const r = parseNLP('Buy 🍕 P1')
      expect(r.title).toBe('Buy 🍕')
      expect(r.priority).toBe('P1')
    })

    it('handles special characters', () => {
      const r = parseNLP('Fix bug #urgent @project-alpha P0 明天')
      expect(r.title).toBe('Fix bug')
      expect(r.tags).toEqual(['urgent'])
      expect(r.owner).toBe('project-alpha')
      expect(r.priority).toBe('P0')
      expect(r.dueDate).not.toBeNull()
    })
  })

  describe('T-11: NLP boundary tests', () => {
    it('ignores P5 as illegal priority and keeps it in title', () => {
      const r = parseNLP('Task P5')
      expect(r.priority).toBeNull()
      expect(r.title).toBe('Task P5')
    })

    it('ignores P999 as illegal priority', () => {
      const r = parseNLP('Task P999')
      expect(r.priority).toBeNull()
      expect(r.title).toBe('Task P999')
    })

    it('handles !!!! (no match since !! must be followed by boundary)', () => {
      const r = parseNLP('Task !!!!')
      expect(r.priority).toBeNull()
      expect(r.title).toBe('Task !!!!')
    })

    it('handles multiple tags in different formats', () => {
      const r = parseNLP('#tag1 #tag2 #tag3 task')
      expect(r.tags).toEqual(['tag1', 'tag2', 'tag3'])
      expect(r.title).toBe('task')
    })

    it('handles Chinese tags and owners', () => {
      const r = parseNLP('任务 #标签 @项目')
      expect(r.tags).toEqual(['标签'])
      expect(r.owner).toBe('项目')
      expect(r.title).toBe('任务')
    })

    it('handles input with only special tokens', () => {
      const r = parseNLP('#tag @project P1')
      expect(r.title).toBe('')
      expect(r.tags).toEqual(['tag'])
      expect(r.owner).toBe('project')
      expect(r.priority).toBe('P1')
    })

    it('preserves special characters in title', () => {
      const r = parseNLP('Fix: something (important) P2')
      expect(r.title).toBe('Fix: something (important)')
      expect(r.priority).toBe('P2')
    })

    it('handles tab and newline separators', () => {
      const r = parseNLP('Task\t#tag\n@project')
      expect(r.title).toBe('Task')
      expect(r.tags).toEqual(['tag'])
      expect(r.owner).toBe('project')
    })
  })
})
