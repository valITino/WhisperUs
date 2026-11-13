import type { Score5 } from '../../data/types'
import { buzz, cx } from './cx'

interface Props {
  label: string
  value: Score5 | null
  onChange: (value: Score5 | null) => void
  /** The two ends, for example "Took all my courage" and "Came easy". */
  low: string
  high: string
}

const STEPS: Score5[] = [1, 2, 3, 4, 5]

/** Five steps between two poles. Tapping the chosen step clears it: not answering is allowed. */
export function Scale({ label, value, onChange, low, high }: Props) {
  return (
    <div>
      <div role="radiogroup" aria-label={label} className="flex items-center justify-between gap-2">
        {STEPS.map((step) => (
          <button
            key={step}
            type="button"
            role="radio"
            aria-checked={value === step}
            aria-label={`${step} / 5${step === 1 ? `: ${low}` : step === 5 ? `: ${high}` : ''}`}
            onClick={() => {
              buzz(8)
              onChange(value === step ? null : step)
            }}
            className="grid min-h-12 flex-1 place-items-center"
          >
            <span
              className={cx(
                'block rounded-full border-[1.5px] transition-all duration-150',
                value === step ? 'size-7 border-accent bg-accent' : 'size-5 border-line-strong bg-surface',
              )}
            />
          </button>
        ))}
      </div>
      <div className="mt-0.5 flex justify-between gap-4 text-xs font-semibold text-ink-soft">
        <span>{low}</span>
        <span className="text-right">{high}</span>
      </div>
    </div>
  )
}
