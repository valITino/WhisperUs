// The one page of a build that does not know its cloud yet (src/data/cloud.ts). It is
// what the published address shows between "the code is out" and "the room's database
// exists": honest about why nothing can be done here, and clear about who can change it.

import { setLang, useCopy, useLang, useT, type Lang } from '../../i18n'
import { Card, Segmented } from '../../ui/components'
import { Envelope } from '../../ui/deco/Deco'

const copy = {
  en: {
    language: 'Language',
    title: 'Not connected yet',
    body: 'This copy of the app does not know its cloud yet. So no room can be opened or joined here, and nothing you do on this page is stored anywhere.',
    ownerTitle: 'If you are setting it up',
    owner: 'Create the room\'s own Supabase project, put its address and its publishable key into the file .env.production and publish again. The README has every step under "Connecting the cloud".',
    after: 'After that this page becomes the start screen by itself.',
  },
  de: {
    language: 'Sprache',
    title: 'Noch nicht verbunden',
    body: 'Diese Kopie der App kennt ihre Cloud noch nicht. Darum lässt sich hier kein Zimmer öffnen und keinem beitreten, und nichts, was du auf dieser Seite tust, wird irgendwo gespeichert.',
    ownerTitle: 'Falls du sie einrichtest',
    owner: 'Lege das eigene Supabase-Projekt des Zimmers an, trage seine Adresse und seinen öffentlichen Schlüssel in die Datei .env.production ein und veröffentliche neu. Im README steht jeder Schritt unter «Connecting the cloud».',
    after: 'Danach wird diese Seite von selbst zum Startbildschirm.',
  },
}

export function NoCloudScreen() {
  const c = useCopy(copy)
  const t = useT()
  const lang = useLang()
  return (
    <div className="flex min-h-dvh flex-col bg-ground" data-testid="no-cloud">
      <header className="bg-haze">
        <div className="app-column flex flex-col items-center px-5 pb-7 pt-[max(2.5rem,env(safe-area-inset-top))] text-center">
          <Envelope size={132} className="h-24 w-auto drop-shadow-[0_10px_14px_#2c1b3340]" />
          <h1 className="mt-5 text-[2.7rem] font-semibold leading-none">{t.brand.name}</h1>
          <p className="whispered mt-2 text-xl text-accent">{t.brand.slogan}</p>
          <div className="mt-5 w-52">
            <Segmented<Lang>
              label={c.language}
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

      <main className="app-column flex flex-1 flex-col gap-4 px-5 pb-8 pt-7">
        <div>
          <h2 className="text-2xl font-semibold leading-tight">{c.title}</h2>
          <p className="mt-2 text-pretty leading-relaxed text-ink-soft">{c.body}</p>
        </div>
        <Card tone="haze">
          <h3 className="font-bold">{c.ownerTitle}</h3>
          <p className="mt-1.5 text-pretty text-sm leading-relaxed">{c.owner}</p>
          <p className="mt-2 text-sm leading-relaxed text-ink-soft">{c.after}</p>
        </Card>
      </main>
    </div>
  )
}
