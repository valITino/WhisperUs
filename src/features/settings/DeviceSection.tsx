// The "This device" part of the Settings page: the way to Notifications, and the card
// for installing the app. Both are about the phone in hand, not about the person.

import { navigate } from '../../app/router'
import { useCopy } from '../../i18n'
import { usePush } from '../../pwa/notifications'
import { Card } from '../../ui/components'
import { Icon } from '../../ui/deco/Icon'
import { deviceCopy } from './deviceCopy'
import { InstallCard } from './InstallCard'

export function DeviceSection() {
  const c = useCopy(deviceCopy)
  const push = usePush()

  return (
    <section aria-labelledby="device-title">
      <h2 id="device-title" className="mb-2.5 px-1 text-lg">
        {c.section}
      </h2>
      <div className="flex flex-col gap-3">
        <Card pad={false} className="overflow-hidden">
            <button type="button" onClick={() => navigate('/settings/notifications')} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-haze/40">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold">{c.notifications.row}</span>
                <span className="mt-0.5 block text-xs leading-snug text-ink-soft" data-testid="notifications-state">
                  {c.notifications.rowHints[push.status]}
                </span>
              </span>
              <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
            </button>
        </Card>
        <InstallCard />
      </div>
    </section>
  )
}
