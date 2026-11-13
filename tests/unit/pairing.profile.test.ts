import { describe, expect, it } from 'vitest'
import { profileCopy } from '../../src/features/profile/copy'
import { asGuestOf, changesBetween, clip, defaultDraft, DISC_COLORS, draftFromMember, isReady, nextSuggestion, sameName, STATUS_MAX, toProfileInput, type ProfileDraft } from '../../src/features/profile/draft'
import { ACCESSORIES, AVATARS } from '../../src/ui/components/Bits'

const mia: ProfileDraft = { name: 'Mia', avatar: 'cat', color: 'wax', accessory: 'horns', status: 'Tonight I am brave' }

describe('profile drafts', () => {
  it('starts whoever opens the room as the moon, and whoever joins as its counterpart', () => {
    expect(defaultDraft()).toMatchObject({ avatar: 'moon', color: 'candle', accessory: null, status: '' })
    expect(defaultDraft('moon')).toMatchObject({ avatar: 'sun', color: 'plum' })
    expect(defaultDraft('cat')).toMatchObject({ avatar: 'sun' })
    // The host took the sun already: the guest gets the moon.
    expect(defaultDraft('sun')).toMatchObject({ avatar: 'moon' })
    expect(defaultDraft(null)).toMatchObject({ avatar: 'sun' })
    expect(isReady(defaultDraft())).toBe(false)
    expect(isReady({ ...defaultDraft(), name: '  ' })).toBe(false)
    expect(isReady(mia)).toBe(true)
  })

  it('hands the whole profile over in one go when opening or joining a room', () => {
    expect(toProfileInput({ ...mia, name: '  Mia  ' })).toEqual({ name: 'Mia', avatar: 'cat', color: 'wax', accessory: 'horns', status: 'Tonight I am brave' })
    expect(toProfileInput({ ...mia, status: '   ', accessory: null })).toMatchObject({ status: null, accessory: null })
  })

  it("gives a guest the counterpart of the host's look until they have touched their own", () => {
    expect(asGuestOf(defaultDraft(), 'moon')).toMatchObject({ avatar: 'sun', color: 'plum' })
    expect(asGuestOf(defaultDraft(), 'sun')).toMatchObject({ avatar: 'moon', color: 'plum' })
    // Touched: it stays as chosen.
    expect(asGuestOf({ ...defaultDraft(), avatar: 'cherries' }, 'moon')).toMatchObject({ avatar: 'cherries', color: 'candle' })
    expect(asGuestOf({ ...defaultDraft(), accessory: 'crown' }, 'moon')).toMatchObject({ avatar: 'moon', accessory: 'crown' })
    // The name and status always stay.
    expect(asGuestOf({ ...defaultDraft(), name: 'Leo', status: 'Hi' }, 'moon')).toMatchObject({ name: 'Leo', status: 'Hi' })
  })

  it('treats two names as the same log-in without capitals and outer spaces', () => {
    expect(sameName('Leo', '  leo ')).toBe(true)
    expect(sameName('Leo', 'Leon')).toBe(false)
  })

  it('reads a saved profile back into a draft', () => {
    expect(draftFromMember({ name: 'Leo', avatar: 'sun', color: 'plum', accessory: null, status: null })).toEqual({
      name: 'Leo',
      avatar: 'sun',
      color: 'plum',
      accessory: null,
      status: '',
    })
  })

  it('saves only what changed', () => {
    expect(changesBetween(mia, mia)).toEqual({})
    expect(changesBetween(mia, { ...mia, status: 'Come closer' })).toEqual({ status: 'Come closer' })
    expect(changesBetween(mia, { ...mia, status: '  ' })).toEqual({ status: null })
    expect(changesBetween(mia, { ...mia, accessory: null, color: 'moss' })).toEqual({ accessory: null, color: 'moss' })
    expect(changesBetween(mia, { ...mia, name: ' Mia ' })).toEqual({})
  })

  it('cuts long text without leaving half an emoji', () => {
    expect(clip('abc', 60)).toBe('abc')
    expect(clip('x'.repeat(70), STATUS_MAX)).toHaveLength(60)
    const cut = clip('x'.repeat(59) + '🔥', STATUS_MAX)
    expect(cut).toBe('x'.repeat(59))
  })

  it('"Surprise me" walks through the suggestions and starts over', () => {
    const list = ['one', 'two', 'three']
    expect(nextSuggestion(list, '')).toBe('one')
    expect(nextSuggestion(list, 'one')).toBe('two')
    expect(nextSuggestion(list, 'three')).toBe('one')
    expect(nextSuggestion(list, 'my own words')).toBe('one')
    expect(nextSuggestion([], 'kept')).toBe('kept')
  })
})

describe('profile copy', () => {
  it('has a name for every sign, colour and accessory in both languages', () => {
    for (const c of [profileCopy.en, profileCopy.de]) {
      for (const avatar of AVATARS) expect(c.characters[avatar]).toBeTruthy()
      for (const color of DISC_COLORS) expect(c.plates[color]).toBeTruthy()
      for (const accessory of ['none', ...ACCESSORIES]) expect(c.accessories[accessory]).toBeTruthy()
    }
  })

  it('only suggests status lines that fit and are not repeated', () => {
    for (const c of [profileCopy.en, profileCopy.de]) {
      const list = c.suggestions
      expect(list.length).toBeGreaterThanOrEqual(6)
      expect(new Set(list).size).toBe(list.length)
      for (const line of list) expect(line.length).toBeLessThanOrEqual(STATUS_MAX)
      expect(c.nameTaken('Mia')).toContain('Mia')
    }
    expect(profileCopy.en.suggestions).toHaveLength(profileCopy.de.suggestions.length)
  })
})
