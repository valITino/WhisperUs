// One envelope as a row: its line on the outside, and where it stands right now. On the
// room, and on a profile under what somebody sealed.

import { navigate } from '../../app/router'
import type { EnvelopeView } from '../../data/envelopes'
import type { Member } from '../../data/types'
import { useCopy, useLang } from '../../i18n'
import { inWords } from '../../lib/when'
import { cx, Tag } from '../../ui/components'
import { Envelope } from '../../ui/deco/Deco'
import { Icon } from '../../ui/deco/Icon'
import { homeCopy } from './copy'

/** `partner` is the other of the two, whoever sealed it. `fresh` marks an answer not looked at yet. */
export function EnvelopeRow({ view, partner, fresh }: { view: EnvelopeView; partner: Member; fresh: boolean }) {
  const c = useCopy(homeCopy).card
  const lang = useLang()
  const { envelope, standing } = view
  const when = view.nextOpening ? inWords(view.nextOpening, lang) : null

  let line: string
  if (standing === 'ready') line = view.layers.some((l) => l.seenAt) ? c.readyMore : c.ready
  else if (standing === 'waiting') line = when ? c.waitingAt(when) : c.waitingHand(partner.name)
  else if (standing === 'opened') line = view.answered ? c.openedAnswered : c.opened
  else if (view.answered) line = c.answered(partner.name)
  else if (standing === 'out') line = c.out(partner.name)
  else line = when ? c.sealedAt(when) : c.sealedHand

  const asks = standing === 'ready' || fresh
  const title = envelope.teaser?.trim()
  const open = standing === 'opened' || standing === 'out'

  return (
    <li>
      <button
        type="button"
        data-testid="envelope-row"
        data-standing={standing}
        aria-label={c.open(`${title ?? c.plain}. ${line}`)}
        onClick={() => navigate(`/envelope/${envelope.id}`)}
        className={cx('flex w-full items-center gap-3.5 rounded-card border bg-surface p-3 text-left active:translate-y-[2px]', asks ? 'border-accent' : 'border-line')}
      >
        <Envelope size={54} state={open ? 'open' : 'sealed'} className="shrink-0 drop-shadow-[0_3px_5px_#2c1b3333]" />
        <span className="min-w-0 flex-1">
          {title ? <span className="handwritten block truncate text-[1.3rem] leading-tight text-accent">{title}</span> : <span className="block truncate text-sm font-semibold text-ink-soft">{c.plain}</span>}
          <span className={cx('mt-0.5 block text-xs leading-snug', asks ? 'font-bold text-ink' : 'font-semibold text-ink-soft')}>{line}</span>
        </span>
        {fresh && <Tag tone="wax">{c.newAnswer}</Tag>}
        <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
      </button>
    </li>
  )
}
