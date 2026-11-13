// "PIN and devices": change the PIN, log out the other devices, log out this one.

import { useState } from 'react'
import { backend } from '../../data/app'
import { useCopy } from '../../i18n'
import { Button, buzz, Card, toast } from '../../ui/components'
import { pairingCopy } from '../onboarding/copy'
import { NewPinFields, newPinTrouble, type PinTrouble } from '../onboarding/NewPinFields'
import { ErrorNote, StepPage } from '../onboarding/parts'
import { useExplain } from '../onboarding/useExplain'
import { useLogOut } from '../onboarding/useLogOut'
import { settingsCopy } from './copy'

export function PinPage() {
  const c = useCopy(settingsCopy)
  const p = useCopy(pairingCopy)
  const explain = useExplain()
  const logOut = useLogOut()
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [trouble, setTrouble] = useState<PinTrouble | null>(null)
  const [problem, setProblem] = useState<{ at: 'pin' | 'devices'; message: string } | null>(null)
  const [working, setWorking] = useState<'pin' | 'devices' | null>(null)
  // A fresh pair of fields after a change, so nothing of the old PIN lingers on screen.
  const [round, setRound] = useState(0)

  const typing = (set: (value: string) => void) => (value: string) => {
    setTrouble(null)
    setProblem(null)
    set(value)
  }

  const change = async () => {
    const wrong = newPinTrouble(pin, again, p.pin)
    setTrouble(wrong)
    if (wrong) return
    setProblem(null)
    setWorking('pin')
    try {
      await backend.setPin(pin)
      setPin('')
      setAgain('')
      setRound((n) => n + 1)
      buzz(12)
      toast(c.pin.changed)
    } catch (e) {
      setProblem({ at: 'pin', message: explain(e) })
    }
    setWorking(null)
  }

  const logOutOthers = async () => {
    setProblem(null)
    setWorking('devices')
    try {
      toast(c.pin.othersDone(await backend.signOutOtherDevices()))
    } catch (e) {
      setProblem({ at: 'devices', message: explain(e) })
    }
    setWorking(null)
  }

  return (
    <StepPage title={c.pin.title} backTo="/settings">
      <div className="flex flex-col gap-8 px-4" data-testid="pin-page">
        <section aria-labelledby="change-pin-title" className="flex flex-col gap-4">
          <div>
            <h2 id="change-pin-title" className="text-xl">
              {c.pin.changeTitle}
            </h2>
            <p className="mt-1.5 text-sm text-ink-soft">{c.pin.changeLead}</p>
          </div>
          <NewPinFields key={round} pin={pin} again={again} onPin={typing(setPin)} onAgain={typing(setAgain)} trouble={trouble} label={c.pin.newLabel} onEnter={() => void change()} />
          {problem?.at === 'pin' && <ErrorNote>{problem.message}</ErrorNote>}
          <Button size="lg" block disabled={working === 'pin'} onClick={() => void change()}>
            {c.pin.change}
          </Button>
        </section>

        <section aria-labelledby="devices-title">
          <h2 id="devices-title" className="mb-2.5 text-xl">
            {c.pin.devicesTitle}
          </h2>
          <Card pad={false} className="divide-y divide-line px-4">
            <div className="flex flex-col items-start gap-2.5 py-4">
              <p className="text-sm text-ink-soft">{c.pin.othersHint}</p>
              <Button variant="secondary" disabled={working === 'devices'} onClick={() => void logOutOthers()}>
                {c.pin.others}
              </Button>
              {problem?.at === 'devices' && <ErrorNote>{problem.message}</ErrorNote>}
            </div>
            <div className="flex flex-col items-start gap-2.5 py-4">
              <p className="text-sm text-ink-soft">{c.pin.logOutHint}</p>
              <Button variant="secondary" disabled={logOut.working} onClick={logOut.start}>
                {c.pin.logOut}
              </Button>
              {logOut.problem && <ErrorNote>{logOut.problem}</ErrorNote>}
            </div>
          </Card>
        </section>
      </div>
      {logOut.sheet}
    </StepPage>
  )
}
