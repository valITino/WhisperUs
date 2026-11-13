// The booth: say it (write or speak), say how it felt and why, then seal it. Three
// steps on one page. Nothing leaves this phone before the last tap, and what leaves it
// then is sealed.

import { useEffect, useRef, useState } from 'react'
import { back, navigate, setBlocker } from '../../app/router'
import { ActionError, sealEnvelope, TEASER_MAX, WORDS_MAX, type Recording } from '../../data/do'
import { useRoom } from '../../data/queries'
import { LAYERS, type Layer, type OpenMode, type Wants } from '../../data/types'
import { useCopy, useLang, useT } from '../../i18n'
import { today, zurichIso, addDays } from '../../lib/dates'
import { dayAndTime, toLocalInput } from '../../lib/when'
import { Button, buzz, Card, Chip, cx, EmptyState, Field, HeatMeter, IconButton, Loader, Scale, Screen, Segmented, TextArea, toast, Toggle } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { EnvelopeFace } from '../envelope/EnvelopeFace'
import { ConfirmSheet, ErrorNote } from '../onboarding/parts'
import { Recorder } from '../voice/Recorder'
import { WhyPicker } from '../why'
import { boothCopy } from './copy'
import { clearDraft, feelOf, freshDraft, hasContent, loadDraft, saveDraft, type BoothDraft } from './draft'

const STEPS = ['say', 'feel', 'seal'] as const

function Progress({ step }: { step: number }) {
  const c = useCopy(boothCopy)
  return (
    <div className="flex items-center gap-3">
      <div className="flex flex-1 gap-1.5" aria-hidden>
        {STEPS.map((name, i) => (
          <span key={name} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-200', i <= step ? 'bg-candle' : 'bg-line-strong')} />
        ))}
      </div>
      <p className="tabular shrink-0 text-2xs font-bold text-ink-soft" data-testid="booth-step">
        {c.step(step + 1, STEPS.length)}
      </p>
    </div>
  )
}

/** One of a few choices, each with a line of explanation: a card to tap. */
function Choice({ title, hint, selected, onSelect }: { title: string; hint: string; selected: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={() => {
        buzz(8)
        onSelect()
      }}
      className={cx('flex min-h-14 w-full items-center gap-3 rounded-card border-[1.5px] bg-surface px-4 py-3 text-left transition-colors duration-150', selected ? 'border-ink' : 'border-line-strong')}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold leading-snug">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{hint}</span>
      </span>
      <span className={cx('grid size-6 shrink-0 place-items-center rounded-full border-[1.5px]', selected ? 'border-ink bg-ink text-ground' : 'border-line-strong text-transparent')} aria-hidden>
        <Icon name="check" size={14} />
      </span>
    </button>
  )
}

export function BoothScreen() {
  const c = useCopy(boothCopy)
  const t = useT()
  const lang = useLang()
  const room = useRoom()
  const [draft, setDraft] = useState<BoothDraft>(() => loadDraft() ?? freshDraft())
  const [voice, setVoice] = useState<Recording | null>(null)
  const [asking, setAsking] = useState(false)
  const [sealing, setSealing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const step = Math.min(draft.step, STEPS.length - 1)
  const name = STEPS[step]

  const edit = (patch: Partial<BoothDraft>) => {
    setProblem(null)
    setDraft((was) => ({ ...was, ...patch }))
  }

  // The words survive a reload. The recording does not, and the page says so before leaving.
  useEffect(() => saveDraft(draft), [draft])
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [step])

  const leave = () => back('/')
  const latest = useRef({ step, voice, sealing })
  latest.current = { step, voice, sealing }
  const stepBack = (): boolean => {
    const now = latest.current
    if (now.sealing) return true
    if (now.step > 0) {
      edit({ step: now.step - 1 })
      return true
    }
    if (now.voice) {
      setAsking(true)
      return true
    }
    return false
  }
  // The phone's own back button: previous step first, and never lose a recording unasked.
  useEffect(() => {
    setBlocker(stepBack)
    return () => setBlocker(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (room === undefined) {
    return (
      <Screen className="grid place-items-center">
        <Loader />
      </Screen>
    )
  }

  const header = (
    <header className="sticky top-0 z-30 border-b border-line bg-ground">
      <div className="app-column flex min-h-14 items-center gap-1 px-2 pt-[env(safe-area-inset-top)]">
        <IconButton
          icon="back"
          label={step > 0 ? c.back : t.common.back}
          onClick={() => {
            if (!stepBack()) leave()
          }}
        />
        <h1 className="min-w-0 flex-1 truncate text-lg">{c.title}</h1>
      </div>
    </header>
  )

  const partner = room?.partner
  if (!room || !partner) {
    return (
      <Screen>
        {header}
        <main className="app-column pt-6" data-testid="booth-alone">
          <EmptyState
            lit={false}
            title={c.alone.title}
            body={c.alone.body}
            action={
              room?.me.isAdmin ? (
                <Button onClick={() => navigate('/settings/invite')}>{c.alone.invite}</Button>
              ) : (
                <Button variant="secondary" onClick={leave}>
                  {c.alone.home}
                </Button>
              )
            }
          />
        </main>
      </Screen>
    )
  }

  const words = draft.words.trim()
  const feel = feelOf(draft)
  const present: Layer[] = LAYERS.filter((layer) => (layer === 'feel' ? feel !== null : layer === 'words' ? words !== '' : voice !== null))
  const release = present.filter((layer) => !draft.holdBack.includes(layer))

  const addStarter = (line: string) => {
    buzz(8)
    const sep = draft.words && !/\s$/.test(draft.words) ? '\n\n' : ''
    edit({ words: `${draft.words}${sep}${line} `.slice(0, WORDS_MAX) })
    requestAnimationFrame(() => {
      const field = document.getElementById('booth-words') as HTMLTextAreaElement | null
      field?.focus()
      field?.setSelectionRange(field.value.length, field.value.length)
    })
  }

  const pickTime = (iso: string) => edit({ opensAt: iso })
  const quick = [
    { label: c.seal.quick.hour, at: new Date(Math.ceil((Date.now() + 3_600_000) / 300_000) * 300_000).toISOString() },
    { label: c.seal.quick.tonight, at: zurichIso(today(), 22 * 60) },
    { label: c.seal.quick.morning, at: zurichIso(addDays(today(), 1), 8 * 60) },
  ].filter((choice) => Date.parse(choice.at) > Date.now() + 60_000)

  const seal = async () => {
    setProblem(null)
    setSealing(true)
    try {
      const id = await sealEnvelope({
        feel,
        words: words || null,
        voice,
        teaser: draft.teaser.trim() || null,
        heatOutside: draft.showHeat ? draft.heat : null,
        wants: draft.wants,
        keep: draft.keep,
        openMode: draft.openMode,
        opensAt: draft.openMode === 'at' ? draft.opensAt : null,
        release,
      })
      clearDraft()
      buzz([14, 50, 22])
      toast(c.seal.sealed)
      // The envelope takes the booth's place: going back from it leads to the room.
      navigate(`/envelope/${id}`, { replace: true })
    } catch (error) {
      const code = error instanceof ActionError ? error.code : 'other'
      setProblem(c.seal.problems[code as keyof typeof c.seal.problems] ?? c.seal.problems.other)
      setSealing(false)
    }
  }

  const next = () => {
    if (name !== 'seal') return edit({ step: step + 1 })
    if (present.length === 0) return setProblem(c.seal.problems.nothing_inside)
    if (draft.openMode !== 'hand' && release.length === 0) return setProblem(c.seal.problems.nothing_opens)
    if (draft.openMode === 'at' && (!draft.opensAt || Date.parse(draft.opensAt) <= Date.now())) return setProblem(c.seal.problems.time_past)
    void seal()
  }

  return (
    <div className="flex min-h-dvh flex-col bg-ground">
      {header}
      <main className="app-column flex-1 px-4 pb-8 pt-4" data-testid={`booth-${name}`}>
        <Progress step={step} />

        {name === 'say' && (
          <div className="mt-6 flex flex-col gap-6">
            <div>
              <h2 className="text-2xl">{c.say.title}</h2>
              <p className="whispered mt-2 text-base leading-snug text-ink-soft">{c.say.lead}</p>
            </div>
            <div className="flex flex-col gap-3">
              <TextArea
                id="booth-words"
                label={c.say.wordsLabel}
                placeholder={c.say.wordsPlaceholder}
                value={draft.words}
                maxLength={WORDS_MAX}
                rows={7}
                onChange={(e) => edit({ words: e.target.value })}
              />
              <div>
                <p className="mb-2 text-xs font-bold text-ink-soft">{c.say.starters}</p>
                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" data-testid="starters">
                  {c.say.starterList.map((line) => (
                    <Chip key={line} onClick={() => addStarter(line)}>
                      {line}
                    </Chip>
                  ))}
                </div>
              </div>
            </div>
            <section aria-labelledby="booth-voice" className="flex flex-col gap-3">
              <div>
                <h3 id="booth-voice" className="text-lg">
                  {c.say.voiceTitle}
                </h3>
                <p className="mt-1 text-xs leading-snug text-ink-soft">{c.say.voiceHint}</p>
              </div>
              <Recorder value={voice} onChange={setVoice} labels={c.recorder} />
            </section>
            <p className="text-xs leading-snug text-ink-soft">{c.say.skipHint}</p>
            {hasContent(draft, voice !== null) && (
              <div>
                <Button
                  variant="quiet"
                  className="-ml-3"
                  onClick={() => {
                    clearDraft()
                    setVoice(null)
                    setDraft(freshDraft())
                    toast(c.leave.discarded)
                  }}
                >
                  {c.leave.discard}
                </Button>
              </div>
            )}
          </div>
        )}

        {name === 'feel' && (
          <div className="mt-6 flex flex-col gap-7">
            <div>
              <h2 className="text-2xl">{c.feel.title}</h2>
              <p className="mt-2 text-sm text-ink-soft">{c.feel.lead}</p>
            </div>
            <section aria-labelledby="booth-heat">
              <h3 id="booth-heat" className="mb-2 text-lg">
                {c.feel.heatLabel}
              </h3>
              <HeatMeter label={c.feel.heatLabel} value={draft.heat} onChange={(heat) => edit({ heat, ...(heat === null ? { showHeat: false } : {}) })} words={t.heat} />
            </section>
            <section aria-labelledby="booth-ease">
              <h3 id="booth-ease" className="mb-1 text-lg">
                {c.feel.easeLabel}
              </h3>
              <Scale label={c.feel.easeLabel} value={draft.ease} onChange={(ease) => edit({ ease })} low={c.feel.easeLow} high={c.feel.easeHigh} />
            </section>
            <WhyPicker context="said" title={c.feel.whyTitle} value={draft.why} onChange={(why) => edit({ why })} />
          </div>
        )}

        {name === 'seal' && (
          <div className="mt-6 flex flex-col gap-8">
            <h2 className="text-2xl">{c.seal.title}</h2>

            <section aria-labelledby="booth-outside" className="flex flex-col gap-3">
              <h3 id="booth-outside" className="text-lg">
                {c.seal.outsideTitle}
              </h3>
              <EnvelopeFace teaser={draft.teaser} heat={draft.showHeat ? draft.heat : null} label={c.seal.outsideTitle} className="mx-auto max-w-[19rem]" />
              <Field
                label={c.seal.teaserLabel}
                placeholder={c.seal.teaserPlaceholder}
                hint={c.seal.teaserHint(partner.name)}
                value={draft.teaser}
                maxLength={TEASER_MAX}
                enterKeyHint="done"
                onChange={(e) => edit({ teaser: e.target.value })}
              />
              {draft.heat !== null && <Toggle label={c.seal.showHeat} checked={draft.showHeat} onChange={(showHeat) => edit({ showHeat })} />}
            </section>

            <section aria-labelledby="booth-wants" className="flex flex-col gap-3">
              <h3 id="booth-wants" className="text-lg">
                {c.seal.wantsTitle}
              </h3>
              <div role="radiogroup" aria-labelledby="booth-wants" className="flex flex-col gap-2">
                {(['listen', 'react', 'talk'] as const satisfies readonly Wants[]).map((wants) => (
                  <Choice key={wants} title={c.seal.wants[wants].title} hint={c.seal.wants[wants].hint} selected={draft.wants === wants} onSelect={() => edit({ wants })} />
                ))}
              </div>
            </section>

            <section aria-labelledby="booth-when" className="flex flex-col gap-3">
              <h3 id="booth-when" className="text-lg">
                {c.seal.whenTitle}
              </h3>
              <Segmented<OpenMode>
                label={c.seal.whenTitle}
                value={draft.openMode}
                options={(['hand', 'at', 'now'] as const).map((mode) => ({ value: mode, label: c.seal.when[mode] }))}
                onChange={(openMode) => {
                  buzz(8)
                  edit({ openMode, ...(openMode === 'at' && !draft.opensAt && quick[0] ? { opensAt: quick[0].at } : {}) })
                }}
              />
              <p className="text-xs leading-snug text-ink-soft" data-testid="when-hint">
                {draft.openMode === 'hand' ? c.seal.handHint(partner.name) : draft.openMode === 'now' ? c.seal.nowHint(partner.name) : c.seal.atHint(partner.name)}
              </p>
              {draft.openMode === 'at' && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap gap-2">
                    {quick.map((choice) => (
                      <Chip key={choice.label} selected={draft.opensAt === choice.at} onClick={() => pickTime(choice.at)}>
                        {choice.label}
                      </Chip>
                    ))}
                  </div>
                  <Field
                    type="datetime-local"
                    label={c.seal.timeLabel}
                    value={draft.opensAt ? toLocalInput(new Date(draft.opensAt)) : ''}
                    min={toLocalInput(new Date())}
                    hint={draft.opensAt ? dayAndTime(draft.opensAt, lang, t.common) : undefined}
                    onChange={(e) => {
                      const picked = new Date(e.target.value)
                      edit({ opensAt: Number.isNaN(picked.getTime()) ? null : picked.toISOString() })
                    }}
                  />
                </div>
              )}
            </section>

            {draft.openMode !== 'hand' && present.length > 0 && (
              <section aria-labelledby="booth-what" className="flex flex-col gap-1">
                <h3 id="booth-what" className="text-lg">
                  {c.seal.whatTitle}
                </h3>
                <p className="text-xs leading-snug text-ink-soft">{c.seal.whatHint}</p>
                <Card pad={false} className="mt-2 divide-y divide-line px-4" data-testid="what-opens">
                  {present.map((layer) => (
                    <Toggle
                      key={layer}
                      label={c.seal.layers[layer]}
                      checked={!draft.holdBack.includes(layer)}
                      onChange={(opens) => edit({ holdBack: opens ? draft.holdBack.filter((held) => held !== layer) : [...draft.holdBack, layer] })}
                    />
                  ))}
                </Card>
              </section>
            )}

            <section aria-labelledby="booth-keep" className="flex flex-col gap-3">
              <h3 id="booth-keep" className="text-lg">
                {c.seal.keepTitle}
              </h3>
              <Segmented
                label={c.seal.keepTitle}
                value={draft.keep}
                options={(['keep', 'once'] as const).map((keep) => ({ value: keep, label: c.seal.keep[keep] }))}
                onChange={(keep) => {
                  buzz(8)
                  edit({ keep })
                }}
              />
              <p className="text-xs leading-snug text-ink-soft">{draft.keep === 'once' ? c.seal.onceHint(partner.name) : c.seal.keepHint}</p>
            </section>
          </div>
        )}
      </main>

      <div className="sticky bottom-0 z-30 border-t border-line bg-ground">
        <div className="app-column flex flex-col gap-2.5 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
          {problem && <ErrorNote>{problem}</ErrorNote>}
          <Button size="lg" block disabled={sealing} onClick={next}>
            {name !== 'seal' ? c.next : sealing ? c.seal.sealing : c.seal.submit}
          </Button>
        </div>
      </div>

      <ConfirmSheet
        open={asking}
        title={c.leave.title}
        confirmLabel={c.leave.leave}
        cancelLabel={c.leave.stay}
        onClose={() => setAsking(false)}
        onConfirm={() => {
          setAsking(false)
          setVoice(null)
          latest.current = { ...latest.current, voice: null }
          leave()
        }}
      >
        <p>{c.leave.body}</p>
      </ConfirmSheet>
    </div>
  )
}
