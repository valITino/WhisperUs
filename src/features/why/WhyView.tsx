// A why, shown: the reasons somebody tapped, their own words, and their sentence.

import type { Why } from '../../data/types'
import { useLang } from '../../i18n'
import { cx } from '../../ui/components'
import { isEmptyWhy, reasonById, reasonWords } from './library'

export function WhyView({ why, className }: { why: Why; className?: string }) {
  const lang = useLang()
  if (isEmptyWhy(why)) return null
  const chip = 'inline-flex items-center rounded-full px-3 py-1.5 text-xs font-bold leading-tight'
  return (
    <div className={cx('flex flex-col gap-2.5', className)} data-testid="why">
      {(why.chips.length > 0 || why.own.length > 0) && (
        <ul className="flex flex-wrap gap-1.5">
          {why.chips.map((id) => (
            // Warm reasons are filled, tender ones are outlined: told apart without colour alone.
            <li key={id} className={cx(chip, reasonById(id)?.tone === 'tender' ? 'border-[1.5px] border-line-strong' : 'bg-[color-mix(in_srgb,var(--color-accent)_18%,transparent)]')}>
              {reasonWords(id, lang)}
            </li>
          ))}
          {why.own.map((own) => (
            <li key={`own-${own}`} className={cx(chip, 'bg-ink text-ground')}>
              {own}
            </li>
          ))}
        </ul>
      )}
      {why.note?.trim() && <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{why.note.trim()}</p>}
    </div>
  )
}
