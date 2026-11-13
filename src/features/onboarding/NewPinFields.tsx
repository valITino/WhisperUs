// Choosing a PIN: type it, then type it again. Used when opening or joining a room,
// when a restore code lets someone back in, and for "Change PIN" in Settings.

import { useId } from 'react'
import { pinProblem } from '../../data/pin'
import { useCopy } from '../../i18n'
import type { PairingCopy } from './copy'
import { pairingCopy } from './copy'
import { PinField } from './PinField'

export interface PinTrouble {
  /** Which of the two fields the message belongs to. */
  field: 'pin' | 'again'
  message: string
}

/** What is wrong with a newly chosen PIN, or null when it is fine. The cloud checks the same rules. */
export function newPinTrouble(pin: string, again: string, c: PairingCopy['pin']): PinTrouble | null {
  const problem = pinProblem(pin)
  if (problem === 'pin_invalid') return { field: 'pin', message: c.invalid }
  if (problem === 'pin_too_simple') return { field: 'pin', message: c.tooSimple }
  if (pin !== again) return { field: 'again', message: c.mismatch }
  return null
}

interface Props {
  pin: string
  again: string
  onPin: (pin: string) => void
  onAgain: (pin: string) => void
  trouble: PinTrouble | null
  /** Label of the first field, when "PIN" is not specific enough ("New PIN"). */
  label?: string
  /** Label of the second field, when it is not a PIN that is repeated. */
  againLabel?: string
  /** Pressing "done" in the second field. */
  onEnter?: () => void
  autoFocus?: boolean
}

export function NewPinFields({ pin, again, onPin, onAgain, trouble, label, againLabel, onEnter, autoFocus }: Props) {
  const c = useCopy(pairingCopy)
  const againId = useId()
  return (
    <div className="flex flex-col gap-5">
      <PinField
        label={label ?? c.pin.label}
        hint={c.pin.hint}
        value={pin}
        onChange={onPin}
        error={trouble?.field === 'pin' ? trouble.message : null}
        enterKeyHint="next"
        autoFocus={autoFocus}
        onComplete={() => document.getElementById(againId)?.focus()}
        onEnter={() => document.getElementById(againId)?.focus()}
      />
      <PinField id={againId} label={againLabel ?? c.pin.again} value={again} onChange={onAgain} error={trouble?.field === 'again' ? trouble.message : null} onEnter={onEnter} />
    </div>
  )
}
