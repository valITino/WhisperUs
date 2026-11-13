// What is inside an envelope, once it is open on this phone: how it felt, the words,
// the voice. The same view for the one who wrote it and the one it is for.

import { useCopy, useT } from '../../i18n'
import { Card, HeatMeter } from '../../ui/components'
import { Player } from '../voice/Player'
import { WhyView } from '../why'
import { envelopeCopy } from './copy'
import type { Inside } from './inside'

interface Props {
  inside: Inside
  /** Whose envelope it is, for the headings. Null when the reader is its author. */
  author: string | null
}

export function InsideView({ inside, author }: Props) {
  const c = useCopy(envelopeCopy).inside
  const t = useT()
  const { feel, words, voice } = inside

  return (
    <div className="flex flex-col gap-6" data-testid="inside">
      {words && (
        <section aria-labelledby="inside-words">
          <h2 id="inside-words" className="mb-2 text-lg">
            {author ? c.wordsTitle(author) : c.wordsMine}
          </h2>
          {/* A sheet of letter paper: the words are the largest thing on the page. */}
          <Card tone="note" className="font-display text-[1.2rem] leading-relaxed" data-testid="inside-words">
            <p className="whitespace-pre-wrap break-words">{words.text}</p>
          </Card>
        </section>
      )}

      {voice && (
        <section aria-labelledby="inside-voice">
          <h2 id="inside-voice" className="mb-2 text-lg">
            {author ? c.voiceTitle(author) : c.voiceMine}
          </h2>
          {voice.sound ? <Player sound={voice.sound} seconds={voice.body.seconds} labels={c} /> : <p className="text-sm text-ink-soft">{c.voiceComing}</p>}
        </section>
      )}

      {feel && (
        <section aria-labelledby="inside-feel">
          <h2 id="inside-feel" className="mb-2 text-lg">
            {author ? c.feelTitle(author) : c.feelMine}
          </h2>
          <Card pad={false} className="flex flex-col gap-3.5 p-4" data-testid="inside-feel">
            {feel.heat !== null && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-semibold text-ink-soft">{c.heat}</span>
                <span className="flex items-center gap-2">
                  <span className="text-sm font-bold">{t.heat[feel.heat - 1]}</span>
                  <HeatMeter label={c.heat} value={feel.heat} size={22} />
                </span>
              </div>
            )}
            {feel.ease !== null && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="text-sm font-semibold text-ink-soft">{c.ease}</span>
                <span className="text-sm font-bold">{c.easeWords[feel.ease - 1]}</span>
              </div>
            )}
            <WhyView why={feel.why} />
          </Card>
        </section>
      )}
    </div>
  )
}
