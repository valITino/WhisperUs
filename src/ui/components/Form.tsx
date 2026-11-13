import { motion } from 'motion/react'
import { useId, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { buzz, cx } from './cx'

const fieldBox =
  'w-full rounded-field border-[1.5px] border-line-strong bg-surface px-4 text-base font-semibold text-ink placeholder:text-ink-soft placeholder:font-medium focus:border-accent focus:outline-none focus:ring-3 focus:ring-candle/40'

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  hint?: string
}

export function Field({ label, hint, className, id, ...rest }: FieldProps) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1.5 block text-xs font-extrabold">
        {label}
      </label>
      <input id={fieldId} className={cx(fieldBox, 'min-h-13')} aria-describedby={hint ? `${fieldId}-hint` : undefined} {...rest} />
      {hint && (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-xs text-ink-soft">
          {hint}
        </p>
      )}
    </div>
  )
}

interface AreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string
}

export function TextArea({ label, className, id, rows = 3, ...rest }: AreaProps) {
  const auto = useId()
  const fieldId = id ?? auto
  return (
    <div className={className}>
      <label htmlFor={fieldId} className="mb-1.5 block text-xs font-extrabold">
        {label}
      </label>
      <textarea id={fieldId} rows={rows} className={cx(fieldBox, 'resize-none py-3 leading-snug')} {...rest} />
    </div>
  )
}

interface ToggleProps {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
  /** Only the switch: the label is read aloud but not shown. For rows that name the thing themselves. */
  bare?: boolean
}

export function Toggle({ label, checked, onChange, bare = false }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={bare ? label : undefined}
      onClick={() => {
        buzz(8)
        onChange(!checked)
      }}
      className={bare ? 'flex min-h-12 shrink-0 items-center' : 'flex min-h-12 w-full items-center justify-between gap-4 text-left'}
    >
      {!bare && <span className="text-sm font-bold">{label}</span>}
      <span className={cx('flex h-8 w-14 shrink-0 items-center rounded-full p-1 transition-colors duration-200', checked ? 'bg-candle' : 'bg-line-strong')}>
        {/* The knob slides by its own distance. (A layout animation would also chase the switch
            whenever something above it on the page appears or goes away.) */}
        <motion.span initial={false} animate={{ x: checked ? 24 : 0 }} transition={{ type: 'spring', stiffness: 600, damping: 30 }} className="grid size-6 place-items-center rounded-full bg-[#fffdf9] shadow-paper">
          {checked && (
            <svg width="12" height="12" viewBox="0 0 48 48" aria-hidden>
              <path d="M24 40C10 30 6 22 7 16c1-6 6-9 11-8 3 .5 5 2.5 6 5 1-2.5 3-4.5 6-5 5-1 10 2 11 8 1 6-3 14-17 24Z" fill="#c8414b" />
            </svg>
          )}
        </motion.span>
      </span>
    </button>
  )
}

interface StepperProps {
  label: string
  value: number
  min?: number
  max?: number
  onChange: (value: number) => void
}

export function Stepper({ label, value, min = 1, max = 12, onChange }: StepperProps) {
  const step = (delta: number) => {
    const next = Math.min(max, Math.max(min, value + delta))
    if (next !== value) {
      buzz(8)
      onChange(next)
    }
  }
  const btn = 'grid size-11 place-items-center rounded-full border-[1.5px] border-line-strong bg-surface text-lg font-extrabold disabled:opacity-35'
  return (
    <div className="flex min-h-12 items-center justify-between gap-4">
      <span className="text-sm font-bold">{label}</span>
      <div className="flex items-center gap-2">
        <button type="button" className={btn} onClick={() => step(-1)} disabled={value <= min} aria-label={`${label}: −1`}>
          −
        </button>
        <output className="tabular w-8 text-center font-display text-lg font-bold" aria-live="polite">
          {value}
        </output>
        <button type="button" className={btn} onClick={() => step(1)} disabled={value >= max} aria-label={`${label}: +1`}>
          +
        </button>
      </div>
    </div>
  )
}
