// One wish. For its author: what was said, what came back, and the ways to change it or
// take it back. For the other one: the wish, and the answer to give.

import { useEffect, useState } from 'react'
import { navigate } from '../../app/router'
import { ActionError, answerWish, takeBackWish } from '../../data/do'
import { markWishAnswerSeen, markWishSeen, useList, usePartner, useWish } from '../../data/queries'
import { NO_WHY, type Decision, type Heat, type ID, type Why, type Wish, type WishAnswer } from '../../data/types'
import { useCopy, useLang, useT } from '../../i18n'
import { Button, buzz, Card, cx, EmptyState, HeatMeter, Loader, Options, Tag, toast } from '../../ui/components'
import { itemWords } from '../list/library'
import { ConfirmSheet, ErrorNote, StepPage } from '../onboarding/parts'
import { WhyPicker, WhyView } from '../why'
import { LaterNote } from '../share/LaterNote'
import { wishesCopy } from './copy'
import { WISH_TAPS, wishTapById } from './library'

const DECISIONS: Decision[] = ['yes', 'later', 'talk', 'no']

/** The wish as it was said: its words, what kind it is, how much, and why. */
function WishCard({ wish, itemLabel }: { wish: Wish; itemLabel: string | null }) {
  const c = useCopy(wishesCopy)
  return (
    <Card tone="note" pad={false} className="flex flex-col gap-3 p-5" data-testid="wish-card">
      <p className="handwritten whitespace-pre-wrap break-words text-[1.6rem] leading-tight text-accent">{wish.text}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="gold">{c.mode[wish.mode]}</Tag>
        {itemLabel && <Tag>{`${c.page.fromList}: ${itemLabel}`}</Tag>}
      </div>
      {wish.want !== null && (
        <p className="text-sm">
          <span className="font-semibold text-ink-soft">{c.page.want}: </span>
          <span className="font-bold">{c.page.wantWords[wish.want - 1]}</span>
        </p>
      )}
      <WhyView why={wish.why} />
    </Card>
  )
}

function AnswerView({ answer, title, heatLabel }: { answer: WishAnswer; title: string; heatLabel: string }) {
  const c = useCopy(wishesCopy)
  const t = useT()
  const lang = useLang()
  return (
    <section aria-labelledby="wish-answer" data-testid="wish-answer">
      <h2 id="wish-answer" className="mb-2 text-lg">
        {title}
      </h2>
      <Card tone="haze" pad={false} className="flex flex-col gap-3.5 p-4">
        {answer.decision && <p className="font-display text-xl font-semibold leading-tight">{c.decision[answer.decision]}</p>}
        {answer.taps.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {answer.taps.map((id) => {
              const tap = wishTapById(id)
              return (
                <li key={id} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-bold">
                  <span aria-hidden>{tap?.emoji}</span>
                  {tap ? tap[lang] : id}
                </li>
              )
            })}
          </ul>
        )}
        {answer.heat !== null && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="text-sm font-semibold text-ink-soft">{heatLabel}</span>
            <span className="flex items-center gap-2">
              <span className="text-sm font-bold">{t.heat[answer.heat - 1]}</span>
              <HeatMeter label={heatLabel} value={answer.heat} size={22} />
            </span>
          </div>
        )}
        <WhyView why={answer.why} />
      </Card>
    </section>
  )
}

function AnswerForm({ wish, partner, onSent }: { wish: Wish; partner: string; onSent: () => void }) {
  const c = useCopy(wishesCopy)
  const a = c.answer
  const t = useT()
  const lang = useLang()
  const current = wish.answer
  const [decision, setDecision] = useState<Decision | null>(current?.decision ?? null)
  const [taps, setTaps] = useState<string[]>(current?.taps ?? [])
  const [heat, setHeat] = useState<Heat | null>(current?.heat ?? null)
  const [why, setWhy] = useState<Why>(current?.why ?? NO_WHY)
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const send = async () => {
    setProblem(null)
    setBusy(true)
    try {
      await answerWish(wish.id, { decision, taps, heat, why })
      buzz(12)
      toast(a.sent)
      onSent()
    } catch (e) {
      setProblem(e instanceof ActionError && e.code === 'no_decision' ? a.problems.no_decision : a.problems.other)
    }
    setBusy(false)
  }

  return (
    <section aria-labelledby="wish-answer-form" className="flex flex-col gap-5" data-testid="wish-answer-form">
      <h2 id="wish-answer-form" className="text-lg">
        {current ? a.changeTitle : a.title}
      </h2>
      {wish.mode === 'dream' && <p className="-mt-3 text-sm text-ink-soft">{a.noDecision(partner)}</p>}
      <div>
        <p className="mb-2 text-sm font-bold">{a.decide}</p>
        <Options<Decision> label={a.decide} stacked value={decision} options={DECISIONS.map((value) => ({ value, label: c.decision[value], hint: c.decisionHint[value] || undefined }))} onChange={setDecision} />
      </div>
      <div>
        <p className="mb-2 text-sm font-bold">{a.taps}</p>
        <div role="group" aria-label={a.taps} className="flex flex-wrap gap-2">
          {WISH_TAPS.map((tap) => {
            const on = taps.includes(tap.id)
            return (
              <button
                key={tap.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  buzz(8)
                  setTaps(on ? taps.filter((id) => id !== tap.id) : [...taps, tap.id])
                }}
                className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-sm font-bold', on ? 'bg-ink text-ground' : 'border-[1.5px] border-line-strong bg-surface')}
              >
                <span aria-hidden>{tap.emoji}</span>
                {tap[lang]}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <p className="mb-1 text-sm font-bold">{a.heat}</p>
        <HeatMeter label={a.heat} value={heat} onChange={setHeat} words={t.heat} />
      </div>
      <Card pad={false} className="p-4">
        <WhyPicker context="decision" value={why} onChange={setWhy} title={a.why} />
      </Card>
      {problem && <ErrorNote>{problem}</ErrorNote>}
      <Button size="lg" block disabled={busy} onClick={() => void send()}>
        {a.send}
      </Button>
    </section>
  )
}

export function WishScreen({ id }: { id: ID }) {
  const c = useCopy(wishesCopy)
  const lang = useLang()
  const found = useWish(id)
  const partner = usePartner()
  const list = useList()
  const [editing, setEditing] = useState(false)
  const [taking, setTaking] = useState(false)

  const wish = found?.wish
  const mine = found?.mine ?? false
  const answeredAt = wish?.answer?.at
  useEffect(() => {
    if (!wish) return
    if (mine && answeredAt) void markWishAnswerSeen(wish.id, answeredAt)
    if (!mine) void markWishSeen(wish.id)
  }, [wish?.id, mine, answeredAt]) // eslint-disable-line react-hooks/exhaustive-deps

  if (found === undefined || partner === undefined || !list) {
    return (
      <StepPage title={c.title} backTo="/wishes">
        <Loader />
      </StepPage>
    )
  }
  if (!found || !wish || !partner) {
    return (
      <StepPage title={c.page.gone} backTo="/wishes">
        <EmptyState
          lit={false}
          title={c.page.gone}
          body={c.page.goneBody}
          action={
            <Button variant="secondary" onClick={() => navigate('/wishes', { replace: true })}>
              {c.page.back}
            </Button>
          }
        />
      </StepPage>
    )
  }

  const itemLabel = wish.item ? itemWords(wish.item, lang, list.ideas) : null
  const takeBack = async () => {
    await takeBackWish(wish.id)
    toast(c.page.takenBack)
    navigate('/wishes', { replace: true })
  }

  return (
    <StepPage title={mine ? c.page.mine : c.page.theirs(partner.name)} backTo="/wishes">
      <div className="flex flex-col gap-6 px-4" data-testid={mine ? 'wish-mine' : 'wish-theirs'}>
        <LaterNote />
        <WishCard wish={wish} itemLabel={itemLabel} />

        {mine && (
          <>
            {wish.answer ? <AnswerView answer={wish.answer} title={c.page.answer(partner.name)} heatLabel={c.page.heatTheirs(partner.name)} /> : <p className="text-sm text-ink-soft">{c.page.waiting(partner.name)}</p>}
            <div className="flex flex-col gap-1.5">
              {wish.answer ? (
                <p className="text-xs leading-snug text-ink-soft">{c.page.frozen}</p>
              ) : (
                <Button variant="secondary" block onClick={() => navigate(`/wishes/${wish.id}/edit`)}>
                  {c.page.change}
                </Button>
              )}
              <Button variant="quiet" block onClick={() => setTaking(true)}>
                {c.page.takeBack}
              </Button>
            </div>
          </>
        )}

        {!mine &&
          (wish.answer && !editing ? (
            <>
              <AnswerView answer={wish.answer} title={c.page.myAnswer} heatLabel={c.page.heatMine} />
              <Button variant="secondary" block onClick={() => setEditing(true)}>
                {c.answer.edit}
              </Button>
            </>
          ) : (
            <AnswerForm wish={wish} partner={partner.name} onSent={() => setEditing(false)} />
          ))}
      </div>

      <ConfirmSheet open={taking} title={c.page.takeBackTitle} confirmLabel={c.page.takeBackConfirm} cancelLabel={c.page.keep} onClose={() => setTaking(false)} onConfirm={() => void takeBack()}>
        <p>{c.page.takeBackBody(partner.name)}</p>
      </ConfirmSheet>
    </StepPage>
  )
}
