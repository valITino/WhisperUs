// The start: everything a device shows while nobody is logged in on it.
//
//   /             welcome: start from scratch, I have a code, back to the room
//   /start        open a new room, step by step
//   /join         type a code
//   /join/CODE    an invite link (join, step by step) or a restore link (welcome back, new PIN)
//   /login        "Back to the room": name and PIN
//
// A device that the cloud has logged out lands here too (lockedOut) and gets the log-in
// form with its data kept. The screen for a paused seat is PausedScreen, shown by the shell.
//
// The app shell swaps this for the real app the instant the device is logged in. So each
// call first moves the address to where the app should open.

import { MotionConfig } from 'motion/react'
import { useEffect, useState } from 'react'
import { navigate, type Route } from '../../app/router'
import { backend, forgetThisDevice, joinRoom, logIn, resumeRoom, startRoom } from '../../data/app'
import { isBackendError, type InvitePeek, type ProfileInput } from '../../data/backend'
import { useMe } from '../../data/hooks'
import { PIN_LENGTH } from '../../data/pin'
import { useCopy } from '../../i18n'
import { Avatar, Button, buzz, Card, toast } from '../../ui/components'
import { asGuestOf, toProfileInput } from '../profile/draft'
import { CodeField } from './CodeField'
import { cleanCode, INVITE_LENGTH, invitePath } from './codes'
import { pairingCopy } from './copy'
import { LockedOut, LoginPage } from './Login'
import { NewPinFields, newPinTrouble, type PinTrouble } from './NewPinFields'
import { BusyScreen, ErrorNote, StepPage, WarningNote } from './parts'
import { clearSetup, freshSetup, loadSetup, saveSetup, type Setup } from './setupDraft'
import { useExplain } from './useExplain'
import { Welcome } from './Welcome'
import { STEPS, Wizard, type StepName } from './Wizard'

export { PausedScreen, usePaused } from './Paused'

type Busy = 'start' | 'join' | 'restore' | 'login' | 'peek'
type Problem = { at: 'welcome' | 'code' | 'login' | 'restore' | StepName; message: string }

const hasCode = (e: unknown, code: string) => isBackendError(e) && e.code === code

/** Which wizard step a refusal from the cloud belongs to. */
function stepFor(e: unknown): StepName {
  if (hasCode(e, 'name_taken') || hasCode(e, 'name_invalid')) return 'you'
  return 'pin'
}

/**
 * Use a code. If the cloud says this device already has a seat, either the first try got
 * through and only its answer was lost (the code is used up: take the seat), or the device
 * carries an old login (log that out and use the code properly).
 */
async function joinWithCode(code: string, profile: ProfileInput, pin: string): Promise<void> {
  try {
    await joinRoom(code, profile, pin)
  } catch (e) {
    if (!hasCode(e, 'already_in_room')) throw e
    const unused = await backend.peekInvite(code).then(
      () => true,
      (peekError: unknown) => {
        if (hasCode(peekError, 'invite_invalid')) return false
        throw peekError
      },
    )
    if (!unused) {
      if (await resumeRoom()) return
      throw e
    }
    await backend.signOutDevice()
    await joinRoom(code, profile, pin)
  }
}

/** Log in. An old login still sitting on this device is logged out first, so the name and PIN typed now decide. */
async function logInAs(name: string, pin: string): Promise<void> {
  try {
    await logIn(name, pin)
  } catch (e) {
    if (!hasCode(e, 'already_in_room')) throw e
    await backend.signOutDevice()
    await logIn(name, pin)
  }
}

/** The saved draft, at its step if it belongs to the page we open on, otherwise from the first step. */
function initialSetup(door: string | undefined, linkCode: string): Setup {
  const saved = loadSetup()
  if (!saved) return freshSetup('start')
  const sameFlow = (door === 'start' && saved.flow === 'start') || (door === 'join' && saved.flow === 'join' && saved.code === linkCode)
  return sameFlow ? saved : { ...saved, step: 0 }
}

export function Onboarding({ route, lockedOut }: { route: Route; lockedOut: boolean }) {
  const c = useCopy(pairingCopy)
  const explain = useExplain()
  const me = useMe()
  const { path, segments } = route
  const door = segments[0]
  const linkCode = door === 'join' && segments[1] ? cleanCode(segments[1]) : ''

  const [setup, setSetup] = useState<Setup>(() => initialSetup(door, linkCode))
  const [pin, setPin] = useState('')
  const [pinAgain, setPinAgain] = useState('')
  const [code, setCode] = useState(linkCode)
  const [peeked, setPeeked] = useState<{ code: string; peek: InvitePeek } | null>(null)
  const [loginName, setLoginName] = useState('')
  const [loginPin, setLoginPin] = useState('')
  const [busy, setBusy] = useState<Busy | null>(null)
  const [checking, setChecking] = useState(false)
  const [problem, setProblem] = useState<Problem | null>(null)

  const patchSetup = (patch: Partial<Setup>) => setSetup((was) => ({ ...was, ...patch }))
  const problemAt = (at: Problem['at']) => (problem?.at === at ? problem.message : null)

  // The draft outlives a reload. The PIN is not part of it.
  useEffect(() => saveSetup(setup), [setup])

  // Arrived directly on a deeper page (an invite link, a typed address): put the start
  // screen underneath, so that going back leads there instead of out of the app. The
  // router keeps the number of in-app steps behind a page in the history entry itself.
  useEffect(() => {
    const stepsBehind = (window.history.state as { depth?: number } | null)?.depth ?? 0
    if (stepsBehind > 0 || path === '/') return
    const here = window.location.hash.replace(/^#/, '')
    navigate('/', { replace: true })
    navigate(here)
  }, [path])

  // Back on the start screen (on purpose, not while a call is on its way): old complaints
  // and typed PINs are forgotten.
  useEffect(() => {
    if (path !== '/' || busy || lockedOut) return
    setProblem((was) => (was?.at === 'welcome' ? was : null))
    setPin('')
    setPinAgain('')
    setLoginPin('')
  }, [path, busy, lockedOut])

  // The page for opening a room always works on a "start" draft.
  const draftFlow = setup.flow
  useEffect(() => {
    if (door === 'start' && draftFlow !== 'start') setSetup((was) => ({ ...was, flow: 'start', code: '', step: 0 }))
  }, [door, draftFlow])

  // A device that was logged out still knows who used it: fill in the name.
  const knownName = me?.member?.name
  useEffect(() => {
    if (lockedOut && knownName) setLoginName((was) => was || knownName)
  }, [lockedOut, knownName])

  // A code in the address (an invite or restore link): look at what it leads to.
  const peekedCode = peeked?.code
  useEffect(() => {
    if (door !== 'join' || !linkCode || busy || peekedCode === linkCode) return
    setCode(linkCode)
    if (linkCode.length < INVITE_LENGTH) {
      setProblem({ at: 'code', message: c.code.tooShort })
      navigate('/join', { replace: true })
      return
    }
    let current = true
    backend.peekInvite(linkCode).then(
      (peek) => current && setPeeked({ code: linkCode, peek }),
      (e: unknown) => {
        if (!current) return
        setProblem({ at: 'code', message: explain(e) })
        navigate('/join', { replace: true })
      },
    )
    return () => {
      current = false
    }
  }, [door, linkCode, busy, peekedCode, c, explain])

  // A fresh invite: start its wizard at the first step, with the counterpart of the host's look.
  useEffect(() => {
    if (!peeked || peeked.peek.kind !== 'join') return
    setSetup((was) => {
      if (was.flow === 'join' && was.code === peeked.code) return was
      return { ...was, flow: 'join', code: peeked.code, step: 0, profile: asGuestOf(was.profile, peeked.peek.host?.avatar) }
    })
  }, [peeked])

  /** Back to a wizard step (or another screen) with what went wrong. */
  const fail = (at: Problem['at'], e: unknown, backTo: string) => {
    if ((STEPS as readonly string[]).includes(at)) patchSetup({ step: STEPS.indexOf(at as StepName) })
    setProblem({ at, message: explain(e) })
    setBusy(null)
    navigate(backTo, { replace: true })
  }

  const openStart = async () => {
    setProblem(null)
    setChecking(true)
    try {
      // There is only ever one room. If it exists, nobody should fill in a profile for nothing.
      if (await backend.roomExists()) setProblem({ at: 'welcome', message: c.welcome.exists })
      else {
        patchSetup({ flow: 'start', code: '', step: 0 })
        navigate('/start')
      }
    } catch (e) {
      setProblem({ at: 'welcome', message: explain(e) })
    }
    setChecking(false)
  }

  const start = async () => {
    setProblem(null)
    setBusy('start')
    // Where the app opens once the room exists: "you are the admin", then the invite.
    navigate('/settings/welcome', { replace: true })
    try {
      await startRoom(setup.roomName.trim() || c.wizard.defaultRoom, toProfileInput(setup.profile), pin)
      clearSetup()
      buzz([12, 40, 12])
    } catch (e) {
      // The first try may have reached the cloud while its answer got lost: then the room is ours already.
      if (hasCode(e, 'already_in_room') && (await resumeRoom().catch(() => false))) return clearSetup()
      if (hasCode(e, 'room_already_exists')) return fail('welcome', e, '/')
      fail(stepFor(e), e, '/start')
    }
  }

  const checkCode = async () => {
    if (code.length < INVITE_LENGTH) return setProblem({ at: 'code', message: c.code.tooShort })
    setProblem(null)
    setBusy('peek')
    try {
      const peek = await backend.peekInvite(code)
      setPeeked({ code, peek })
      navigate(invitePath(code))
    } catch (e) {
      setProblem({ at: 'code', message: explain(e) })
    }
    setBusy(null)
  }

  /** Use the code that was peeked at: take the second seat, or come back as an existing profile. */
  const redeem = async (kind: 'join' | 'restore') => {
    if (!peeked) return
    const { code: inviteCode, peek } = peeked
    setProblem(null)
    setBusy(kind)
    navigate('/', { replace: true })
    try {
      await joinWithCode(inviteCode, kind === 'join' ? toProfileInput(setup.profile) : { name: '' }, pin)
      clearSetup()
      toast(kind === 'join' ? c.done.joined : c.done.back(peek.profile?.name ?? ''))
      buzz([12, 40, 12])
    } catch (e) {
      if (hasCode(e, 'invite_invalid') || hasCode(e, 'room_full') || hasCode(e, 'member_not_found')) {
        setPeeked(null)
        return fail('code', e, '/join')
      }
      fail(kind === 'join' ? stepFor(e) : 'restore', e, invitePath(inviteCode))
    }
  }

  const login = async () => {
    if (!loginName.trim()) return setProblem({ at: 'login', message: c.login.nameMissing })
    if (loginPin.length < PIN_LENGTH) return setProblem({ at: 'login', message: c.login.pinMissing })
    setProblem(null)
    setBusy('login')
    // A logged-out device carries on where it was; from the log-in page the app opens on Today.
    const stayHere = lockedOut && door !== 'login' && door !== 'join' && door !== 'start'
    if (!stayHere) navigate('/', { replace: true })
    try {
      await logInAs(loginName, loginPin)
      toast(c.done.back(''))
      buzz([12, 40, 12])
    } catch (e) {
      setLoginPin('')
      setProblem({ at: 'login', message: explain(e) })
      setBusy(null)
      if (!stayHere) navigate(lockedOut ? '/' : '/login', { replace: true })
    }
  }

  const loginForm = {
    name: loginName,
    pin: loginPin,
    onName: (name: string) => {
      setLoginName(name)
      setProblem(null)
    },
    onPin: (value: string) => {
      setLoginPin(value)
      setProblem(null)
    },
    problem: problemAt('login'),
    onSubmit: () => void login(),
  }

  const wizard = {
    setup,
    onSetup: patchSetup,
    pin,
    pinAgain,
    onPin: setPin,
    onPinAgain: setPinAgain,
    problem: problem && (STEPS as readonly string[]).includes(problem.at) ? { step: problem.at as StepName, message: problem.message } : null,
    onProblemSeen: () => setProblem(null),
  }

  let screen
  if (busy) {
    screen = <BusyScreen label={c.busy[busy]} />
  } else if (door === 'join' && linkCode) {
    if (peeked?.code !== linkCode) screen = <BusyScreen label={c.busy.peek} />
    else if (peeked.peek.kind === 'restore') {
      screen = (
        <RestoreStep
          peek={peeked.peek}
          pin={pin}
          pinAgain={pinAgain}
          onPin={setPin}
          onPinAgain={setPinAgain}
          problem={problemAt('restore')}
          onProblemSeen={() => setProblem(null)}
          onSubmit={() => void redeem('restore')}
        />
      )
    } else if (setup.flow !== 'join' || setup.code !== linkCode) {
      // One moment: the draft is being pointed at this invite.
      screen = <BusyScreen label={c.busy.peek} />
    } else {
      screen = <Wizard flow="join" {...wizard} peek={peeked.peek} onSubmit={() => void redeem('join')} exitTo="/join" />
    }
  } else if (door === 'join') {
    screen = (
      <CodeStep
        code={code}
        problem={problemAt('code')}
        onCode={(next) => {
          setCode(next)
          setProblem(null)
        }}
        onSubmit={() => void checkCode()}
      />
    )
  } else if (lockedOut) {
    screen = <LockedOut {...loginForm} onHaveCode={() => navigate('/join')} onStartOver={() => void forgetThisDevice()} />
  } else if (door === 'login') {
    screen = <LoginPage {...loginForm} />
  } else if (door === 'start') {
    screen = <Wizard flow="start" {...wizard} onSubmit={() => void start()} exitTo="/" />
  } else {
    screen = (
      <Welcome
        checking={checking}
        problem={problemAt('welcome')}
        onStart={() => void openStart()}
        onCode={() => {
          setProblem(null)
          navigate('/join')
        }}
        onLogin={() => {
          setProblem(null)
          navigate('/login')
        }}
      />
    )
  }

  return <MotionConfig reducedMotion="user">{screen}</MotionConfig>
}

// ------------------------------------------------------------- code entry --

interface CodeProps {
  code: string
  problem: string | null
  onCode: (code: string) => void
  onSubmit: () => void
}

function CodeStep({ code, problem, onCode, onSubmit }: CodeProps) {
  const c = useCopy(pairingCopy)
  return (
    <StepPage
      title={c.code.title}
      footer={
        <Button size="lg" block onClick={onSubmit}>
          {c.code.check}
        </Button>
      }
    >
      <div className="flex flex-col gap-5 px-4" data-testid="code-step">
        <p className="text-base text-ink-soft">{c.code.lead}</p>
        <CodeField label={c.code.label} placeholder={c.code.placeholder} hint={c.code.hint} value={code} onChange={onCode} onEnter={onSubmit} />
        {problem && <ErrorNote>{problem}</ErrorNote>}
      </div>
    </StepPage>
  )
}

// --------------------------------------------------- back in with a code --

interface RestoreProps {
  peek: InvitePeek
  pin: string
  pinAgain: string
  onPin: (pin: string) => void
  onPinAgain: (pin: string) => void
  problem: string | null
  onProblemSeen: () => void
  onSubmit: () => void
}

/** A restore code: "Welcome back", then only a new PIN. */
function RestoreStep({ peek, pin, pinAgain, onPin, onPinAgain, problem, onProblemSeen, onSubmit }: RestoreProps) {
  const c = useCopy(pairingCopy)
  const [trouble, setTrouble] = useState<PinTrouble | null>(null)
  const who = peek.profile

  const submit = () => {
    const wrong = newPinTrouble(pin, pinAgain, c.pin)
    setTrouble(wrong)
    if (!wrong) onSubmit()
  }
  const typing = (set: (pin: string) => void) => (value: string) => {
    setTrouble(null)
    onProblemSeen()
    set(value)
  }

  return (
    <StepPage
      title={c.restore.title}
      backTo="/join"
      footer={
        <>
          {problem && <ErrorNote>{problem}</ErrorNote>}
          <Button size="lg" block onClick={submit}>
            {c.restore.submit}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 px-4" data-testid="restore-step">
        <Card tone="haze" pad={false} className="flex items-center gap-4 px-4 py-4">
          {who && <Avatar avatar={who.avatar} color={who.color} accessory={who.accessory} size={60} />}
          <div className="min-w-0">
            <h2 className="text-xl">{c.restore.hello(who?.name ?? '')}</h2>
            <p className="mt-1 text-sm">{c.restore.body(peek.roomName)}</p>
          </div>
        </Card>
        <NewPinFields pin={pin} again={pinAgain} onPin={typing(onPin)} onAgain={typing(onPinAgain)} trouble={trouble} label={c.restore.pinLabel} onEnter={submit} />
        <WarningNote>{c.restore.others}</WarningNote>
      </div>
    </StepPage>
  )
}
