// Settings, Privacy, App lock: turn it on with a code, choose how soon it locks, change
// the code, turn it off. Changing and turning off ask for the current code first, so a
// device that happens to be open cannot be quietly unlocked for good.

import { useState } from 'react'
import { PIN_LENGTH } from '../../data/pin'
import { setPref, usePref } from '../../data/prefs'
import { useCopy } from '../../i18n'
import { Button, buzz, Card, Segmented, Sheet, toast } from '../../ui/components'
import { pairingCopy } from '../onboarding/copy'
import { NewPinFields, newPinTrouble, type PinTrouble } from '../onboarding/NewPinFields'
import { ErrorNote, StepPage } from '../onboarding/parts'
import { PinField } from '../onboarding/PinField'
import { lockCopy } from './copy'
import { checkLockCode, lockedUntil, lockNow, removeLock, setLockCode, useLockOn } from './lock'
import { useCountdown } from './LockScreen'

const AFTER = [0, 60, 300] as const

/** Ask for the code this device has now. Calls onRight once it was typed correctly. */
function CurrentCode({ onRight }: { onRight: () => void }) {
  const c = useCopy(lockCopy)
  const [code, setCode] = useState('')
  const [triesLeft, setTriesLeft] = useState<number | null>(null)
  const [until, setUntil] = useState<number | null>(() => lockedUntil())
  const wait = useCountdown(until)

  const check = async (typed: string) => {
    if (typed.length < PIN_LENGTH || wait !== null) return
    const answer = await checkLockCode(typed)
    if (answer.ok) return onRight()
    setCode('')
    setTriesLeft(answer.retryAt ? null : answer.triesLeft)
    setUntil(answer.retryAt)
  }

  const trouble = wait !== null ? c.screen.wait(wait) : triesLeft !== null ? c.screen.wrong(triesLeft) : null
  return (
    <div className="flex flex-col gap-3">
      <PinField
        label={c.settings.currentLabel}
        hint={c.settings.currentHint}
        value={code}
        autoFocus
        invalid={trouble !== null}
        onChange={(next) => {
          setCode(next)
          if (next.length === PIN_LENGTH) void check(next)
        }}
        onEnter={() => void check(code)}
      />
      {trouble && <ErrorNote>{trouble}</ErrorNote>}
    </div>
  )
}

function NewCode({ submitLabel, onDone }: { submitLabel: string; onDone: () => void }) {
  const c = useCopy(lockCopy).settings
  const p = useCopy(pairingCopy)
  const [code, setCode] = useState('')
  const [again, setAgain] = useState('')
  const [trouble, setTrouble] = useState<PinTrouble | null>(null)
  const [saving, setSaving] = useState(false)

  const save = async () => {
    // The same checks as for a PIN, said in the lock's own words: this is a code, not the PIN.
    const wrong = newPinTrouble(code, again, { ...p.pin, invalid: c.invalid, tooSimple: c.tooSimple, mismatch: c.mismatch })
    setTrouble(wrong)
    if (wrong) return
    setSaving(true)
    await setLockCode(code)
    setSaving(false)
    buzz([12, 40, 12])
    onDone()
  }

  return (
    <div className="flex flex-col gap-5">
      <NewPinFields
        label={c.newLabel}
        againLabel={c.againLabel}
        pin={code}
        again={again}
        onPin={(next) => {
          setTrouble(null)
          setCode(next)
        }}
        onAgain={(next) => {
          setTrouble(null)
          setAgain(next)
        }}
        trouble={trouble}
        onEnter={() => void save()}
      />
      <Button size="lg" block disabled={saving} onClick={() => void save()}>
        {submitLabel}
      </Button>
    </div>
  )
}

export function LockSettings() {
  const c = useCopy(lockCopy).settings
  const on = useLockOn()
  const after = usePref('lockAfter')
  /** Which sheet is open, and whether the current code has been given in it. */
  const [sheet, setSheet] = useState<{ kind: 'change' | 'off'; cleared: boolean } | null>(null)

  return (
    <StepPage title={c.title} backTo="/settings">
      <div className="flex flex-col gap-6 px-4" data-testid="lock-settings" data-lock={on ? 'on' : 'off'}>
        <div className="flex flex-col gap-2">
          <p className="text-sm leading-relaxed">{c.what}</p>
          <p className="text-xs leading-relaxed text-ink-soft">{c.honest}</p>
        </div>

        {!on ? (
          <section aria-labelledby="lock-choose" className="flex flex-col gap-4">
            <h2 id="lock-choose" className="text-xl">
              {c.chooseTitle}
            </h2>
            <NewCode submitLabel={c.turnOn} onDone={() => toast(c.turnedOn)} />
          </section>
        ) : (
          <>
            <Card pad={false} className="flex flex-col gap-3 p-4">
              <h2 className="text-lg">{c.onTitle}</h2>
              <div>
                <p className="mb-2 text-sm font-semibold">{c.afterLabel}</p>
                <Segmented<string>
                  label={c.afterLabel}
                  value={String(AFTER.includes(after as (typeof AFTER)[number]) ? after : 0)}
                  options={AFTER.map((seconds) => ({ value: String(seconds), label: c.after[seconds] }))}
                  onChange={(next) => {
                    buzz(8)
                    setPref('lockAfter', Number(next))
                  }}
                />
                <p className="mt-2 text-xs text-ink-soft">{c.afterHint}</p>
              </div>
            </Card>
            <div className="flex flex-col gap-2.5">
              <Button variant="secondary" block onClick={lockNow}>
                {c.lockNow}
              </Button>
              <Button variant="secondary" block onClick={() => setSheet({ kind: 'change', cleared: false })}>
                {c.change}
              </Button>
              <Button variant="quiet" block onClick={() => setSheet({ kind: 'off', cleared: false })}>
                {c.turnOff}
              </Button>
            </div>
          </>
        )}
      </div>

      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet?.kind === 'off' ? c.turnOffTitle : c.changeTitle}>
        {sheet && (
          <div className="pb-2" data-testid="lock-sheet">
            {!sheet.cleared ? (
              <CurrentCode
                onRight={() => {
                  if (sheet.kind === 'change') return setSheet({ kind: 'change', cleared: true })
                  removeLock()
                  setSheet(null)
                  toast(c.turnedOff)
                }}
              />
            ) : (
              <NewCode
                submitLabel={c.change}
                onDone={() => {
                  setSheet(null)
                  toast(c.changed)
                }}
              />
            )}
          </div>
        )}
      </Sheet>
    </StepPage>
  )
}
