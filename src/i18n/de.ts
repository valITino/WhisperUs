// German copy (Swiss spelling: no ß). Must have exactly the same shape as en.ts.

import type { Messages } from './en'

export const de: Messages = {
  brand: { name: 'WhisperUs', slogan: 'U tell. I listen.' },
  tabs: { home: 'Zimmer', us: 'Wir', seal: 'In die Kabine treten', nav: 'Hauptnavigation', withNews: (tab: string, count: number) => `${tab}, ${count} neu` },
  actions: { save: 'Speichern', cancel: 'Abbrechen', done: 'Fertig' },
  heat: ['Ein warmes Glimmen', 'Es kribbelt', 'Heiss', 'Sehr heiss', 'In Flammen'],
  sync: {
    synced: 'Alles synchron',
    syncing: 'Synchronisiert',
    sending: (n: number) => (n === 1 ? '1 Änderung wartet' : `${n} Änderungen warten`),
    refused: (n: number) => (n === 1 ? '1 Änderung abgelehnt' : `${n} Änderungen abgelehnt`),
    offline: 'Offline. Auf diesem Handy gespeichert.',
    error: 'Beim Synchronisieren hakt es',
    lockedOut: 'Dieses Gerät ist abgemeldet',
    paused: 'Dein Platz ist pausiert',
  },
  loading: 'Einen Moment',
  common: {
    back: 'Zurück',
    close: 'Schliessen',
    edit: 'Bearbeiten',
    delete: 'Löschen',
    remove: 'Entfernen',
    add: 'Hinzufügen',
    share: 'Teilen',
    copy: 'Kopieren',
    copied: 'Kopiert',
    saved: 'Gespeichert',
    optional: 'freiwillig',
    today: 'Heute',
    tomorrow: 'Morgen',
    yesterday: 'Gestern',
    somethingWrong: 'Das hat nicht geklappt. Bitte versuch es noch einmal.',
  },
}
