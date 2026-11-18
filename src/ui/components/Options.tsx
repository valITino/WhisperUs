import type { ReactNode } from 'react'
import { buzz, cx } from './cx'

interface Props<T extends string | number> {
  /** What is being asked, for screen readers. */
  label: string
  value: T | null
  options: readonly { value: T; label: ReactNode; hint?: string }[]
  /** Tapping the chosen one takes it away again: not answering is allowed. */
  onChange: (value: T | null) => void
  /** Each option on a line of its own, for answers that are sentences. */
  stacked?: boolean
}

/** One answer out of a few, as chips that wrap. For more words than fit side by side. */
export function Options<T extends string | number>({ label, value, options, onChange, stacked = false }: Props<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('flex gap-2', stacked ? 'flex-col' : 'flex-wrap')}>
      {options.map((option) => {
        const on = value === option.value
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => {
              buzz(8)
              onChange(on ? null : option.value)
            }}
            className={cx(
              'min-h-11 text-left font-bold leading-tight transition-colors duration-150',
              stacked ? 'rounded-card px-4 py-3 text-sm' : 'rounded-full px-4 py-2 text-xs',
              on ? 'bg-ink text-ground' : 'border-[1.5px] border-line-strong bg-surface text-ink',
            )}
          >
            <span className="block">{option.label}</span>
            {option.hint && <span className={cx('mt-0.5 block text-xs font-medium leading-snug', on ? 'text-ground/80' : 'text-ink-soft')}>{option.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
