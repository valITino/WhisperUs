// The field for an invite or restore code. It shows the code in two groups of five while
// you type, accepts a pasted invite link, and keeps the cursor where it was.

import { Field } from '../../ui/components'
import { caretAfterGrouping, cleanCode, groupCode, readInvite } from './codes'

interface Props {
  label: string
  hint?: string
  placeholder?: string
  /** The clean code: letters and digits only. */
  value: string
  onChange: (code: string) => void
  /** Pressing "go" on the keyboard. */
  onEnter?: () => void
}

export function CodeField({ label, hint, placeholder, value, onChange, onEnter }: Props) {
  return (
    <Field
      label={label}
      hint={hint}
      placeholder={placeholder}
      value={groupCode(value)}
      inputMode="text"
      autoCapitalize="characters"
      autoComplete="off"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="go"
      onKeyDown={(e) => {
        if (e.key === 'Enter') onEnter?.()
      }}
      onChange={(e) => {
        const input = e.target
        const raw = input.value
        const isLink = /\/join\/|code=/.test(raw)
        const next = isLink ? readInvite(raw) : cleanCode(raw)
        // Count the letters and digits in front of the cursor, then put it back behind the same ones.
        const before = isLink ? next.length : cleanCode(raw.slice(0, input.selectionStart ?? raw.length)).length
        onChange(next)
        requestAnimationFrame(() => {
          if (document.activeElement !== input) return
          const at = caretAfterGrouping(groupCode(next), before)
          input.setSelectionRange(at, at)
        })
      }}
    />
  )
}
