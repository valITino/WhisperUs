import { describe, expect, it } from 'vitest'
import { NO_WHY } from '../../src/data/types'
import { feelOf, freshDraft, hasContent, parseDraft, type BoothDraft } from '../../src/features/booth/draft'

// What the booth keeps while somebody is still finding the words.

const NOW = Date.parse('2026-11-13T20:00:00Z')
const HOUR = 3_600_000
const saved = (draft: Partial<BoothDraft> | unknown, at = NOW - HOUR) => JSON.stringify({ at, draft })

describe('a fresh draft', () => {
  it('starts with the gentlest choices: nothing is asked of him, nothing leaves her phone', () => {
    expect(freshDraft()).toMatchObject({ step: 0, wants: 'listen', keep: 'keep', openMode: 'hand', opensAt: null, holdBack: [], showHeat: false })
  })

  it('has nothing in it worth asking about', () => {
    expect(hasContent(freshDraft(), false)).toBe(false)
    expect(hasContent({ ...freshDraft(), words: '  \n ' }, false)).toBe(false)
    // Choosing how it opens is not content yet.
    expect(hasContent({ ...freshDraft(), openMode: 'now', keep: 'once', wants: 'talk' }, false)).toBe(false)
  })

  it('anything said, felt, recorded or written on the outside is content', () => {
    expect(hasContent({ ...freshDraft(), words: 'I keep thinking' }, false)).toBe(true)
    expect(hasContent({ ...freshDraft(), teaser: 'About Saturday' }, false)).toBe(true)
    expect(hasContent({ ...freshDraft(), heat: 4 }, false)).toBe(true)
    expect(hasContent({ ...freshDraft(), why: { chips: ['said.shy'], own: [], note: null } }, false)).toBe(true)
    expect(hasContent(freshDraft(), true)).toBe(true)
  })
})

describe('how it felt, as it goes into the envelope', () => {
  it('is nothing when nothing was said about it', () => {
    expect(feelOf(freshDraft())).toBeNull()
    expect(feelOf({ ...freshDraft(), why: { chips: [], own: ['  '], note: '  ' } })).toBeNull()
  })

  it('any one part is enough, and the why is the heart of it', () => {
    expect(feelOf({ ...freshDraft(), heat: 5 })).toEqual({ heat: 5, ease: null, why: NO_WHY })
    expect(feelOf({ ...freshDraft(), ease: 1 })).toEqual({ heat: null, ease: 1, why: NO_WHY })
    expect(feelOf({ ...freshDraft(), why: { chips: ['said.exposed'], own: [' greedy '], note: ' because ' } })).toEqual({ heat: null, ease: null, why: { chips: ['said.exposed'], own: ['greedy'], note: 'because' } })
  })
})

describe('reading a saved draft', () => {
  const full: BoothDraft = {
    step: 2,
    words: 'I keep thinking about Saturday.',
    heat: 4,
    ease: 2,
    why: { chips: ['said.aroused', 'said.exposed'], own: ['greedy'], note: 'Because I never thought I would.' },
    teaser: 'About Saturday',
    showHeat: true,
    wants: 'talk',
    keep: 'once',
    openMode: 'at',
    opensAt: '2026-11-13T21:00:00.000Z',
    holdBack: ['voice'],
  }

  it('gives back what was saved', () => {
    expect(parseDraft(saved(full), NOW)).toEqual(full)
  })

  it('there is none when nothing was saved, or it is older than a day', () => {
    expect(parseDraft(null, NOW)).toBeNull()
    expect(parseDraft('', NOW)).toBeNull()
    expect(parseDraft(saved(full, NOW - 23 * HOUR), NOW)).toEqual(full)
    expect(parseDraft(saved(full, NOW - 25 * HOUR), NOW)).toBeNull()
  })

  it('something that does not look like a draft is none', () => {
    expect(parseDraft('not json', NOW)).toBeNull()
    expect(parseDraft('{}', NOW)).toBeNull()
    expect(parseDraft(JSON.stringify({ draft: full }), NOW)).toBeNull()
    expect(parseDraft(JSON.stringify({ at: NOW }), NOW)).toBeNull()
    expect(parseDraft('null', NOW)).toBeNull()
  })

  it('whatever is odd in it falls back to the gentle choice, and the words survive', () => {
    const odd = { step: 9, words: 'still here', heat: 11, ease: 'very', why: { chips: ['said.shy', 7], own: 'greedy', note: 3 }, teaser: null, showHeat: 'yes', wants: 'obey', keep: 'forever', openMode: 'never', opensAt: 'soon', holdBack: ['voice', 'video'] }
    expect(parseDraft(saved(odd), NOW)).toEqual({ ...freshDraft(), words: 'still here', why: { chips: ['said.shy'], own: [], note: null }, holdBack: ['voice'] })
  })

  it('an older draft without the newer fields still opens', () => {
    expect(parseDraft(saved({ words: 'from an older version' }), NOW)).toEqual({ ...freshDraft(), words: 'from an older version' })
  })

  it('never holds a recording: sound stays in memory until the envelope is sealed', () => {
    const parsed = parseDraft(saved({ ...full, voice: 'data:audio/webm;base64,AAAA', recording: { blob: 'x' } }), NOW)
    expect(Object.keys(parsed as object).sort()).toEqual(Object.keys(freshDraft()).sort())
    expect(JSON.stringify(parsed)).not.toContain('audio')
  })
})
