// The answer to an opened envelope: taps that say "it landed", what it did, and why.
// Never sealed and never timed: reassurance should not wait.

import { useState } from 'react'
import { answer } from '../../data/do'
import { NO_WHY, type Heat, type ID, type Reply, type Why } from '../../data/types'
import { useCopy, useLang, useT } from '../../i18n'
import { Button, buzz, Card, cx, HeatMeter, toast } from '../../ui/components'
import { cleanWhy, WhyPicker, WhyView } from '../why'
import { envelopeCopy } from './copy'
import { tapById, TAPS } from './replies'

/** An answer as its reader sees it. */
export function ReplyView({ reply, title }: { reply: Reply; title: string }) {
  const c = useCopy(envelopeCopy).reply
  const t = useT()
  const lang = useLang()
  return (
    <section aria-labelledby="reply-view" data-testid="reply">
      <h2 id="reply-view" className="mb-2 text-lg">
        {title}
      </h2>
      <Card tone="haze" pad={false} className="flex flex-col gap-3.5 p-4">
        {reply.taps.length > 0 && (
          <ul className="flex flex-wrap gap-2">
            {reply.taps.map((id) => {
              const tap = tapById(id)
              return (
                <li key={id} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1.5 text-sm font-bold">
                  <span aria-hidden>{tap?.emoji}</span>
                  {tap ? tap[lang] : id}
                </li>
              )
            })}
          </ul>
        )}
        {reply.heat !== null && (
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span className="text-sm font-semibold text-ink-soft">{c.heatLabel}</span>
            <span className="flex items-center gap-2">
              <span className="text-sm font-bold">{t.heat[reply.heat - 1]}</span>
              <HeatMeter label={c.heatLabel} value={reply.heat} size={22} />
            </span>
          </div>
        )}
        <WhyView why={reply.why} />
      </Card>
    </section>
  )
}

interface FormProps {
  envelopeId: ID
  /** The answer so far, when one was sent before. */
  current: Reply | null
  onSent: () => void
}

export function ReplyForm({ envelopeId, current, onSent }: FormProps) {
  const c = useCopy(envelopeCopy).reply
  const t = useT()
  const lang = useLang()
  const [taps, setTaps] = useState<string[]>(current?.taps ?? [])
  const [heat, setHeat] = useState<Heat | null>(current?.heat ?? null)
  const [why, setWhy] = useState<Why>(current?.why ?? NO_WHY)
  const [sending, setSending] = useState(false)

  const send = async () => {
    setSending(true)
    try {
      await answer(envelopeId, { taps, heat, why: cleanWhy(why) })
      buzz([12, 40, 12])
      toast(c.sent)
      onSent()
    } catch {
      toast(c.failed, 'oops')
    }
    setSending(false)
  }

  const empty = taps.length === 0 && heat === null && cleanWhy(why).chips.length === 0 && cleanWhy(why).own.length === 0 && !why.note?.trim()

  return (
    <section aria-labelledby="reply-form" className="flex flex-col gap-6" data-testid="reply-form">
      <div>
        <h2 id="reply-form" className="text-xl">
          {c.title}
        </h2>
        <p className="mt-1 text-xs text-ink-soft">{c.taps}</p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={c.taps}>
          {TAPS.map((tap) => {
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
                className={cx('inline-flex min-h-11 items-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors duration-150', on ? 'bg-ink text-ground' : 'border-[1.5px] border-line-strong bg-surface')}
              >
                <span aria-hidden>{tap.emoji}</span>
                {tap[lang]}
              </button>
            )
          })}
        </div>
      </div>
      <div>
        <h3 className="mb-2 text-lg">{c.heatLabel}</h3>
        <HeatMeter label={c.heatLabel} value={heat} onChange={setHeat} words={t.heat} />
      </div>
      <WhyPicker context="received" title={c.whyTitle} value={why} onChange={setWhy} />
      <Button size="lg" block disabled={sending || empty} onClick={() => void send()}>
        {current ? c.update : c.send}
      </Button>
    </section>
  )
}
