import { motion } from 'motion/react'
import type { Score5 } from '../../data/types'
import { Flame } from '../deco/Deco'
import { buzz, cx } from './cx'

interface Props {
  /** What is being rated, for screen readers: "How hot is this for you?" */
  label: string
  value: Score5 | null
  /** Leave out to show a value without letting it be changed. */
  onChange?: (value: Score5 | null) => void
  /** What each step means, read out and shown below: five short phrases. */
  words?: readonly string[]
  size?: number
}

const STEPS: Score5[] = [1, 2, 3, 4, 5]

/**
 * Heat, in flames: one to five. Tapping the step that is already chosen takes the
 * rating away again, because "I would rather not say" is always an answer.
 */
export function HeatMeter({ label, value, onChange, words, size = 34 }: Props) {
  if (!onChange) {
    return (
      <span role="img" aria-label={`${label}: ${value ?? 0} / 5`} className="inline-flex items-center gap-0.5 text-ink-soft">
        {STEPS.map((step) => (
          <Flame key={step} size={size} on={value !== null && step <= value} />
        ))}
      </span>
    )
  }
  return (
    <div>
      <div role="radiogroup" aria-label={label} className="flex items-center justify-between gap-1">
        {STEPS.map((step) => {
          const on = value !== null && step <= value
          return (
            <motion.button
              key={step}
              type="button"
              role="radio"
              aria-checked={value === step}
              aria-label={words ? `${step}: ${words[step - 1]}` : String(step)}
              whileTap={{ scale: 0.86 }}
              onClick={() => {
                buzz(8)
                onChange(value === step ? null : step)
              }}
              className={cx('grid min-h-12 flex-1 place-items-center rounded-xl text-ink-soft transition-opacity', !on && 'opacity-80')}
            >
              <Flame size={size} on={on} />
            </motion.button>
          )
        })}
      </div>
      {words && <p className="mt-1 min-h-5 text-center text-xs font-semibold text-ink-soft">{value ? words[value - 1] : ' '}</p>}
    </div>
  )
}
