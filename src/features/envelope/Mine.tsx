// An envelope I sealed. Here I see what is still with me, what is waiting for its time
// and what is open; I can read it again, open more of it, see the answer, or take it back.

import { useEffect, useState } from 'react'
import { back } from '../../app/router'
import { openLayers, takeBack } from '../../data/do'
import { openable, type EnvelopeView, type LayerView } from '../../data/envelopes'
import { markAnswerSeen } from '../../data/queries'
import type { Layer, Member } from '../../data/types'
import { useCopy, useLang, useT } from '../../i18n'
import { inWords } from '../../lib/when'
import { Button, buzz, Card, Sheet, Tag, toast, Toggle } from '../../ui/components'
import { ConfirmSheet } from '../onboarding/parts'
import { envelopeCopy } from './copy'
import { EnvelopeFace } from './EnvelopeFace'
import { loadInside, type Inside } from './inside'
import { InsideView } from './InsideView'
import { ReplyView } from './Reply'

export function Mine({ view, partner }: { view: EnvelopeView; partner: Member }) {
  const c = useCopy(envelopeCopy)
  const t = useT()
  const lang = useLang()
  const { envelope } = view
  const [inside, setInside] = useState<Inside | null>(null)
  const [reading, setReading] = useState(false)
  const [picking, setPicking] = useState<Layer[] | null>(null)
  const [opening, setOpening] = useState(false)
  const [taking, setTaking] = useState(false)
  const [working, setWorking] = useState(false)

  const { held, early } = openable(view)
  const canOpen = [...held, ...early]
  const readable = view.layers.filter((l) => l.readable).map((l) => l.layer)
  const readableKey = readable.join(',')

  // Whatever is on screen follows what this phone can read (a layer may have been burned meanwhile).
  useEffect(() => {
    if (!reading) return
    let current = true
    void loadInside(envelope, readableKey ? (readableKey.split(',') as Layer[]) : []).then((opened) => {
      if (current) setInside(opened)
    })
    return () => {
      current = false
    }
  }, [reading, envelope, readableKey])

  // Looking at this page is looking at its answer.
  const repliedAt = envelope.reply?.at
  useEffect(() => {
    if (repliedAt) void markAnswerSeen(envelope.id, repliedAt)
  }, [envelope.id, repliedAt])

  const stateWords = (l: LayerView): string => {
    if (l.state === 'held') return c.mine.state.held
    if (l.state === 'sealed') return l.opensAt ? c.mine.state.sealed(inWords(l.opensAt, lang)) : c.mine.state.held
    return l.state === 'open' ? c.mine.state.open : c.mine.state.gone
  }

  const open = async () => {
    if (!picking || picking.length === 0) return
    setOpening(true)
    try {
      await openLayers(envelope.id, picking)
      buzz([14, 50, 22])
      toast(c.mine.opened)
      setPicking(null)
    } catch {
      toast(t.common.somethingWrong, 'oops')
    }
    setOpening(false)
  }

  const reallyTakeBack = async () => {
    setWorking(true)
    try {
      await takeBack(envelope.id)
      toast(c.mine.takenBack)
      back('/')
    } catch {
      toast(t.common.somethingWrong, 'oops')
      setWorking(false)
      setTaking(false)
    }
  }

  const timed = view.layers.find((l) => l.state === 'sealed' && l.opensAt)
  const line = view.standing === 'out' ? c.mine.out(partner.name) : timed?.opensAt ? c.mine.sealedAt(inWords(timed.opensAt, lang)) : c.mine.sealedHand
  const face = view.standing === 'out' ? 'open' : 'sealed'
  const unreadableHere = view.layers.some((l) => !l.readable && l.state !== 'gone')

  return (
    <div className="flex flex-col gap-7" data-testid="envelope-mine" data-standing={view.standing}>
      <div className="flex flex-col items-center gap-4 text-center">
        <EnvelopeFace teaser={envelope.teaser} heat={envelope.heatOutside} state={face} label={c.faceLabel[face]} className="max-w-[19rem]" />
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Tag>{c.wantsShort[envelope.wants]}</Tag>
          {envelope.keep === 'once' && <Tag tone="gold">{c.onceTag}</Tag>}
        </div>
        <p className="whispered text-lg" data-testid="mine-line">
          {line}
        </p>
      </div>

      <section aria-labelledby="mine-inside" className="flex flex-col gap-3">
        <h2 id="mine-inside" className="text-lg">
          {c.mine.insideTitle}
        </h2>
        <Card pad={false} className="divide-y divide-line px-4" data-testid="mine-layers">
          {view.layers.map((l) => (
            <div key={l.layer} className="flex min-h-12 items-center justify-between gap-4 py-2.5" data-layer={l.layer} data-state={l.state}>
              <span className="text-sm font-semibold">{c.mine.layer[l.layer]}</span>
              <span className="text-right text-xs font-bold text-ink-soft">{stateWords(l)}</span>
            </div>
          ))}
        </Card>
        {held.length > 0 && <p className="text-xs leading-snug text-ink-soft">{c.mine.heldHint}</p>}
        {unreadableHere && <p className="text-xs leading-snug text-ink-soft">{c.mine.elsewhere}</p>}

        {canOpen.length > 0 && (
          <Button size="lg" block onClick={() => setPicking(canOpen)}>
            {view.standing === 'out' ? c.mine.openMore(partner.name) : c.mine.open(partner.name)}
          </Button>
        )}

        {readable.length > 0 && (
          <div>
            <Button variant="secondary" block onClick={() => setReading((was) => !was)}>
              {reading ? c.mine.hide : c.mine.read}
            </Button>
          </div>
        )}
      </section>

      {reading && inside && <InsideView inside={inside} author={null} />}

      <div className="border-t border-line pt-6" data-testid="mine-answer">
        {envelope.reply ? (
          <ReplyView reply={envelope.reply} title={c.reply.theirs(partner.name)} />
        ) : (
          view.standing === 'out' && (
            <p className="text-sm leading-relaxed text-ink-soft">{envelope.wants === 'listen' ? c.mine.noAnswerYet.listen : c.mine.noAnswerYet[envelope.wants](partner.name)}</p>
          )
        )}
      </div>

      <div>
        <Button variant="quiet" className="-ml-3" onClick={() => setTaking(true)}>
          {c.mine.takeBack}
        </Button>
      </div>

      <Sheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        title={c.mine.openTitle(partner.name)}
        footer={
          <div className="flex flex-col gap-1.5">
            <Button block size="lg" disabled={opening || !picking || picking.length === 0} onClick={() => void open()}>
              {c.mine.openConfirm}
            </Button>
            <Button variant="quiet" block onClick={() => setPicking(null)}>
              {c.mine.notYet}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-3 pb-1">
          <p className="text-sm leading-relaxed text-ink-soft">{c.mine.openBody(partner.name)}</p>
          {canOpen.length > 1 && (
            <div>
              <p className="mb-1 text-xs font-bold text-ink-soft">{c.mine.openPick}</p>
              <Card pad={false} className="divide-y divide-line px-4" data-testid="open-pick">
                {canOpen.map((layer) => (
                  <Toggle
                    key={layer}
                    label={c.mine.layer[layer]}
                    checked={picking?.includes(layer) ?? false}
                    onChange={(on) => setPicking((was) => (was ? (on ? [...was, layer] : was.filter((other) => other !== layer)) : was))}
                  />
                ))}
              </Card>
            </div>
          )}
        </div>
      </Sheet>

      <ConfirmSheet open={taking} title={c.mine.takeBackTitle} confirmLabel={c.mine.takeBackConfirm} cancelLabel={c.mine.keep} busy={working} onClose={() => setTaking(false)} onConfirm={() => void reallyTakeBack()}>
        {c.mine.takeBackBody(partner.name).map((line) => (
          <p key={line}>{line}</p>
        ))}
      </ConfirmSheet>
    </div>
  )
}
