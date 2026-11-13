// English copy. German lives in de.ts and must have exactly the same shape.

export const en = {
  brand: { name: 'WhisperUs', slogan: 'U tell. I listen.' },
  tabs: { home: 'Room', us: 'Us', seal: 'Step into the booth', nav: 'Main', withNews: (tab: string, count: number) => `${tab}, ${count} new` },
  actions: { save: 'Save', cancel: 'Cancel', done: 'Done' },
  /** What the five flames mean. */
  heat: ['A warm glow', 'Tingling', 'Hot', 'Very hot', 'On fire'],
  sync: {
    synced: 'All synced',
    syncing: 'Syncing',
    sending: (n: number) => (n === 1 ? '1 change waiting' : `${n} changes waiting`),
    refused: (n: number) => (n === 1 ? '1 change refused' : `${n} changes refused`),
    offline: 'Offline. Saved on this phone.',
    error: 'Sync hit a snag',
    lockedOut: 'This device is logged out',
    paused: 'Your seat is paused',
  },
  loading: 'One moment',
  common: {
    back: 'Back',
    close: 'Close',
    edit: 'Edit',
    delete: 'Delete',
    remove: 'Remove',
    add: 'Add',
    share: 'Share',
    copy: 'Copy',
    copied: 'Copied',
    saved: 'Saved',
    optional: 'optional',
    today: 'Today',
    tomorrow: 'Tomorrow',
    yesterday: 'Yesterday',
    somethingWrong: 'That did not work. Please try again.',
  },
}

export type Messages = typeof en
