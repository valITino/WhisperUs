// Lines of news: each names who and what kind of thing, says when, and leads to the
// thing itself. On the news page, and (the new ones) on the room.

import { navigate } from '../../app/router'
import type { NewsItem, NewsKind } from '../../data/news'
import { useCopy, useLang, useT } from '../../i18n'
import { dayAndTime } from '../../lib/when'
import { cx, Tag } from '../../ui/components'
import { Icon, type IconName } from '../../ui/deco/Icon'
import { lineOf, newsCopy } from './copy'

const ICONS: Record<NewsKind, IconName> = { ready: 'home', sealed: 'home', answered: 'home', wished: 'wish', decided: 'wish', matched: 'heart', idea: 'heart', about: 'us', shown: 'clock' }

export function NewsList({ items, partner, testId }: { items: readonly NewsItem[]; partner: string | null; testId?: string }) {
  const c = useCopy(newsCopy)
  const t = useT()
  const lang = useLang()
  const name = partner ?? c.someone
  return (
    <ul className="flex flex-col gap-2" data-testid={testId}>
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            data-testid="news-row"
            data-kind={item.kind}
            data-fresh={item.fresh ? 'yes' : 'no'}
            onClick={() => navigate(item.to)}
            className={cx('flex min-h-14 w-full items-center gap-3 rounded-card border bg-surface px-3.5 py-3 text-left active:translate-y-[2px]', item.fresh ? 'border-accent' : 'border-line')}
          >
            <span className={cx('grid size-10 shrink-0 place-items-center rounded-full', item.fresh ? 'bg-haze text-accent' : 'bg-haze/60 text-ink-soft')} aria-hidden>
              <Icon name={ICONS[item.kind]} size={20} />
            </span>
            <span className="min-w-0 flex-1">
              <span className={cx('block text-sm leading-snug', item.fresh ? 'font-bold' : 'font-semibold')}>{lineOf(c, item.kind, name, item.count, item.fresh)}</span>
              <span className="mt-0.5 block text-xs font-semibold text-ink-soft">{dayAndTime(item.at, lang, t.common)}</span>
            </span>
            {item.fresh && <Tag tone="wax">{c.newTag}</Tag>}
            <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** The bell: opens the news, and carries the number of things not looked at yet. */
export function NewsBell({ count }: { count: number }) {
  const c = useCopy(newsCopy)
  return (
    <button type="button" data-testid="news-bell" data-count={count} aria-label={c.bell(count)} onClick={() => navigate('/news')} className="relative grid size-11 shrink-0 place-items-center rounded-full border-[1.5px] border-line-strong bg-surface text-ink transition-transform duration-100 active:scale-90">
      <Icon name="bell" size={22} />
      {count > 0 && (
        <span aria-hidden className="absolute -right-1 -top-1 grid min-w-4.5 place-items-center rounded-full bg-wax px-1 text-2xs font-extrabold leading-4.5 text-on-wax">
          {count > 9 ? '9+' : count}
        </span>
      )}
    </button>
  )
}
