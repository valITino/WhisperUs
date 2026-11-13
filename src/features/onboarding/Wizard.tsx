// The step-by-step start: name and avatar, status line, PIN.
// The same three steps open a new room and join an existing one; joining shows who
// invites on the first step, opening asks for the room's name there.
//
// The wizard is one page in the browser's history. Going back (the arrow in the header
// or Android's own back button) returns to the previous step, and from the first step
// leaves the wizard. The draft survives a reload; the PIN never leaves memory.

import { useEffect, useRef, useState } from 'react'
import { setBlocker } from '../../app/router'
import type { InvitePeek } from '../../data/backend'
import { useCopy } from '../../i18n'
import { Avatar, Button, Card, cx, Field } from '../../ui/components'
import { AvatarMaker } from '../profile/AvatarMaker'
import { profileCopy } from '../profile/copy'
import { sameName, type ProfileDraft } from '../profile/draft'
import { focusNameField, NameField, StatusEditor } from '../profile/ProfileForm'
import { pairingCopy } from './copy'
import { NewPinFields, newPinTrouble, type PinTrouble } from './NewPinFields'
import { ErrorNote, StepPage } from './parts'
import type { Setup } from './setupDraft'

export const STEPS = ['you', 'status', 'pin'] as const
export type StepName = (typeof STEPS)[number]

/** Where a problem reported by the cloud belongs. */
export interface StepProblem {
  step: StepName
  message: string
}

interface Props {
  flow: 'start' | 'join'
  setup: Setup
  onSetup: (patch: Partial<Setup>) => void
  pin: string
  pinAgain: string
  onPin: (pin: string) => void
  onPinAgain: (pin: string) => void
  /** Joining: what the code leads to. */
  peek?: InvitePeek
  problem: StepProblem | null
  onProblemSeen: () => void
  onSubmit: () => void
  /** Where the back arrow leads from the first step. */
  exitTo: string
}

function Progress({ step }: { step: number }) {
  const c = useCopy(pairingCopy)
  return (
    <div className="flex items-center gap-3 px-4">
      <div className="flex flex-1 gap-1.5" aria-hidden>
        {STEPS.map((name, i) => (
          <span key={name} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-200', i <= step ? 'bg-candle' : 'bg-line-strong')} />
        ))}
      </div>
      <p className="tabular shrink-0 text-2xs font-extrabold text-ink-soft" data-testid="wizard-step">
        {c.wizard.step(step + 1, STEPS.length)}
      </p>
    </div>
  )
}

export function Wizard({ flow, setup, onSetup, pin, pinAgain, onPin, onPinAgain, peek, problem, onProblemSeen, onSubmit, exitTo }: Props) {
  const c = useCopy(pairingCopy)
  const pc = useCopy(profileCopy)
  const step = Math.min(setup.step, STEPS.length - 1)
  const name = STEPS[step]
  const { profile } = setup
  const [trouble, setTrouble] = useState<string | null>(null)
  const [pinTrouble, setPinTrouble] = useState<PinTrouble | null>(null)

  const goTo = (next: number) => {
    setTrouble(null)
    setPinTrouble(null)
    onProblemSeen()
    onSetup({ step: next })
  }

  // Going back in the browser's history means "previous step" while there is one.
  const latest = useRef({ step, goTo })
  latest.current = { step, goTo }
  useEffect(() => {
    setBlocker(() => {
      if (latest.current.step === 0) return false
      latest.current.goTo(latest.current.step - 1)
      return true
    })
    return () => setBlocker(null)
  }, [])

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  const edit = (patch: Partial<ProfileDraft>) => {
    setTrouble(null)
    onProblemSeen()
    onSetup({ profile: { ...profile, ...patch } })
  }

  const next = () => {
    if (name === 'you') {
      const taken = peek?.host && sameName(profile.name, peek.host.name)
      if (!profile.name.trim() || taken) {
        focusNameField()
        return setTrouble(taken ? pc.nameTaken(profile.name.trim()) : pc.nameMissing)
      }
    }
    if (name === 'pin') {
      const wrong = newPinTrouble(pin, pinAgain, c.pin)
      setPinTrouble(wrong)
      if (!wrong) onSubmit()
      return
    }
    goTo(step + 1)
  }

  const complaint = trouble ?? (problem?.step === name ? problem.message : null)

  return (
    <StepPage
      title={flow === 'start' ? c.wizard.startTitle : c.wizard.joinTitle}
      backTo={exitTo}
      footer={
        <>
          {complaint && <ErrorNote>{complaint}</ErrorNote>}
          <Button size="lg" block onClick={next}>
            {name !== 'pin' ? c.wizard.next : flow === 'start' ? c.wizard.submitStart : c.wizard.submitJoin}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6" data-testid={`step-${name}`}>
        <Progress step={step} />

        {name === 'you' && (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-4 px-4">
              {peek && (
                <Card tone="haze" pad={false} className="flex items-center gap-4 px-4 py-4" data-testid="invitation">
                  {peek.host && <Avatar avatar={peek.host.avatar} color={peek.host.color} accessory={peek.host.accessory} size={60} />}
                  <div className="min-w-0">
                    <p className="text-balance font-display text-lg font-semibold leading-tight">{peek.host ? c.invitation.from(peek.host.name, peek.roomName) : c.invitation.plain(peek.roomName)}</p>
                    <p className="whispered mt-1.5 text-balance text-base leading-tight text-accent">{c.invitation.script}</p>
                  </div>
                </Card>
              )}
              <h2 className="text-2xl">{c.wizard.youTitle}</h2>
              <NameField draft={profile} onChange={edit} />
              {flow === 'start' && (
                <Field
                  label={c.wizard.roomLabel}
                  placeholder={c.wizard.roomPlaceholder}
                  hint={c.wizard.roomHint}
                  value={setup.roomName}
                  maxLength={80}
                  enterKeyHint="done"
                  onChange={(e) => onSetup({ roomName: e.target.value })}
                />
              )}
            </div>
            <AvatarMaker draft={profile} onChange={edit} />
          </div>
        )}

        {name === 'status' && (
          <div className="flex flex-col gap-4 px-4">
            <div>
              <h2 className="text-2xl">{c.wizard.statusTitle}</h2>
              <p className="mt-2 text-sm text-ink-soft">{c.wizard.statusLead}</p>
            </div>
            <StatusEditor draft={profile} onChange={edit} />
          </div>
        )}

        {name === 'pin' && (
          <div className="flex flex-col gap-5 px-4">
            <div>
              <h2 className="text-2xl">{c.wizard.pinTitle}</h2>
              <p className="mt-2 text-sm text-ink-soft">{c.wizard.pinLead}</p>
              <p className="mt-1.5 text-sm text-ink-soft">{c.wizard.loginAs(profile.name.trim())}</p>
            </div>
            <NewPinFields
              pin={pin}
              again={pinAgain}
              onPin={(value) => {
                setPinTrouble(null)
                onProblemSeen()
                onPin(value)
              }}
              onAgain={(value) => {
                setPinTrouble(null)
                onProblemSeen()
                onPinAgain(value)
              }}
              trouble={pinTrouble}
              onEnter={next}
            />
          </div>
        )}
      </div>
    </StepPage>
  )
}
