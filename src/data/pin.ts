// The PIN that lets a person back into their profile from any phone or tablet.
// Six digits. The cloud checks the same rules (supabase/migrations/0006_pin_login.sql).

export const PIN_LENGTH = 6

export type PinProblem = 'pin_invalid' | 'pin_too_simple'

const RUN_UP = '01234567890123456789'
const RUN_DOWN = '98765432109876543210'

/** Null when the PIN is fine, otherwise what is wrong with it. */
export function pinProblem(pin: string): PinProblem | null {
  if (!/^\d{6}$/.test(pin)) return 'pin_invalid'
  // 000000, 123456, 654321, 121212, 123123: the first guesses of anyone who tries.
  if (/^(\d)\1{5}$/.test(pin) || /^(\d\d)\1\1$/.test(pin) || /^(\d\d\d)\1$/.test(pin)) return 'pin_too_simple'
  if (RUN_UP.includes(pin) || RUN_DOWN.includes(pin)) return 'pin_too_simple'
  return null
}

/** Two names are the same person when they match without capitals and outer spaces. */
export const nameKey = (name: string): string => name.trim().toLowerCase()

/** Wrong tries allowed before a name is paused. */
export const PIN_TRIES = 5

/** How long a name is paused after its n-th lockout in a row: 15 minutes, doubling, at most a day. */
export function lockMinutes(lockouts: number): number {
  return Math.min(15 * 2 ** Math.max(0, lockouts - 1), 24 * 60)
}
