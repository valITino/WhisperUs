// A step between two poles, said in words: "Rather 'Very hard'", "In between".
// Shared by the check-in, the questions about myself and the cockpit.

import type { Lang } from '../../i18n'

const WORDS = {
  en: { between: 'In between', rather: (pole: string) => `Rather "${pole}"` },
  de: { between: 'Dazwischen', rather: (pole: string) => `Eher «${pole}»` },
}

/** 1 and 5 are the poles themselves, 2 and 4 lean towards one, 3 is in between. */
export function stepBetween(low: string, high: string, value: number, lang: Lang): string {
  const step = Math.round(value)
  if (step <= 1) return low
  if (step >= 5) return high
  if (step === 3) return WORDS[lang].between
  return WORDS[lang].rather(step < 3 ? low : high)
}
