// Invite and restore codes: cleaning what was typed or pasted, showing them in readable
// groups, and the link that carries one. Pure helpers, unit tested.

export const INVITE_LENGTH = 10
const GROUP = 5

/** Letters and digits only, upper case, cut to length. The cloud does the same. */
export function cleanCode(input: string, max = INVITE_LENGTH): string {
  return input
    .replace(/[^A-Za-z0-9]/g, '')
    .toUpperCase()
    .slice(0, max)
}

/** "ABCDEFGHJK" → "ABCDE-FGHJK" */
export function groupCode(code: string, separator = '-'): string {
  return code.match(new RegExp(`.{1,${GROUP}}`, 'g'))?.join(separator) ?? ''
}

/**
 * What someone typed or pasted into the code field. A whole invite link works too:
 * the code is taken out of it.
 */
export function readInvite(input: string): string {
  const link = /\/join\/([A-Za-z0-9-]+)/.exec(input) ?? /[?&]code=([A-Za-z0-9-]+)/.exec(input)
  return cleanCode(link ? link[1] : input)
}

/** The route (after the #) that an invite or restore link points to. */
export function invitePath(code: string): string {
  return `/join/${code}`
}

/**
 * Where the cursor belongs after a field was regrouped while typing: behind the same
 * number of letters and digits as before.
 */
export function caretAfterGrouping(grouped: string, charsBefore: number): number {
  if (charsBefore <= 0) return 0
  let seen = 0
  for (let i = 0; i < grouped.length; i++) {
    if (/[A-Z0-9]/.test(grouped[i])) seen += 1
    if (seen === charsBefore) return i + 1
  }
  return grouped.length
}
