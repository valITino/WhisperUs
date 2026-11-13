// The one field for a six-digit PIN, used when opening or joining a room, logging in
// and changing the PIN.
//
// What it does on purpose:
//  - Six boxes show how long a PIN is. One real text input lies on top of them, so typing,
//    pasting, the Android number pad and screen readers all work as with any field.
//  - It is not a password field. The PIN is hidden by drawing dots, with a Show/Hide
//    button, so browsers and password managers do not offer to save it as a site password.
//  - Anything that is not a digit is dropped, which makes "12 34 56" paste cleanly.

import { useId, useState } from 'react'
import { PIN_LENGTH } from '../../data/pin'
import { useCopy } from '../../i18n'
import { cx } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { pairingCopy } from './copy'

interface Props {
  label: string
  hint?: string
  value: string
  onChange: (pin: string) => void
  /** Shown under the field, and the boxes turn red. */
  error?: string | null
  /** Red boxes without a message of its own (the message is shown elsewhere). */
  invalid?: boolean
  /** Called once all six digits are in: the place to move on to the next field. */
  onComplete?: () => void
  /** Pressing "done" or Enter on the keyboard. */
  onEnter?: () => void
  id?: string
  autoFocus?: boolean
  /** What the keyboard's action key says. */
  enterKeyHint?: 'next' | 'done' | 'go'
}

const digitsOf = (text: string) => text.replace(/\D/g, '').slice(0, PIN_LENGTH)

export function PinField({ label, hint, value, onChange, error, invalid, onComplete, onEnter, id, autoFocus, enterKeyHint = 'done' }: Props) {
  const c = useCopy(pairingCopy)
  const auto = useId()
  const fieldId = id ?? auto
  const [shown, setShown] = useState(false)
  const [focused, setFocused] = useState(false)
  const bad = Boolean(error) || Boolean(invalid)
  const described = [hint ? `${fieldId}-hint` : '', error ? `${fieldId}-error` : ''].filter(Boolean).join(' ') || undefined
  // The box that the next digit goes into (the last one when the PIN is complete).
  const active = Math.min(value.length, PIN_LENGTH - 1)

  return (
    <div>
      <label htmlFor={fieldId} className="mb-1.5 block text-xs font-extrabold">
        {label}
      </label>
      <div className="flex items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          <div className="grid grid-cols-6 gap-1.5" aria-hidden data-testid="pin-boxes">
            {Array.from({ length: PIN_LENGTH }, (_, i) => {
              const digit = value[i]
              return (
                <span
                  key={i}
                  className={cx(
                    'tabular grid h-14 place-items-center rounded-field border-[1.5px] bg-surface text-xl font-extrabold transition-colors duration-100',
                    bad ? 'border-wax' : focused && i === active ? 'border-accent ring-3 ring-candle/40' : 'border-line-strong',
                  )}
                >
                  {digit === undefined ? null : shown ? digit : <span className="size-2.5 rounded-full bg-ink" />}
                </span>
              )
            })}
          </div>
          <input
            id={fieldId}
            // A plain text field with a number pad: see the note at the top of the file.
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            data-lpignore="true"
            data-1p-ignore="true"
            data-bwignore="true"
            data-form-type="other"
            enterKeyHint={enterKeyHint}
            autoFocus={autoFocus}
            aria-invalid={bad || undefined}
            aria-describedby={described}
            value={value}
            onChange={(e) => {
              const next = digitsOf(e.target.value)
              onChange(next)
              if (next.length === PIN_LENGTH && value.length < PIN_LENGTH) onComplete?.()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onEnter?.()
            }}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            // New digits always go to the end, so the boxes and the field never disagree.
            onSelect={(e) => {
              const input = e.currentTarget
              const end = input.value.length
              if (input.selectionStart !== end || input.selectionEnd !== end) input.setSelectionRange(end, end)
            }}
            className="absolute inset-0 size-full cursor-text rounded-field text-base opacity-0"
          />
        </div>
        <button
          type="button"
          aria-pressed={shown}
          aria-label={shown ? c.pin.hide : c.pin.show}
          onClick={() => setShown((was) => !was)}
          className="min-h-11 min-w-14 shrink-0 rounded-field px-1 text-xs font-extrabold text-accent underline decoration-2 decoration-transparent underline-offset-4 active:decoration-current"
        >
          {shown ? c.pin.hideShort : c.pin.showShort}
        </button>
      </div>
      {hint && (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-xs text-ink-soft">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${fieldId}-error`} role="alert" className="mt-2 flex items-start gap-2 text-xs font-bold leading-snug">
          <span className="mt-px grid size-4 shrink-0 place-items-center rounded-full bg-wax text-on-wax" aria-hidden>
            <Icon name="close" size={10} />
          </span>
          {error}
        </p>
      )}
    </div>
  )
}
