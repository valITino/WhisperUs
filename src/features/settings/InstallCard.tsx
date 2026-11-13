// "Install WhisperUs": one calm card in Settings. With Chrome's install prompt on offer
// it is one tap; otherwise one sentence says where to find it in the browser's menu.
// Nothing at all when the app already runs installed. No banners anywhere else.

import { useState } from 'react'
import { useCopy } from '../../i18n'
import { install, useInstallState } from '../../pwa/install'
import { Button, Card, toast } from '../../ui/components'
import { deviceCopy } from './deviceCopy'

export function InstallCard() {
  const c = useCopy(deviceCopy).install
  const state = useInstallState()
  const [busy, setBusy] = useState(false)
  if (state === 'installed') return null

  const go = async () => {
    setBusy(true)
    const accepted = await install().catch(() => false)
    setBusy(false)
    if (accepted) toast(c.installed)
  }

  return (
    <Card className="flex flex-col items-start gap-2.5" data-testid="install-card">
      <h3 className="text-base">{c.title}</h3>
      <p className="text-sm text-ink-soft">{state === 'ready' ? c.ready : c.manual}</p>
      {state === 'ready' && (
        <Button variant="secondary" className="mt-0.5" disabled={busy} onClick={() => void go()}>
          {c.button}
        </Button>
      )}
    </Card>
  )
}
