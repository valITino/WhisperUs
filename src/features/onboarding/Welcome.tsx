// The first screen on a device nobody is logged in on: a sealed envelope, the name, the
// language, then two doors (start from scratch, I have a code) and the quiet way back in
// for someone who has been here before.

import { useEffect, useRef } from 'react'
import { setLang, useCopy, useLang, useT, type Lang } from '../../i18n'
import { Button, Segmented } from '../../ui/components'
import { Envelope } from '../../ui/deco/Deco'
import { pairingCopy } from './copy'
import { WarningNote } from './parts'

interface Props {
  /** True while we ask the cloud whether a room exists already. */
  checking: boolean
  /** Why "Start from scratch" did not go on, if it did not. */
  problem: string | null
  onStart: () => void
  onCode: () => void
  onLogin: () => void
}

export function Welcome({ checking, problem, onStart, onCode, onLogin }: Props) {
  const c = useCopy(pairingCopy)
  const t = useT()
  const lang = useLang()
  const hint = 'mx-auto mt-1.5 max-w-[40ch] text-balance text-center text-xs leading-snug text-ink-soft'

  // The note names two ways on: the code door right below it and the way back in at the
  // bottom. On a short screen the note pushes that one out of view, so bring it back.
  const wayBack = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!problem) return
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    wayBack.current?.scrollIntoView({ block: 'nearest', behavior: calm ? 'auto' : 'smooth' })
  }, [problem])

  return (
    <div className="flex min-h-dvh flex-col bg-ground" data-testid="welcome">
      <header className="bg-haze">
        <div className="app-column flex flex-col items-center px-5 pb-7 pt-[max(2.5rem,env(safe-area-inset-top))] text-center">
          {/* A little smaller on short screens, so the way back in stays in view. */}
          <Envelope size={132} className="h-[132px] w-auto drop-shadow-[0_10px_14px_#2c1b3340] [@media(max-height:780px)]:h-24" />
          <h1 className="mt-5 text-[2.7rem] font-semibold leading-none">{t.brand.name}</h1>
          <p className="whispered mt-2 text-xl text-accent">{t.brand.slogan}</p>
          <div className="mt-5 w-52 [@media(max-height:780px)]:mt-3">
            <Segmented<Lang>
              label={c.welcome.language}
              value={lang}
              options={[
                { value: 'en', label: 'English' },
                { value: 'de', label: 'Deutsch' },
              ]}
              onChange={setLang}
            />
          </div>
        </div>
      </header>

      <main className="app-column flex flex-1 flex-col px-5 pb-6 pt-7 [@media(max-height:780px)]:pb-3 [@media(max-height:780px)]:pt-4">
        <div className="flex flex-col gap-4 [@media(max-height:780px)]:gap-3">
          <div>
            <Button size="lg" block disabled={checking} onClick={onStart}>
              {checking ? c.welcome.checking : c.welcome.start}
            </Button>
            <p className={hint}>{c.welcome.startHint}</p>
          </div>
          {problem && (
            <div data-testid="welcome-note">
              <WarningNote>{problem}</WarningNote>
            </div>
          )}
          <div>
            <Button variant="secondary" block onClick={onCode}>
              {c.welcome.code}
            </Button>
            <p className={hint}>{c.welcome.codeHint}</p>
          </div>
        </div>
        <div ref={wayBack} className="mt-auto flex scroll-mb-3 flex-wrap items-center justify-center gap-x-1 pt-5 [@media(max-height:780px)]:pt-2">
          <span className="text-sm text-ink-soft">{c.welcome.beenHere}</span>
          <Button variant="quiet" onClick={onLogin}>
            {c.welcome.login}
          </Button>
        </div>
      </main>
    </div>
  )
}
