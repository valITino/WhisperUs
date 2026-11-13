import { describe, expect, it } from 'vitest'
import { caretAfterGrouping, cleanCode, groupCode, invitePath, readInvite } from '../../src/features/onboarding/codes'

describe('invite and restore codes', () => {
  it('cleans what was typed: letters and digits, upper case, ten at most', () => {
    expect(cleanCode(' abcde-fghjk ')).toBe('ABCDEFGHJK')
    expect(cleanCode('abcde fghjk lmnpq')).toBe('ABCDEFGHJK')
    expect(cleanCode('ab-cd')).toBe('ABCD')
    expect(cleanCode('')).toBe('')
  })

  it('shows codes in groups of five', () => {
    expect(groupCode('ABCDEFGHJK')).toBe('ABCDE-FGHJK')
    expect(groupCode('ABCDEFG')).toBe('ABCDE-FG')
    expect(groupCode('ABCDE')).toBe('ABCDE')
    expect(groupCode('')).toBe('')
  })

  it('takes the code out of a pasted link', () => {
    expect(readInvite('https://example.org/whisperus/#/join/abcdefghjk')).toBe('ABCDEFGHJK')
    expect(readInvite('https://example.org/whisperus/#/join/ABCDE-FGHJK')).toBe('ABCDEFGHJK')
    expect(readInvite('https://example.org/whisperus/#/join?code=ABCDEFGHJK')).toBe('ABCDEFGHJK')
    expect(readInvite('abcde-fghjk')).toBe('ABCDEFGHJK')
  })

  it('builds the route of an invite link, which reads back to the same code', () => {
    expect(invitePath('ABCDEFGHJK')).toBe('/join/ABCDEFGHJK')
    expect(readInvite(`https://x.test/#${invitePath('ABCDEFGHJK')}`)).toBe('ABCDEFGHJK')
  })

  it('keeps the cursor behind the same characters after regrouping', () => {
    // typing the sixth character: the dash appears in front of it
    expect(caretAfterGrouping('ABCDE-F', 6)).toBe(7)
    // editing in the middle stays in the middle
    expect(caretAfterGrouping('ABCDE-FGHJK', 3)).toBe(3)
    expect(caretAfterGrouping('ABCDE-FGHJK', 5)).toBe(5)
    expect(caretAfterGrouping('ABCDE-FGHJK', 0)).toBe(0)
    expect(caretAfterGrouping('ABCDE-FGHJK', 99)).toBe(11)
  })
})
