// A check-in, read: every part that is there, in words. A profile shows the parts
// somebody opened with it, and nothing else of that check-in exists on the phone that
// reads them.

import type { CheckinBody, Idea, Score5 } from '../../data/types'
import { CHECKIN_SCALES } from '../../data/types'
import { useCopy, useLang } from '../../i18n'
import { itemWords } from '../list/library'
import { WhyView } from '../why'
import { checkinCopy } from './copy'
import { happenedWords, oftenWords, SCALES } from './library'
import { stepWords } from './words'

const CHIP = 'inline-flex items-center rounded-full bg-surface px-3 py-1.5 text-xs font-bold leading-tight'

export function CheckinView({ body, ideas }: { body: CheckinBody; ideas: readonly Idea[] }) {
  const c = useCopy(checkinCopy).view
  const lang = useLang()
  const scales = CHECKIN_SCALES.filter((scale) => body[scale] !== undefined)
  const fantasies = (body.fantasies ?? []).map((id) => ({ id, name: itemWords(id, lang, ideas) })).filter((row): row is { id: string; name: string } => row.name !== null)
  const happened = body.happened ?? []

  return (
    <div className="flex flex-col gap-3.5" data-testid="checkin-view">
      {(scales.length > 0 || body.thoughts !== undefined) && (
        <dl className="flex flex-col gap-1.5">
          {scales.map((scale) => (
            <div key={scale} className="flex flex-wrap items-baseline justify-between gap-x-4">
              <dt className="text-sm font-semibold text-ink-soft">{SCALES[scale][lang].short}</dt>
              <dd className="text-sm font-bold">{stepWords(scale, body[scale] as Score5, lang)}</dd>
            </div>
          ))}
          {body.thoughts !== undefined && (
            <div className="flex flex-wrap items-baseline justify-between gap-x-4">
              <dt className="text-sm font-semibold text-ink-soft">{c.thoughts}</dt>
              <dd className="text-sm font-bold">{oftenWords(body.thoughts, lang)}</dd>
            </div>
          )}
        </dl>
      )}
      {happened.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink-soft">{c.happened}</p>
          <ul className="flex flex-wrap gap-1.5">
            {happened.map((id) => (
              <li key={id} className={CHIP}>
                {happenedWords(id, lang)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {fantasies.length > 0 && (
        <div>
          <p className="mb-1.5 text-sm font-semibold text-ink-soft">{c.fantasies}</p>
          <ul className="flex flex-wrap gap-1.5">
            {fantasies.map((row) => (
              <li key={row.id} className={CHIP}>
                {row.name}
              </li>
            ))}
          </ul>
        </div>
      )}
      {body.why && <WhyView why={body.why} />}
    </div>
  )
}
