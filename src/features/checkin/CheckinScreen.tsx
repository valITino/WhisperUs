// The check-in: how I am right now, on one page, in a few taps. Every line can be left
// out. What is noted stays on this phone; the last question on the page is who else may
// see which part of it, and the answer that is already chosen is "only me".

import { useMemo, useState } from 'react'
import { back, navigate } from '../../app/router'
import { ActionError, removeCheckin, saveCheckin } from '../../data/do'
import { slotRef } from '../../data/journal'
import { getPref, setPref } from '../../data/prefs'
import { useCheckins, useList, usePartner, useSlot } from '../../data/queries'
import { CHECKIN_PARTS, CHECKIN_SCALES, NO_WHY, type CheckinBody, type CheckinPart, type CheckinScale, type Often, type Score5, type Why } from '../../data/types'
import { isEmptyWhy } from '../../data/why'
import { useCopy, useLang } from '../../i18n'
import { formatTime } from '../../lib/dates'
import { Button, buzz, Card, Chip, Loader, Options, Scale, Screen, toast } from '../../ui/components'
import { itemWords } from '../list/library'
import { ConfirmSheet, ErrorNote, StepPage } from '../onboarding/parts'
import { ShareChoice } from '../share/ShareChoice'
import { WhyPicker } from '../why'
import { checkinCopy } from './copy'
import { HAPPENED, OFTEN, SCALES } from './library'

type Scales = Partial<Record<CheckinScale, Score5>>

const GROUPS: { id: 'you' | 'us' | 'desire'; scales: CheckinScale[] }[] = [
  { id: 'you', scales: ['energy', 'mood'] },
  { id: 'us', scales: ['close', 'open'] },
  { id: 'desire', scales: ['desire', 'kinky'] },
]

export function CheckinScreen() {
  const c = useCopy(checkinCopy)
  const lang = useLang()
  const slot = useSlot()
  const checkins = useCheckins()
  const list = useList()
  const partner = usePartner()

  if (!checkins || !list || partner === undefined) {
    return (
      <Screen className="grid place-items-center">
        <Loader />
      </Screen>
    )
  }
  const current = checkins.mine.find((entry) => entry.ref === slotRef(slot))
  // The form starts from what was noted earlier in this half of the day. A new half is a new form.
  return <CheckinForm key={`${slotRef(slot)}:${current?.id ?? 'new'}`} c={c} lang={lang} current={current ?? null} partner={partner?.name ?? null} list={list} />
}

interface FormProps {
  c: (typeof checkinCopy)['en']
  lang: 'en' | 'de'
  current: { id: string; at: string; body: CheckinBody; shared: string[]; whole: boolean } | null
  partner: string | null
  list: NonNullable<ReturnType<typeof useList>>
}

function CheckinForm({ c, lang, current, partner, list }: FormProps) {
  const before = current?.body ?? {}
  const [scales, setScales] = useState<Scales>(() => Object.fromEntries(CHECKIN_SCALES.filter((s) => before[s] !== undefined).map((s) => [s, before[s]])) as Scales)
  const [thoughts, setThoughts] = useState<Often | null>(before.thoughts ?? null)
  const [fantasies, setFantasies] = useState<string[]>(before.fantasies ?? [])
  const [happened, setHappened] = useState<string[]>(before.happened ?? [])
  const [why, setWhy] = useState<Why>(before.why ?? NO_WHY)
  const [whyOpen, setWhyOpen] = useState(!isEmptyWhy(before.why))
  const [share, setShare] = useState<string[]>(current?.shared ?? [])
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [removing, setRemoving] = useState(false)

  // What I answered openly on the list: the fantasies that can be "on my mind".
  const mindable = useMemo(() => [...list.mine.values()].filter((l) => l.lean !== 'no').map((l) => ({ id: l.item, label: itemWords(l.item, lang, list.ideas) })).filter((l): l is { id: string; label: string } => l.label !== null), [list, lang])

  const body: CheckinBody = {
    ...scales,
    ...(thoughts !== null ? { thoughts } : {}),
    ...(fantasies.length > 0 ? { fantasies } : {}),
    ...(happened.length > 0 ? { happened } : {}),
    ...(!isEmptyWhy(why) ? { why } : {}),
  }
  const answered = CHECKIN_PARTS.filter((part) => body[part] !== undefined)
  const toggleIn = (listOf: string[], set: (next: string[]) => void, id: string) => {
    buzz(8)
    set(listOf.includes(id) ? listOf.filter((other) => other !== id) : [...listOf, id])
  }

  const save = async () => {
    setProblem(null)
    setBusy(true)
    try {
      const shown = share.filter((part) => answered.includes(part as CheckinPart)) as CheckinPart[]
      await saveCheckin({ body, share: shown, ...(current ? { at: new Date(current.at) } : {}) })
      // Offered again the next time: what was shown now.
      setPref('shareCheckin', shown)
      buzz(12)
      toast(c.saved)
      back('/')
    } catch (e) {
      setBusy(false)
      setProblem(e instanceof ActionError && e.code === 'nothing_noted' ? c.problems.nothing_noted : c.problems.other)
    }
  }

  const remove = async () => {
    if (!current) return
    await removeCheckin(current.id)
    toast(c.removed)
    back('/')
  }

  return (
    <StepPage
      title={c.title}
      footer={
        <>
          {problem && <ErrorNote>{problem}</ErrorNote>}
          <Button size="lg" block disabled={busy} onClick={() => void save()}>
            {c.save}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5 px-4" data-testid="checkin">
        <p className="text-sm text-ink-soft">{current ? c.again(formatTime(current.at, lang)) : c.lead}</p>
        {current && !current.whole && <p className="text-xs font-semibold text-ink-soft">{c.notWhole}</p>}

        {GROUPS.map((group) => (
          <Card key={group.id} pad={false} className="flex flex-col gap-5 p-4">
            <h2 className="text-lg">{c[group.id]}</h2>
            {group.scales.map((scale) => {
              const words = SCALES[scale][lang]
              return (
                <div key={scale} data-testid={`scale-${scale}`}>
                  <p className="mb-1 text-sm font-bold">{words.ask}</p>
                  <Scale label={words.ask} value={scales[scale] ?? null} low={words.low} high={words.high} onChange={(value) => setScales((was) => {
                    const next = { ...was }
                    if (value === null) delete next[scale]
                    else next[scale] = value
                    return next
                  })} />
                </div>
              )
            })}
            {group.id === 'desire' && (
              <>
                <div data-testid="thoughts">
                  <p className="mb-2 text-sm font-bold">{c.thoughts}</p>
                  <Options<Often> label={c.thoughts} value={thoughts} options={OFTEN.map((o) => ({ value: o.value, label: o[lang] }))} onChange={setThoughts} />
                </div>
                <div data-testid="fantasies">
                  <p className="mb-2 text-sm font-bold">{c.fantasies}</p>
                  {mindable.length > 0 ? (
                    <div role="group" aria-label={c.fantasies} className="flex flex-wrap gap-2">
                      {mindable.map((item) => (
                        <Chip key={item.id} selected={fantasies.includes(item.id)} onClick={() => toggleIn(fantasies, setFantasies, item.id)} className="whitespace-normal py-2 text-left leading-tight">
                          {item.label}
                        </Chip>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs leading-snug text-ink-soft">
                      {c.fantasiesNone}{' '}
                      <button type="button" className="font-extrabold text-accent underline underline-offset-2" onClick={() => navigate('/list')}>
                        {c.openList}
                      </button>
                    </p>
                  )}
                </div>
              </>
            )}
          </Card>
        ))}

        <Card pad={false} className="flex flex-col gap-3 p-4" data-testid="happened">
          <h2 className="text-lg">{c.happened}</h2>
          <div role="group" aria-label={c.happened} className="flex flex-wrap gap-2">
            {HAPPENED.map((thing) => (
              <Chip key={thing.id} selected={happened.includes(thing.id)} onClick={() => toggleIn(happened, setHappened, thing.id)}>
                {thing[lang]}
              </Chip>
            ))}
          </div>
        </Card>

        <Card pad={false} className="p-4">
          {whyOpen ? (
            <WhyPicker context="checkin" value={why} onChange={setWhy} title={c.whyTitle} />
          ) : (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-lg">{c.whyTitle}</h2>
                <p className="mt-1 text-xs leading-snug text-ink-soft">{c.whyHint}</p>
              </div>
              <Button variant="secondary" className="shrink-0" onClick={() => setWhyOpen(true)}>
                {c.whyOpen}
              </Button>
            </div>
          )}
        </Card>

        <Card tone="haze" pad={false} className="p-4">
          <ShareChoice partner={partner} parts={answered.map((part) => ({ id: part, label: c.part[part] }))} value={share} onChange={setShare} remembered={getPref('shareCheckin')} />
        </Card>

        {current && (
          <Button variant="quiet" onClick={() => setRemoving(true)}>
            {c.remove}
          </Button>
        )}
      </div>

      <ConfirmSheet open={removing} title={c.removeTitle} confirmLabel={c.removeConfirm} cancelLabel={c.keep} onClose={() => setRemoving(false)} onConfirm={() => void remove()}>
        <p>{c.removeBody}</p>
      </ConfirmSheet>
    </StepPage>
  )
}
