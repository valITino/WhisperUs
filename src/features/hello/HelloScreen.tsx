// The first look: what a person is asked right after signing up. A few questions about
// themselves (each a step between two poles, with a why if they like), a first walk
// through the list, and the two moments of the day for the check-in.
//
// Nothing here is required. Every step can be passed, "Later" leaves at once, and all
// of it can be found again: the questions under "About me", the list under "Wishes".
// Like the start wizard it is one page in the browser's history: going back returns to
// the step before.

import { useEffect, useRef, useState } from 'react'
import { navigate, setBlocker } from '../../app/router'
import { saveAbout, updateMyPrefs } from '../../data/do'
import { useMe } from '../../data/hooks'
import { useAbout, useList, usePartner } from '../../data/queries'
import { nowIso, type CheckinTimes } from '../../data/types'
import { useCopy, useLang } from '../../i18n'
import { Button, Card, cx, Loader, toast } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { FIRST_QUESTIONS } from '../about/library'
import { draftOf, QuestionForm, toAnswer, type AnswerDraft } from '../about/QuestionForm'
import { checkinTimes, TimesFields } from '../checkin/TimesPage'
import { listCopy } from '../list/copy'
import { ListPicker } from '../list/ListPicker'
import { StepPage } from '../onboarding/parts'
import { helloCopy } from './copy'

/** The groups of the list shown in the first look. The rest waits on the list's own page. */
const FIRST_SECTIONS = ['tender', 'soft', 'words', 'play', 'lead']
const STEPS = 1 + FIRST_QUESTIONS.length + 2

export function HelloScreen() {
  const c = useCopy(helloCopy)
  const lc = useCopy(listCopy)
  const lang = useLang()
  const me = useMe()
  const about = useAbout()
  const list = useList()
  const partner = usePartner()
  const [step, setStep] = useState(0)
  const [drafts, setDrafts] = useState<Record<string, AnswerDraft>>({})
  const [times, setTimes] = useState<CheckinTimes | null>(null)

  // Going back in the browser's history means "the step before" while there is one.
  const latest = useRef(step)
  latest.current = step
  useEffect(() => {
    setBlocker(() => {
      if (latest.current === 0) return false
      setStep(latest.current - 1)
      return true
    })
    return () => setBlocker(null)
  }, [])
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  const member = me?.member
  if (!member || !about || !list || partner === undefined) {
    return (
      <StepPage title={c.title}>
        <Loader />
      </StepPage>
    )
  }

  const question = step >= 1 && step <= FIRST_QUESTIONS.length ? FIRST_QUESTIONS[step - 1] : null
  const onList = step === FIRST_QUESTIONS.length + 1
  const onTimes = step === FIRST_QUESTIONS.length + 2
  const draft = question ? (drafts[question.id] ?? draftOf(about.mine.get(question.id))) : null
  const chosen = times ?? checkinTimes(member.prefs)

  const leave = async (finished: boolean) => {
    // "Later" changes nothing: the room keeps the first look until it is taken or declined.
    if (finished) await updateMyPrefs({ firstLook: nowIso(), checkin: chosen })
    setBlocker(null)
    toast(finished ? c.welcome : c.later)
    navigate('/', { replace: true })
  }

  const next = async () => {
    if (question && draft) {
      const { body, share } = toAnswer(draft)
      // An answer that was touched is saved; a question that was passed stays unanswered.
      if (drafts[question.id]) await saveAbout(question.id, body, share)
    }
    if (onTimes) return leave(true)
    setStep(step + 1)
  }

  return (
    <StepPage
      title={c.title}
      footer={
        step === 0 ? (
          <>
            <Button size="lg" block onClick={() => setStep(1)}>
              {c.intro.begin}
            </Button>
            <Button variant="quiet" block onClick={() => void leave(false)}>
              {c.intro.later}
            </Button>
          </>
        ) : (
          <Button size="lg" block onClick={() => void next()}>
            {onTimes ? c.times.done : c.next}
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-6" data-testid="hello" data-step={step}>
        <div className="flex items-center gap-3 px-4">
          <div className="flex flex-1 gap-1" aria-hidden>
            {Array.from({ length: STEPS }, (_, i) => (
              <span key={i} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-200', i <= step ? 'bg-candle' : 'bg-line-strong')} />
            ))}
          </div>
          <p className="tabular shrink-0 text-2xs font-extrabold text-ink-soft" data-testid="hello-step">
            {c.step(step + 1, STEPS)}
          </p>
        </div>

        {step === 0 && (
          <div className="flex flex-col gap-4 px-4">
            <h2 className="text-2xl">{c.intro.title}</h2>
            <p className="text-sm text-ink-soft">{c.intro.body}</p>
            <Card tone="haze" pad={false} className="p-4">
              <ul className="flex flex-col gap-3">
                {c.intro.points.map((point) => (
                  <li key={point} className="flex items-start gap-2.5 text-sm font-semibold leading-snug">
                    <Icon name="check" size={18} className="mt-0.5 shrink-0 text-accent" />
                    {point}
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        )}

        {question && draft && (
          <div className="flex flex-col gap-5 px-4">
            <h2 className="text-2xl">{question[lang].ask}</h2>
            <QuestionForm key={question.id} question={question} value={draft} onChange={(nextDraft) => setDrafts((was) => ({ ...was, [question.id]: nextDraft }))} partner={partner?.name ?? null} />
          </div>
        )}

        {onList && (
          <div className="flex flex-col gap-5 px-4">
            <div>
              <h2 className="text-2xl">{c.list.title}</h2>
              <p className="mt-2 text-sm text-ink-soft">{c.list.body}</p>
            </div>
            <Card tone="haze" pad={false} className="p-4">
              <p className="text-sm leading-snug">{partner ? lc.rule.body(partner.name) : lc.rule.alone}</p>
            </Card>
            <ListPicker list={list} partner={partner?.name ?? null} only={FIRST_SECTIONS} />
          </div>
        )}

        {onTimes && (
          <div className="flex flex-col gap-5 px-4">
            <div>
              <h2 className="text-2xl">{c.times.title}</h2>
              <p className="mt-2 text-sm text-ink-soft">{c.times.body}</p>
            </div>
            <TimesFields value={chosen} onChange={setTimes} />
          </div>
        )}
      </div>
    </StepPage>
  )
}
