// The frame around every screen: decides between the start, the lock and the app,
// switches tabs, and hosts the things that float above pages (toasts).

import { useEffect, useRef } from 'react'
import { boot, useSyncStatus } from '../data/app'
import { useMe } from '../data/hooks'
import { useReadyCount } from '../data/queries'
import { BoothScreen } from '../features/booth'
import { EnvelopeScreen } from '../features/envelope'
import { HomeScreen } from '../features/home'
import { LockScreen, useLocked } from '../features/lock'
import { Onboarding, PausedScreen, usePaused } from '../features/onboarding'
import { SettingsRoutes } from '../features/settings'
import { Loader, Screen, TabBar, Toaster, type TabId } from '../ui/components'
import { currentPath, matchPath, navigate, useRoute } from './router'
import { startSettingsSync } from './settingsSync'

export const TAB_PATHS: Record<TabId, string> = { home: '/', us: '/settings' }
const TAB_BY_PATH = Object.fromEntries(Object.entries(TAB_PATHS).map(([id, path]) => [path, id])) as Record<string, TabId>

export function Shell() {
  const route = useRoute()
  const me = useMe()
  const status = useSyncStatus()
  const paused = usePaused()
  const locked = useLocked()
  // From any tab: a number on the room says something opened for you.
  const ready = useReadyCount()
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
  let page
  if (tab === 'home') page = <HomeScreen />
  else if (path === '/booth') page = <BoothScreen />
  else if (envelope) page = <EnvelopeScreen key={envelope.id} id={envelope.id} />
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
      {tab && <TabBar active={tab} onSelect={(id) => navigate(TAB_PATHS[id], { replace: true })} onSeal={() => navigate('/booth')} badges={tab === 'home' ? {} : { home: ready }} />}
      <Toaster />
    </>
  )
}
