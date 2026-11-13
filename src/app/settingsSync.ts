// A person's settings (language and light) live on their profile, so they
// follow the person to every phone and tablet they log in on.
//
// The profile is the truth. A change made here is written to the profile; a profile that
// arrives from the cloud (after logging in, or changed on another device) is applied here.

import { liveQuery } from 'dexie'
import { db } from '../data/app'
import { updateMyProfile } from '../data/do'
import { META } from '../data/db'
import type { ID, MemberPrefs } from '../data/types'
import { getLang, onLangChange, setLang } from '../i18n'
import { getTheme, onThemeChange, setTheme } from '../ui/theme'

/** The settings this device applies. A profile may carry more (prefs this file does not look at); those are kept as they are. */
type Settings = Required<Pick<MemberPrefs, 'theme' | 'lang'>>

const here = (): Settings => ({ theme: getTheme(), lang: getLang() })

/** The settings a profile carries, or null when it has never saved any. */
export function savedSettings(prefs: MemberPrefs | undefined): MemberPrefs | null {
  return prefs && Object.keys(prefs).length > 0 ? prefs : null
}

/** What has to change on this device to match the profile. */
export function settingsToApply(saved: MemberPrefs, local: Settings): Partial<Settings> {
  const out: Partial<Settings> = {}
  if ((saved.theme === 'auto' || saved.theme === 'light' || saved.theme === 'dark') && saved.theme !== local.theme) out.theme = saved.theme
  if ((saved.lang === 'en' || saved.lang === 'de') && saved.lang !== local.lang) out.lang = saved.lang
  return out
}

const sameSettings = (a: MemberPrefs, b: MemberPrefs) => a.theme === b.theme && a.lang === b.lang

let running: (() => void) | null = null

/** Start keeping this device and the profile in step. Safe to call more than once. */
export function startSettingsSync(): () => void {
  if (running) return running

  /**
   * What the profile said the last time we looked, or what we last wrote to it.
   * Undefined until the profile has loaded, null when it has never saved settings.
   */
  let lastSeen: MemberPrefs | null | undefined
  /** Our own changes still on their way to the profile. */
  let writing = 0
  let applying = false

  const save = () => {
    if (applying || lastSeen === undefined) return
    const mine = here()
    if (lastSeen && sameSettings(mine, lastSeen)) return
    // Whatever else the profile carries travels along untouched.
    const next = { ...(lastSeen ?? {}), ...mine }
    lastSeen = next
    writing += 1
    void updateMyProfile({ prefs: next })
      .catch(() => {
        /* not logged in any more: nothing to save to */
      })
      .finally(() => {
        writing -= 1
      })
  }

  const profile = liveQuery(async () => {
    const id = await db.getMeta<ID>(META.memberId)
    return id ? db.members.get(id) : undefined
  }).subscribe((me) => {
    if (!me) return
    const saved = savedSettings(me.prefs)
    if (!saved) {
      // A brand-new profile: remember the choices made on this device.
      if (lastSeen === undefined) lastSeen = null
      return save()
    }
    // A choice made here a moment ago is still being written. What we see now may be
    // older than that choice; the next look at the profile will include it.
    if (writing > 0) return
    // Nothing new on the profile: do not let an old echo undo what was tapped here.
    if (lastSeen && sameSettings(saved, lastSeen)) return
    lastSeen = saved
    const changes = settingsToApply(saved, here())
    applying = true
    try {
      if (changes.theme) setTheme(changes.theme)
      if (changes.lang) setLang(changes.lang)
    } finally {
      applying = false
    }
  })

  const stops = [onThemeChange(save), onLangChange(save)]
  running = () => {
    profile.unsubscribe()
    for (const stop of stops) stop()
    running = null
  }
  return running
}
