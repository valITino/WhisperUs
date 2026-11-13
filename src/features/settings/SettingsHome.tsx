// "Us": my profile, our room and its people, my own settings (they follow me to every
// device), privacy, log-in, this device, sync and a little "about". It is one of the two tabs.

import { useState, type ReactNode } from 'react'
import { version } from '../../../package.json'
import { navigate } from '../../app/router'
import { renameRoom } from '../../data/do'
import { useMe } from '../../data/hooks'
import { useHousehold, usePartner } from '../../data/queries'
import { setLang, useCopy, useLang, useT, type Lang } from '../../i18n'
import { Avatar, Button, buzz, Card, Field, Loader, Screen, Segmented, Sheet, toast, Toggle } from '../../ui/components'
import { Candle, WaxSeal } from '../../ui/deco/Deco'
import { useLockOn } from '../lock'
import { Icon } from '../../ui/deco/Icon'
import { setTheme, useTheme } from '../../ui/theme'
import { ErrorNote } from '../onboarding/parts'
import { ProfileBubble } from '../profile/ProfileBubble'
import { settingsCopy } from './copy'
import { DeviceSection } from './DeviceSection'
import { SyncSection } from './SyncSection'

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="mb-2.5 px-1 text-lg">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** A row that opens another page. */
function LinkRow({ title, hint, onClick }: { title: string; hint?: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-haze/40">
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{title}</span>
        {hint && <span className="mt-0.5 block text-xs leading-snug text-ink-soft">{hint}</span>}
      </span>
      <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
    </button>
  )
}

function RenameSheet({ open, current, onClose }: { open: boolean; current: string; onClose: () => void }) {
  const c = useCopy(settingsCopy)
  const t = useT()
  const [name, setName] = useState(current)
  const [problem, setProblem] = useState(false)

  const save = async () => {
    if (!name.trim()) return setProblem(true)
    if (name.trim() !== current) await renameRoom(name)
    toast(t.common.saved)
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={c.room.renameTitle}
      footer={
        <Button block size="lg" onClick={() => void save()}>
          {c.room.saveName}
        </Button>
      }
    >
      <div className="flex flex-col gap-3 pb-1">
        <Field
          label={c.room.nameLabel}
          value={name}
          maxLength={80}
          enterKeyHint="done"
          onChange={(e) => {
            setName(e.target.value)
            setProblem(false)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void save()
          }}
        />
        {problem && <ErrorNote>{c.room.nameMissing}</ErrorNote>}
      </div>
    </Sheet>
  )
}

export function SettingsHome() {
  const c = useCopy(settingsCopy)
  const t = useT()
  const me = useMe()
  const partner = usePartner()
  const household = useHousehold()
  const lang = useLang()
  const theme = useTheme()
  // What is on screen right now: the phone's own setting while "follow phone" is on.
  const showing = theme === 'auto' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme
  const lockOn = useLockOn()
  const [renaming, setRenaming] = useState(false)
  const member = me?.member

  return (
    <Screen tabs>
      <header className="app-column px-5 pb-1 pt-[max(1.75rem,env(safe-area-inset-top))]">
        <h1 className="text-2xl">{c.title}</h1>
      </header>
      <main className="app-column flex flex-col gap-8 px-4 pt-4">
        {/* My profile */}
        {member ? (
          <button
            type="button"
            data-testid="my-profile"
            onClick={() => navigate('/settings/profile')}
            className="flex w-full items-center gap-4 rounded-card border border-line bg-surface p-4 pt-5 text-left active:translate-y-[2px]"
          >
            <Avatar avatar={member.avatar} color={member.color} accessory={member.accessory} size={68} />
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="truncate font-display text-xl font-semibold leading-tight">{member.name}</span>
              </span>
              <span className={member.status ? 'mt-1 block break-words text-sm font-bold leading-snug' : 'mt-1 block text-sm leading-snug text-ink-soft'} data-testid="my-status">
                {member.status || c.profile.noStatus}
              </span>
            </span>
            {/* Read aloud after the name and status, so what is seen is also what is said. */}
            <span className="sr-only">{c.profile.edit}</span>
            <Icon name="next" size={20} className="shrink-0 text-ink-soft" />
          </button>
        ) : (
          <Card>
            <Loader />
          </Card>
        )}

        {/* Our room */}
        <Section id="room" title={c.room.title}>
          <div className="flex flex-col gap-3">
            {partner ? (
              <Card data-testid="partner-card">
                <p className="mb-2.5 text-2xs font-extrabold text-ink-soft">{c.room.partnerLabel}</p>
                <ProfileBubble
                  name={partner.name}
                  status={partner.status ?? ''}
                  placeholder={c.room.partnerNoStatus}
                  avatar={partner.avatar}
                  color={partner.color}
                  accessory={partner.accessory}
                />
              </Card>
            ) : partner === null ? (
              <Card pad={false} className="flex items-center gap-3 p-4" data-testid="alone-card">
                <div className="min-w-0 flex-1">
                  <h3 className="text-base">{c.room.aloneTitle}</h3>
                  <p className="mt-1 text-xs leading-snug text-ink-soft">{c.room.aloneBody}</p>
                  {member?.isAdmin && (
                    <Button variant="secondary" className="mt-3" onClick={() => navigate('/settings/invite')}>
                      {c.room.invite}
                    </Button>
                  )}
                </div>
                <Candle size={64} lit={false} className="shrink-0" />
              </Card>
            ) : null}

            <Card pad={false} className="divide-y divide-line overflow-hidden">
              <button type="button" onClick={() => setRenaming(true)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left active:bg-haze/40">
                <span className="min-w-0 flex-1">
                  <span className="block text-2xs font-extrabold text-ink-soft">{c.room.nameLabel}</span>
                  <span className="block truncate text-sm font-bold" data-testid="room-name">
                    {household?.name ?? ''}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-extrabold text-accent">{c.room.rename}</span>
              </button>
              <LinkRow title={c.room.people} hint={member?.isAdmin ? c.room.peopleHintAdmin : c.room.peopleHint} onClick={() => navigate('/settings/people')} />
            </Card>
          </div>
        </Section>

        {/* My settings: they live on the profile and follow the person */}
        <Section id="mine" title={c.mine.title}>
          <p className="-mt-1 mb-2.5 px-1 text-xs text-ink-soft">{c.mine.follow}</p>
          <Card pad={false} className="divide-y divide-line px-4">
            <div className="py-3.5">
              <p className="mb-2 text-sm font-bold">{c.mine.language}</p>
              <Segmented<Lang>
                label={c.mine.language}
                value={lang}
                options={[
                  { value: 'en', label: 'English' },
                  { value: 'de', label: 'Deutsch' },
                ]}
                onChange={(next) => {
                  buzz(8)
                  setLang(next)
                }}
              />
            </div>
            {/* Three choices: by day, after dark, or whatever the phone is set to. */}
            <div className="pb-1 pt-3.5">
              <p className="mb-2 text-sm font-bold">{c.mine.theme}</p>
              <Segmented<'light' | 'dark'>
                label={c.mine.theme}
                value={showing}
                options={[
                  { value: 'light', label: c.mine.light },
                  { value: 'dark', label: c.mine.candle },
                ]}
                onChange={(next) => {
                  buzz(8)
                  setTheme(next)
                }}
              />
              <Toggle label={c.mine.auto} checked={theme === 'auto'} onChange={(on) => setTheme(on ? 'auto' : showing)} />
            </div>
          </Card>
        </Section>

        <Section id="privacy" title={c.privacy.title}>
          <Card pad={false} className="overflow-hidden" data-testid="lock-row">
            <LinkRow title={c.privacy.lock} hint={lockOn ? c.privacy.lockOn : c.privacy.lockOff} onClick={() => navigate('/settings/lock')} />
          </Card>
        </Section>

        <Section id="access" title={c.access.title}>
          <Card pad={false} className="overflow-hidden">
            <LinkRow title={c.access.pin} hint={c.access.pinHint} onClick={() => navigate('/settings/pin')} />
          </Card>
        </Section>

        <DeviceSection />

        <SyncSection />

        {/* About */}
        <Section id="about" title={c.about.title}>
          <Card pad={false} className="flex items-center gap-4 px-4 py-4">
            <WaxSeal size={56} className="shrink-0" />
            <div className="min-w-0">
              <p className="font-display text-xl font-semibold leading-none">{t.brand.name}</p>
              <p className="whispered mt-1.5 text-base leading-none text-accent">{t.brand.slogan}</p>
              <p className="mt-2 text-xs font-semibold text-ink-soft" data-testid="app-version">
                {c.about.version(version)}
              </p>
            </div>
          </Card>
        </Section>
      </main>

      {household && <RenameSheet key={household.name} open={renaming} current={household.name} onClose={() => setRenaming(false)} />}
    </Screen>
  )
}
