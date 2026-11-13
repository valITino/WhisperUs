// "People": who sits at this table. Both see both profiles. Whoever opened the room
// is its admin and gets the controls for the partner's seat: invite, let back in, pause,
// log out everywhere.

import { useState } from 'react'
import { navigate } from '../../app/router'
import { backend, sync } from '../../data/app'
import { useMe } from '../../data/hooks'
import { useMembers } from '../../data/queries'
import type { Member } from '../../data/types'
import { useCopy } from '../../i18n'
import { Avatar, Button, Card, Loader, Tag, toast } from '../../ui/components'
import { Candle } from '../../ui/deco/Deco'
import { Icon } from '../../ui/deco/Icon'
import { ConfirmSheet, ErrorNote, StepPage } from '../onboarding/parts'
import { useExplain } from '../onboarding/useExplain'
import { settingsCopy } from './copy'

type Question = 'pause' | 'unpause' | 'logout'

function Person({ member, isMe }: { member: Member; isMe: boolean }) {
  const c = useCopy(settingsCopy)
  return (
    <div className="flex items-center gap-4 p-4 pt-5" data-testid={isMe ? 'person-me' : 'person-partner'}>
      <Avatar avatar={member.avatar} color={member.color} accessory={member.accessory} size={56} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2">
          <span className="truncate font-display text-lg font-bold leading-tight">{member.name}</span>
          {isMe && <span className="shrink-0 text-xs font-bold text-ink-soft">{c.people.you}</span>}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {member.isAdmin && <Tag>{c.people.admin}</Tag>}
          {member.disabledAt && (
            <Tag>
              <Icon name="clock" size={12} /> {c.people.paused}
            </Tag>
          )}
        </div>
      </div>
    </div>
  )
}

/** One thing the admin can do for the partner's seat. */
function Control({ title, hint, onClick, opens = false }: { title: string; hint: string; onClick: () => void; opens?: boolean }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-haze/40">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-bold">{title}</span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{hint}</span>
      </span>
      {opens && <Icon name="next" size={20} className="shrink-0 text-ink-soft" />}
    </button>
  )
}

export function PeoplePage() {
  const c = useCopy(settingsCopy)
  const explain = useExplain()
  const me = useMe()
  const members = useMembers()
  const [asking, setAsking] = useState<Question | null>(null)
  const [working, setWorking] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const mine = me?.member
  const partner = members?.find((m) => m.id !== me?.memberId)
  const admin = members?.find((m) => m.isAdmin)
  const iAmAdmin = Boolean(mine?.isAdmin)

  const run = async (question: Question) => {
    if (!partner) return
    setWorking(true)
    setProblem(null)
    try {
      if (question === 'logout') {
        toast(c.people.loggedOut(partner.name, await backend.signOutMember(partner.id)))
      } else {
        await backend.setMemberPaused(partner.id, question === 'pause')
        // Fetch the changed seat right away, so the tag on this page is true at once.
        await sync.sync()
        toast(question === 'pause' ? c.people.pausedToast(partner.name) : c.people.unpausedToast(partner.name))
      }
    } catch (e) {
      setProblem(explain(e))
    }
    setAsking(null)
    setWorking(false)
  }

  const sheets: Record<Question, { title: string; body: string[]; confirm: string }> | null = partner
    ? {
        pause: { title: c.people.pauseTitle(partner.name), body: c.people.pauseBody(partner.name), confirm: c.people.pause(partner.name) },
        unpause: { title: c.people.unpauseTitle(partner.name), body: c.people.unpauseBody(partner.name), confirm: c.people.unpause(partner.name) },
        logout: { title: c.people.logOutTitle(partner.name), body: c.people.logOutBody(partner.name), confirm: c.people.logOutConfirm(partner.name) },
      }
    : null
  // The sheet keeps its words while it slides away.
  const [lastAsked, setLastAsked] = useState<Question>('pause')
  const ask = (question: Question) => {
    setLastAsked(question)
    setAsking(question)
  }
  const sheet = sheets?.[asking ?? lastAsked]

  return (
    <StepPage title={c.people.title} backTo="/settings">
      {!mine || !members ? (
        <Loader />
      ) : (
        <div className="flex flex-col gap-4 px-4" data-testid="people">
          <div className="flex flex-col gap-1.5 text-sm text-ink-soft" data-testid="people-note">
            <p>{iAmAdmin ? c.people.asAdmin : c.people.notAdmin(admin?.name ?? '')}</p>
            {/* Both read the same sentence: looking after the seats is all an admin does. */}
            <p>{c.people.sealNote}</p>
          </div>

          <Card pad={false}>
            <Person member={mine} isMe />
          </Card>

          {partner ? (
            <Card pad={false} className="divide-y divide-line overflow-hidden">
              <Person member={partner} isMe={false} />
              {iAmAdmin && (
                <div className="divide-y divide-line" data-testid="admin-controls">
                  <Control title={c.people.backIn(partner.name)} hint={c.people.backInHint} opens onClick={() => navigate('/settings/people/back-in')} />
                  {partner.disabledAt ? (
                    <Control title={c.people.unpause(partner.name)} hint={c.people.unpauseHint} onClick={() => ask('unpause')} />
                  ) : (
                    <Control title={c.people.pause(partner.name)} hint={c.people.pauseHint} onClick={() => ask('pause')} />
                  )}
                  <Control title={c.people.logOutAll(partner.name)} hint={c.people.logOutAllHint} onClick={() => ask('logout')} />
                </div>
              )}
            </Card>
          ) : (
            iAmAdmin && (
              <Card pad={false} className="flex items-center gap-3 p-4" data-testid="free-seat">
                <div className="min-w-0 flex-1">
                  <h2 className="text-base">{c.people.freeTitle}</h2>
                  <p className="mt-1 text-xs leading-snug text-ink-soft">{c.people.freeBody}</p>
                  <Button variant="secondary" className="mt-3" onClick={() => navigate('/settings/invite')}>
                    {c.room.invite}
                  </Button>
                </div>
                <Candle size={64} lit={false} className="shrink-0" />
              </Card>
            )
          )}

          {problem && <ErrorNote>{problem}</ErrorNote>}
        </div>
      )}

      {sheet && (
        <ConfirmSheet open={asking !== null} title={sheet.title} confirmLabel={sheet.confirm} cancelLabel={c.people.leave} busy={working} onClose={() => setAsking(null)} onConfirm={() => asking && void run(asking)}>
          {sheet.body.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </ConfirmSheet>
      )}
    </StepPage>
  )
}
