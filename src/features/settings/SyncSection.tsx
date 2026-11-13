// The Sync section of Settings: where things stand, in one line, and the way to the
// Sync page, which has the details and the things to do.

import { navigate } from '../../app/router'
import { useSyncStatus } from '../../data/app'
import { useCopy } from '../../i18n'
import { Card, SyncPill } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { settingsCopy } from './copy'

export function SyncSection() {
  const c = useCopy(settingsCopy)
  const status = useSyncStatus()
  // Nothing is on its way, yet not everything arrived: "Everything is synced" would be a fib.
  const refused = status.stuck > 0 && (status.state === 'idle' || status.state === 'syncing')

  return (
    <section aria-labelledby="sync-title">
      <h2 id="sync-title" className="mb-2.5 px-1 text-lg">
        {c.sync.title}
      </h2>
      <Card pad={false} className="overflow-hidden" data-testid="sync-section">
        <div className="divide-y divide-line">
            <div className="px-4 pb-3.5 pt-3.5">
              <SyncPill status={status} />
              <p className="mt-2.5 text-sm" data-testid="sync-words">
                {refused ? c.sync.openHintRefused(status.stuck) : c.sync.states[status.state]}
              </p>
            </div>
            <button type="button" onClick={() => navigate('/settings/sync')} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-haze/40">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{c.sync.open}</span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{c.sync.openHint}</span>
              </span>
              <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
            </button>
        </div>
      </Card>
    </section>
  )
}
