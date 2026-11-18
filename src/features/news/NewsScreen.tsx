// "News": the one place that says what happened in the room, in lines that lead to the
// thing itself. What has not been looked at yet comes first.
//
// It is the in-app side of the notifications: those reach a phone while the app is
// closed, this is where the same news waits. Both say who, never what.

import { navigate } from '../../app/router'
import { useNews, usePartner } from '../../data/queries'
import { useCopy } from '../../i18n'
import { usePush } from '../../pwa/notifications'
import { Card, EmptyState, Loader } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { StepPage } from '../onboarding/parts'
import { newsCopy } from './copy'
import { NewsList } from './NewsList'

export function NewsScreen() {
  const c = useCopy(newsCopy)
  const news = useNews()
  const partner = usePartner()
  const { status } = usePush()

  if (!news || partner === undefined) {
    return (
      <StepPage title={c.title} backTo="/">
        <Loader />
      </StepPage>
    )
  }
  const fresh = news.items.filter((item) => item.fresh)
  const earlier = news.items.filter((item) => !item.fresh)
  const name = partner?.name ?? null

  return (
    <StepPage title={c.title} backTo="/">
      <div className="flex flex-col gap-7 px-4" data-testid="news">
        {news.items.length === 0 ? (
          <EmptyState lit={false} title={c.empty.title} body={c.empty.body} />
        ) : (
          <>
            <section aria-labelledby="news-fresh">
              <h2 id="news-fresh" className="mb-2.5 px-1 text-lg">
                {c.fresh}
              </h2>
              {fresh.length > 0 ? (
                <NewsList items={fresh} partner={name} testId="news-fresh-list" />
              ) : (
                <p className="px-1 text-sm text-ink-soft" data-testid="news-none">
                  {c.nothingNew}
                </p>
              )}
            </section>
            {earlier.length > 0 && (
              <section aria-labelledby="news-earlier">
                <h2 id="news-earlier" className="mb-2.5 px-1 text-lg">
                  {c.earlier}
                </h2>
                <NewsList items={earlier} partner={name} testId="news-earlier-list" />
              </section>
            )}
            <p className="-mt-3 px-1 text-xs leading-snug text-ink-soft">{c.lead}</p>
          </>
        )}

        <section aria-labelledby="news-push">
          <h2 id="news-push" className="mb-2.5 px-1 text-lg">
            {c.push.title}
          </h2>
          <Card pad={false} className="overflow-hidden">
            <button type="button" data-testid="news-push" data-status={status} onClick={() => navigate('/settings/notifications')} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-haze/40">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold">{c.push.action}</span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{status === 'on' ? c.push.on : status === 'off' || status === 'blocked' ? c.push.off : c.push.unknown}</span>
              </span>
              <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
            </button>
          </Card>
        </section>
      </div>
    </StepPage>
  )
}
