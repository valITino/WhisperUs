// One wish as a row: its words, and where it stands. On the wishes page, and on a profile.

import { navigate } from '../../app/router'
import type { Member, Wish } from '../../data/types'
import { useCopy } from '../../i18n'
import { cx, Tag } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { wishesCopy } from './copy'

/** `mine` says whether I wished it; `partner` is the other of the two. `fresh` marks what I have not looked at yet. */
export function WishRow({ wish, mine, partner, fresh }: { wish: Wish; mine: boolean; partner: Member; fresh: boolean }) {
  const c = useCopy(wishesCopy)
  const answered = wish.answer !== null
  const decided = wish.answer?.decision ? c.decision[wish.answer.decision] : c.row.answeredNoDecision
  const line = answered ? (mine ? `${partner.name}: ${decided}` : decided) : mine ? c.row.waitingTheirs(partner.name) : c.row.waitingMine
  const asks = fresh || (!mine && !answered)
  return (
    <li>
      <button
        type="button"
        data-testid="wish-row"
        aria-label={c.row.open(`${wish.text}. ${line}`)}
        onClick={() => navigate(`/wishes/${wish.id}`)}
        className={cx('flex w-full items-center gap-3 rounded-card border bg-surface p-4 text-left active:translate-y-[2px]', asks ? 'border-accent' : 'border-line')}
      >
        <span className="min-w-0 flex-1">
          <span className="handwritten line-clamp-2 block break-words text-[1.3rem] leading-tight text-accent">{wish.text}</span>
          <span className={cx('mt-1 block text-xs leading-snug', asks ? 'font-bold text-ink' : 'font-semibold text-ink-soft')}>{line}</span>
        </span>
        {fresh && <Tag tone="wax">{c.row.newTag}</Tag>}
        <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
      </button>
    </li>
  )
}
