// An envelope from the other one. Sealed, it shows its outside and when it opens.
// Open, it waits for the seal to be broken: that tap is the moment of opening.

import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { markSeen } from '../../data/do'
import type { EnvelopeView } from '../../data/envelopes'
import type { Layer, Member } from '../../data/types'
import { useCopy, useLang } from '../../i18n'
import { inWords, timeLeft } from '../../lib/when'
import { Button, buzz, Card, Tag } from '../../ui/components'
import { ErrorNote } from '../onboarding/parts'
import { envelopeCopy } from './copy'
import { EnvelopeFace } from './EnvelopeFace'
import { complete, loadInside, type Inside } from './inside'
import { InsideView } from './InsideView'
import { ReplyForm, ReplyView } from './Reply'

/** The time left until a moment, ticking. */
function useTimeLeft(until: string | null): string | null {
  const lang = useLang()
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!until) return
    const timer = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(timer)
  }, [until])
  return until ? timeLeft(until, now, lang) : null
}

export function Theirs({ view, author }: { view: EnvelopeView; author: Member }) {
  const c = useCopy(envelopeCopy)
  const lang = useLang()
  const { envelope } = view
  const [inside, setInside] = useState<Inside>({})
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)
  const [answering, setAnswering] = useState(false)
  const left = useTimeLeft(view.nextOpening)

  const openLayers = view.layers.filter((l) => l.state === 'open')
  const fresh = openLayers.filter((l) => !l.seenAt).map((l) => l.layer)
  const seenKey = openLayers
    .filter((l) => l.seenAt)
    .map((l) => l.layer)
    .join(',')

  // What was opened before (and kept) is simply shown again. What is behind an unbroken
  // seal is not touched until the seal is broken.
  const shown = useRef(inside)
  shown.current = inside
  useEffect(() => {
    const again = seenKey ? (seenKey.split(',') as Layer[]) : []
    const missing = again.filter((layer) => (layer === 'voice' ? !shown.current.voice?.sound : shown.current[layer] === undefined))
    if (missing.length === 0) return
    let current = true
    void loadInside(envelope, missing).then((more) => {
      if (current) setInside((was) => ({ ...was, ...more }))
    })
    return () => {
      current = false
    }
  }, [envelope, seenKey])

  const breakSeal = async () => {
    setFailed(false)
    setOpening(true)
    try {
      const opened = await loadInside(envelope, fresh)
      const whole = complete(opened, fresh)
      if (whole.length === 0) throw new Error('nothing_opened')
      setInside((was) => ({ ...was, ...opened }))
      buzz([18, 60, 24])
      // From here it counts as opened. For an envelope that opens once, this is the one opening.
      await markSeen(envelope.id, whole)
    } catch {
      setFailed(true)
    }
    setOpening(false)
  }

  const sealed = view.layers.filter((l) => l.state === 'sealed')
  const burned = view.layers.filter((l) => l.state === 'gone')
  const hasInside = Object.keys(inside).length > 0
  const state = fresh.length > 0 ? 'ready' : hasInside || view.standing === 'opened' ? 'open' : 'sealed'
  const when = view.nextOpening ? inWords(view.nextOpening, lang) : null
  const showForm = answering || (envelope.reply === null && envelope.wants !== 'listen')

  return (
    <div className="flex flex-col gap-7" data-testid="envelope-theirs" data-standing={view.standing}>
      <div className="flex flex-col items-center gap-4 text-center">
        <motion.div className="w-full max-w-[19rem]" animate={opening ? { rotate: [0, -1.5, 1.5, -1, 0] } : { rotate: 0 }} transition={{ duration: 0.5 }}>
          <EnvelopeFace teaser={envelope.teaser} heat={envelope.heatOutside} state={state} label={c.faceLabel[state]} />
        </motion.div>

        {envelope.keep === 'once' && view.standing !== 'opened' && <Tag tone="gold">{c.onceTag}</Tag>}

        {view.standing === 'waiting' && (
          <div data-testid="waiting-line">
            <p className="whispered text-lg">{when ? c.waiting.at(when) : c.waiting.hand(author.name)}</p>
            {when && left && <p className="tabular mt-1 text-sm font-semibold text-ink-soft">{c.waiting.left(left)}</p>}
          </div>
        )}

        {fresh.length > 0 && (
          <div className="flex w-full flex-col items-center gap-3">
            <p className="whispered text-lg">{hasInside ? c.ready.more : c.ready.line}</p>
            {envelope.keep === 'once' && <p className="max-w-[20rem] text-xs leading-snug text-ink-soft">{c.ready.once}</p>}
            <Button size="lg" disabled={opening} onClick={() => void breakSeal()}>
              {opening ? c.ready.opening : c.ready.open}
            </Button>
            {failed && <ErrorNote>{c.ready.failed}</ErrorNote>}
          </div>
        )}
      </div>

      <AnimatePresence>
        {hasInside && (
          <motion.div key="inside" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} className="flex flex-col gap-7">
            <Card tone="haze" pad={false} className="px-4 py-3.5" data-testid="wants">
              <p className="text-sm font-semibold leading-snug">{c.wants[envelope.wants](author.name)}</p>
            </Card>
            <InsideView inside={inside} author={author.name} />
          </motion.div>
        )}
      </AnimatePresence>

      {(sealed.length > 0 || burned.length > 0) && view.standing !== 'waiting' && (
        <ul className="flex flex-col gap-1.5 text-sm text-ink-soft" data-testid="still-sealed">
          {sealed.map((l) => (
            <li key={l.layer}>{c.inside.stillSealed(c.inside.layer[l.layer], l.opensAt ? inWords(l.opensAt, lang) : null)}</li>
          ))}
          {/* Burned and no longer on screen: say what happened, once. */}
          {burned.length > 0 && !hasInside && <li>{c.inside.burned}</li>}
        </ul>
      )}

      {view.standing !== 'waiting' && (hasInside || view.standing === 'opened') && (
        <div className="border-t border-line pt-6">
          {showForm ? (
            <ReplyForm envelopeId={envelope.id} current={envelope.reply} onSent={() => setAnswering(false)} />
          ) : envelope.reply ? (
            <div className="flex flex-col gap-2">
              <ReplyView reply={envelope.reply} title={c.reply.title} />
              <div>
                <Button variant="quiet" className="-ml-3" onClick={() => setAnswering(true)}>
                  {c.reply.change}
                </Button>
              </div>
            </div>
          ) : (
            <Button variant="secondary" onClick={() => setAnswering(true)}>
              {c.reply.anyway}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
