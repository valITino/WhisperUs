// "Wishes": the third thing this room is for, next to the booth and the check-in. What
// each of us would like, said plainly, and the list of things to meet on.

import { navigate } from '../../app/router'
import { useList, usePartner, useWishes } from '../../data/queries'
import { useCopy } from '../../i18n'
import { Button, Card, cx, Loader, Screen, Tag } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { LaterNote } from '../share/LaterNote'
import { wishesCopy } from './copy'
import { WishRow } from './WishRow'

export function WishesScreen() {
  const c = useCopy(wishesCopy)
  const wishes = useWishes()
  const list = useList()
  const partner = usePartner()

  if (!wishes || !list || partner === undefined) {
    return (
      <Screen tabs className="grid place-items-center">
        <Loader />
      </Screen>
    )
  }

  return (
    <Screen tabs>
      <header className="app-column px-5 pb-1 pt-[max(1.75rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl">{c.title}</h1>
        <p className="mt-2 text-sm text-ink-soft">{c.lead}</p>
      </header>
      <main className="app-column flex flex-col gap-7 px-4 pt-5" data-testid="wishes">
        <LaterNote />
        {partner ? (
          <Button size="lg" block icon={<Icon name="wish" size={20} />} onClick={() => navigate('/wishes/new')}>
            {c.make}
          </Button>
        ) : (
          <Card tone="haze">
            <p className="text-sm">{c.alone}</p>
          </Card>
        )}

        <button
          type="button"
          data-testid="open-list"
          onClick={() => navigate('/list')}
          className={cx('flex w-full items-center gap-3 rounded-card border bg-surface p-4 text-left active:translate-y-[2px]', list.fresh.size > 0 ? 'border-accent' : 'border-line')}
        >
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-haze text-accent" aria-hidden>
            <Icon name="heart" size={22} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-display text-lg font-semibold leading-tight">{c.list}</span>
            <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{c.listHint(list.matches.length)}</span>
          </span>
          {list.fresh.size > 0 && <Tag tone="wax">{c.listNew}</Tag>}
          <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
        </button>

        {partner && (
          <>
            <section aria-labelledby="wishes-for-me">
              <h2 id="wishes-for-me" className="mb-2.5 px-1 text-lg">
                {c.forMe}
              </h2>
              {wishes.forMe.length > 0 ? (
                <ul className="flex flex-col gap-2.5" data-testid="wishes-for-me">
                  {wishes.forMe.map((wish) => (
                    <WishRow key={wish.id} wish={wish} mine={false} partner={partner} fresh={wishes.unopened.has(wish.id)} />
                  ))}
                </ul>
              ) : (
                <p className="px-1 text-sm text-ink-soft">{c.noneForMe(partner.name)}</p>
              )}
            </section>
            <section aria-labelledby="wishes-from-me">
              <h2 id="wishes-from-me" className="mb-2.5 px-1 text-lg">
                {c.fromMe}
              </h2>
              {wishes.fromMe.length > 0 ? (
                <ul className="flex flex-col gap-2.5" data-testid="wishes-from-me">
                  {wishes.fromMe.map((wish) => (
                    <WishRow key={wish.id} wish={wish} mine partner={partner} fresh={wishes.freshAnswers.has(wish.id)} />
                  ))}
                </ul>
              ) : (
                <p className="px-1 text-sm text-ink-soft">{c.noneFromMe}</p>
              )}
            </section>
          </>
        )}
      </main>
    </Screen>
  )
}
