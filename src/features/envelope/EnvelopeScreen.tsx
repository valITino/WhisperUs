// One envelope, on its own page: /envelope/:id. Whose it is decides what the page is.

import { navigate } from '../../app/router'
import { useEnvelope, useRoom } from '../../data/queries'
import type { ID } from '../../data/types'
import { useCopy } from '../../i18n'
import { Button, EmptyState, Loader, PageHeader, Screen } from '../../ui/components'
import { envelopeCopy } from './copy'
import { Mine } from './Mine'
import { Theirs } from './Theirs'

export function EnvelopeScreen({ id }: { id: ID }) {
  const c = useCopy(envelopeCopy)
  const view = useEnvelope(id)
  const room = useRoom()

  if (view === undefined || room === undefined) {
    return (
      <Screen className="grid place-items-center">
        <Loader />
      </Screen>
    )
  }

  const partner = room?.partner
  if (!view || !room || !partner) {
    return (
      <Screen>
        <PageHeader title={c.plain} backTo="/" />
        <main className="app-column pt-6" data-testid="envelope-gone">
          <EmptyState
            lit={false}
            title={c.gone.title}
            body={c.gone.body}
            action={
              <Button variant="secondary" onClick={() => navigate('/', { replace: true })}>
                {c.gone.home}
              </Button>
            }
          />
        </main>
      </Screen>
    )
  }

  return (
    <Screen>
      <PageHeader title={view.mine ? c.for(partner.name) : c.from(partner.name)} backTo="/" />
      <main className="app-column px-4 pt-6">{view.mine ? <Mine view={view} partner={partner} /> : <Theirs view={view} author={partner} />}</main>
    </Screen>
  )
}
