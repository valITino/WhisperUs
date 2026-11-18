// A step on a check-in's scale, said in words: for the line on the room that tells the
// other one how somebody is today, and for reading a column of the cockpit out.

import type { CheckinScale } from '../../data/types'
import type { Lang } from '../../i18n'
import { stepBetween } from '../share/steps'
import { SCALES } from './library'

export function stepWords(scale: CheckinScale, value: number, lang: Lang): string {
  const words = SCALES[scale][lang]
  return stepBetween(words.low, words.high, value, lang)
}
