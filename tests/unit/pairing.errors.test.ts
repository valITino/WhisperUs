import { describe, expect, it } from 'vitest'
import { BackendError } from '../../src/data/backend'
import { errorCopy, explain } from '../../src/features/onboarding/errors'

const rejected = (code: string) => new BackendError('rejected', code)

/** Every refusal that maps to a fixed sentence. */
const CASES: [BackendError | Error, keyof typeof errorCopy.en][] = [
  [new BackendError('network', 'offline'), 'network'],
  [new BackendError('setup', 'anonymous_disabled'), 'anonymousDisabled'],
  [new BackendError('setup', 'something_else'), 'setup'],
  [new BackendError('auth', 'session_invalid'), 'auth'],
  [rejected('invite_invalid'), 'inviteInvalid'],
  [rejected('room_full'), 'roomFull'],
  [rejected('already_in_room'), 'alreadyInRoom'],
  [rejected('room_already_exists'), 'roomExists'],
  [rejected('member_not_found'), 'memberNotFound'],
  [rejected('not_in_room'), 'notInRoom'],
  [rejected('name_taken'), 'nameTaken'],
  [rejected('name_invalid'), 'nameInvalid'],
  [rejected('pin_invalid'), 'pinInvalid'],
  [rejected('pin_too_simple'), 'pinTooSimple'],
  [rejected('account_paused'), 'accountPaused'],
  [rejected('admin_only'), 'adminOnly'],
  [rejected('not_yourself'), 'notYourself'],
  [new Error('boom'), 'unknown'],
]

describe('friendly errors for opening, joining, logging in and managing the room', () => {
  for (const lang of ['en', 'de'] as const) {
    it(`maps every cloud error to its own sentence (${lang})`, () => {
      const c = errorCopy[lang]
      const sentences = CASES.map(([error, key]) => {
        const sentence = explain(error, c)
        expect(sentence).toBe(c[key])
        return sentence
      })
      expect(new Set(sentences).size).toBe(CASES.length)
      // Each one says what happened and what to do: at least two sentences, and never an em dash.
      for (const sentence of sentences.slice(0, -1)) {
        expect(sentence.split(/[.?!]\s/).length, sentence).toBeGreaterThanOrEqual(2)
        expect(sentence).not.toMatch(/—/)
      }
    })

    it(`never says whether the name exists when the PIN is wrong (${lang})`, () => {
      const c = errorCopy[lang]
      const four = explain(new BackendError('rejected', 'pin_wrong', undefined, { triesLeft: 4 }), c)
      const one = explain(new BackendError('rejected', 'pin_wrong', undefined, { triesLeft: 1 }), c)
      const plain = explain(rejected('pin_wrong'), c)
      expect(four).toContain('4')
      expect(one).not.toContain('4')
      expect(new Set([four, one, plain]).size).toBe(3)
      for (const sentence of [four, one, plain]) {
        expect(sentence).toMatch(lang === 'en' ? /^Name or PIN is not right\./ : /^Name oder PIN stimmt nicht\./)
        expect(sentence).not.toMatch(/unknown|unbekannt|no such|not exist|gibt es nicht/i)
      }
    })

    it(`says until when a name is paused after too many wrong tries (${lang})`, () => {
      const c = errorCopy[lang]
      const locked = new BackendError('rejected', 'pin_locked', undefined, { retryAt: '2026-11-10T12:15:00.000Z' })
      const sentence = explain(locked, c, (moment) => `<${moment}>`)
      expect(sentence).toContain('<2026-11-10T12:15:00.000Z>')
      // Without a time (or a way to say it) the sentence still stands on its own.
      expect(explain(locked, c)).not.toContain('undefined')
      expect(explain(rejected('pin_locked'), c, () => 'never called')).not.toContain('never called')
    })
  }

  it('explains exactly where the Supabase switch is', () => {
    const sentence = explain(new BackendError('setup', 'anonymous_disabled'), errorCopy.en)
    expect(sentence).toContain('Authentication')
    expect(sentence).toContain('Sign In / Providers')
    expect(sentence).toContain('Allow anonymous sign-ins')
    expect(explain(new BackendError('setup', 'anonymous_disabled'), errorCopy.de)).toContain('Allow anonymous sign-ins')
  })

  it('still says something useful for a code it has never seen', () => {
    expect(explain(rejected('brand_new_code'), errorCopy.en)).toContain('brand_new_code')
    expect(explain('not even an error', errorCopy.de)).toBe(errorCopy.de.unknown)
  })

  it('has forgotten the recovery key', () => {
    expect(JSON.stringify(errorCopy)).not.toMatch(/recovery|Notfallschl/i)
  })
})
