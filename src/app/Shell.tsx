// The frame around every screen: decides between the start, the lock and the app,
// switches tabs, and hosts the things that float above pages (toasts).

import { useEffect, useRef } from 'react'
import { boot, useSyncStatus } from '../data/app'
import { useMe } from '../data/hooks'
import { useNews } from '../data/queries'
import { AboutScreen } from '../features/about/AboutScreen'
import { BoothScreen } from '../features/booth'
import { CheckinScreen } from '../features/checkin/CheckinScreen'
import { CockpitScreen } from '../features/cockpit/CockpitScreen'
import { EnvelopeScreen } from '../features/envelope'
import { HelloScreen } from '../features/hello/HelloScreen'
import { HomeScreen } from '../features/home'
import { ListScreen } from '../features/list/ListScreen'
import { LockScreen, useLocked } from '../features/lock'
import { NewsScreen } from '../features/news/NewsScreen'
import { Onboarding, PausedScreen, usePaused } from '../features/onboarding'
import { ProfileScreen } from '../features/profile/ProfileScreen'
import { SettingsRoutes } from '../features/settings'
import { WishFormScreen } from '../features/wishes/WishForm'
import { WishScreen } from '../features/wishes/WishScreen'
import { WishesScreen } from '../features/wishes/WishesScreen'
import { Loader, Screen, TabBar, Toaster, type TabId } from '../ui/components'
import { currentPath, matchPath, navigate, useRoute } from './router'
import { startSettingsSync } from './settingsSync'

export const TAB_PATHS: Record<TabId, string> = { home: '/', wishes: '/wishes', cockpit: '/cockpit', us: '/settings' }
/** The pages that show the bar. The cockpit has two, under one tab. */
const TAB_BY_PATH: Record<string, TabId> = { ...(Object.fromEntries(Object.entries(TAB_PATHS).map(([id, path]) => [path, id])) as Record<string, TabId>), '/cockpit/us': 'cockpit' }

export function Shell() {
  const route = useRoute()
  const me = useMe()
  const status = useSyncStatus()
  const paused = usePaused()
  const locked = useLocked()
  // From any tab: a number on the room (something opened, an answer, something the other
  // one showed) and one on the wishes (a wish, an answer, something new on the list).
  // Together they are the number on the bell.
  const news = useNews()
  const { path } = route

  useEffect(() => {
    void boot()
    // Language and light follow the person to every device.
    startSettingsSync()
  }, [])

  const shown = useRef(path)
  useEffect(() => {
    window.scrollTo(0, 0)
    if (shown.current === path) return
    shown.current = path
    // A new page: whatever was tapped is gone, and focus with it. Hand it to the page's
    // title, so a screen reader says where we are and the keyboard starts at the top.
    const frame = requestAnimationFrame(() => {
      if (document.activeElement && document.activeElement !== document.body) return
      const title = document.querySelector('h1')
      if (!title) return
      title.setAttribute('tabindex', '-1')
      title.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [path])

  if (me === undefined) {
    return (
      <Screen className="grid place-items-center">
        <Loader />
      </Screen>
    )
  }

  // The lock comes before everything a logged-in device could show, the "logged out"
  // screen included: that one names the person who was logged in.
  if (me !== null && locked) return <LockScreen />

  const lockedOut = status.state === 'locked-out'
  if (me === null || lockedOut) {
    return (
      <>
        <Onboarding route={route} lockedOut={lockedOut} />
        <Toaster />
      </>
    )
  }

  // The admin has paused this seat: nothing can be read or changed until it is switched on again.
  if (paused) {
    return (
      <>
        <PausedScreen />
        <Toaster />
      </>
    )
  }

  const tab = TAB_BY_PATH[path]
  const envelope = matchPath('/envelope/:id', path)
  const wish = matchPath('/wishes/:id', path)
  const wishEdit = matchPath('/wishes/:id/edit', path)
  let page
  if (tab === 'home') page = <HomeScreen />
  else if (tab === 'wishes') page = <WishesScreen />
  else if (tab === 'cockpit') page = <CockpitScreen view={path === '/cockpit/us' ? 'ours' : 'mine'} />
  else if (path === '/booth') page = <BoothScreen />
  else if (envelope) page = <EnvelopeScreen key={envelope.id} id={envelope.id} />
  else if (path === '/hello') page = <HelloScreen />
  else if (path === '/checkin') page = <CheckinScreen />
  else if (path === '/about') page = <AboutScreen />
  else if (path === '/list') page = <ListScreen />
  else if (path === '/news') page = <NewsScreen />
  else if (path === '/profile') page = <ProfileScreen key="mine" side="mine" />
  else if (path === '/profile/partner') page = <ProfileScreen key="theirs" side="theirs" />
  else if (path === '/wishes/new') page = <WishFormScreen />
  else if (wishEdit) page = <WishFormScreen key={wishEdit.id} id={wishEdit.id} />
  else if (wish) page = <WishScreen key={wish.id} id={wish.id} />
  else if (path.startsWith('/settings')) page = <SettingsRoutes route={route} />
  else page = null

  // An address that leads nowhere (an old link, a start-screen path after logging in) goes home.
  if (page === null) {
    const lost = path
    // Only if nobody has navigated in the meantime (the start screens do, right after logging in).
    queueMicrotask(() => {
      if (currentPath() === lost) navigate('/', { replace: true })
    })
    page = <HomeScreen />
  }

  return (
    <>
      {page}
      {tab && <TabBar active={tab} onSelect={(id) => navigate(TAB_PATHS[id], { replace: true })} onSeal={() => navigate('/booth')} badges={{ ...(tab === 'home' ? {} : { home: news?.byTab.home ?? 0 }), ...(tab === 'wishes' ? {} : { wishes: news?.byTab.wishes ?? 0 }) }} />}
      <Toaster />
    </>
  )
}
