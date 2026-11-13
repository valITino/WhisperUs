// Pages around the invite: the first steps right after opening a room ("you are the
// admin", then the invite), the invite again while the second seat is free, and the
// one-time code that lets the partner back in.

import { navigate } from '../../app/router'
import { useMe } from '../../data/hooks'
import { usePartner } from '../../data/queries'
import { useCopy } from '../../i18n'
import { Button } from '../../ui/components'
import { pairingCopy } from '../onboarding/copy'
import { InvitePanel } from '../onboarding/InvitePanel'
import { StepPage } from '../onboarding/parts'
import { settingsCopy } from './copy'

/** Right after "Open the room": you are its admin, and here is the invite for your partner. */
export function FirstSteps() {
  const p = useCopy(pairingCopy)
  const c = useCopy(settingsCopy)
  const partner = usePartner()

  return (
    <StepPage
      footer={
        <Button variant={partner ? 'primary' : 'secondary'} size={partner ? 'lg' : 'md'} block onClick={() => navigate('/', { replace: true })}>
          {c.first.done}
        </Button>
      }
    >
      <div className="flex flex-col gap-6 px-4 pt-[max(1.25rem,env(safe-area-inset-top))]" data-testid="first-steps">
        <div>
          <h1 className="text-2xl">{partner ? p.invite.completeTitle : p.admin.title}</h1>
          <p className="mt-2 text-sm text-ink-soft">{partner ? p.invite.completeLead : p.admin.lead}</p>
        </div>
        <div className="flex flex-col gap-3">
          {!partner && (
            <div>
              <h2 className="text-xl">{p.admin.inviteTitle}</h2>
              <p className="mt-1.5 text-sm text-ink-soft">{p.invite.lead}</p>
            </div>
          )}
          <InvitePanel kind="join" />
        </div>
      </div>
    </StepPage>
  )
}

/** Settings, while the second seat is free: the invite again. */
export function InvitePage() {
  const p = useCopy(pairingCopy)
  const partner = usePartner()
  return (
    <StepPage title={partner ? p.invite.completeTitle : p.invite.title} backTo="/settings">
      <div className="flex flex-col gap-5 px-4">
        <p className="text-sm text-ink-soft">{partner ? p.invite.completeLead : p.invite.lead}</p>
        <InvitePanel kind="join" />
      </div>
    </StepPage>
  )
}

/** The admin lets the partner back in: a one-time code that leads to a new PIN. */
export function BackInPage() {
  const c = useCopy(settingsCopy)
  const me = useMe()
  const partner = usePartner()
  const ready = Boolean(me?.member?.isAdmin && partner)
  return (
    <StepPage title={partner ? c.people.backIn(partner.name) : c.people.title} backTo="/settings/people">
      {ready && partner && (
        <div className="flex flex-col gap-5 px-4" data-testid="back-in">
          <p className="text-sm text-ink-soft">{c.backIn.lead(partner.name)}</p>
          <InvitePanel kind="restore" memberId={partner.id} />
        </div>
      )}
    </StepPage>
  )
}
