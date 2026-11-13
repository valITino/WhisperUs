import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { wipeIfAsked } from './data/wipe'
import { watchVisibility } from './features/lock'
import { getLang } from './i18n'
import { watchInstall } from './pwa/install'
import { startNotifications } from './pwa/notifications'
import { startServiceWorker } from './pwa/register'
import { announceUpdate } from './pwa/update'
import { UpdateNote } from './pwa/UpdateNote'
import { initTheme } from './ui/theme'
import './ui/styles.css'

initTheme()
// A device with an app lock locks again when the app goes out of sight.
watchVisibility()
// Chrome's offer to install the app comes once, early. Settings shows it later.
watchInstall()
// Offline start, updates and notifications. Production builds only: the dev server and
// the end-to-end tests against it run without a service worker.
if (import.meta.env.PROD) startServiceWorker()
// Tells the cloud again where this device can be reached, if notifications are on here.
startNotifications()

// Development only: lets end-to-end tests set up data and wait for exact moments.
//   await page.evaluate(() => window.__whisperus.sync.sync())
if (import.meta.env.DEV) {
  void Promise.all([import('./data/app'), import('./data/do'), import('./app/router')]).then(([app, actions, router]) => {
    Object.assign(window, { __whisperus: { db: app.db, store: app.store, sync: app.sync, backend: app.backend, push: app.push, actions, announceUpdate, navigate: router.navigate } })
  })
}
document.documentElement.lang = getLang()

// A device that was logged out drops its old copy of the room before any screen reads from it.
void wipeIfAsked().then(() => {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <StrictMode>
      <App />
      <UpdateNote />
    </StrictMode>,
  )
})
