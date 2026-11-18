// Words for the news: what happened in the room, said in a line that names who and what
// kind of thing, and never what is in it.

import type { NewsKind } from '../../data/news'

const things = (n: number, one: string, many: string) => (n === 1 ? one : many.replace('%', String(n)))

export const newsCopy = {
  en: {
    title: 'News',
    /** The bell, read out. */
    bell: (n: number) => (n === 0 ? 'News' : `News, ${n} new`),
    lead: '"New" stays until you have looked at the thing itself. The marks for that are kept on this phone only.',
    fresh: 'New',
    earlier: 'Earlier',
    newTag: 'New',
    all: 'All news',
    empty: {
      title: 'Nothing yet',
      body: 'What happens in the room shows up here: an envelope that opens, a wish, an answer, something in common.',
    },
    nothingNew: 'Nothing new right now.',
    line: {
      ready: (name: string) => `An envelope from ${name} opened for you`,
      sealed: (name: string) => `${name} sealed something for you`,
      answered: (name: string) => `${name} answered your envelope`,
      wished: (name: string) => `${name} has a wish for you`,
      decided: (name: string) => `${name} answered your wish`,
      matched: (n: number, fresh: boolean) => (fresh ? things(n, '1 new thing in common on the list', '% new things in common on the list') : things(n, '1 thing in common on the list', '% things in common on the list')),
      about: (name: string, n: number) => things(n, `${name} showed you an answer`, `${name} showed you % answers`),
      shown: (name: string) => `${name} showed you a check-in`,
      idea: (name: string, n: number) => things(n, `${name} wrote something onto the list`, `${name} wrote % things onto the list`),
    },
    someone: 'Your partner',
    push: {
      title: 'While the app is closed',
      on: 'Notifications are on for this device. They say who, never what.',
      off: 'Notifications are off on this device. News waits here until you open the app.',
      unknown: 'A notification can tell you when something is new. It says who, never what.',
      action: 'Notifications',
    },
  },
  de: {
    title: 'Neues',
    bell: (n: number) => (n === 0 ? 'Neues' : `Neues, ${n} neu`),
    lead: '«Neu» bleibt, bis du dir die Sache selbst angesehen hast. Was du dir angesehen hast, merkt sich nur dieses Handy.',
    fresh: 'Neu',
    earlier: 'Davor',
    newTag: 'Neu',
    all: 'Alles Neue',
    empty: {
      title: 'Noch nichts',
      body: 'Was im Zimmer passiert, steht hier: ein Umschlag, der sich öffnet, ein Wunsch, eine Antwort, etwas Gemeinsames.',
    },
    nothingNew: 'Im Moment nichts Neues.',
    line: {
      ready: (name: string) => `Ein Umschlag von ${name} hat sich für dich geöffnet`,
      sealed: (name: string) => `${name} hat etwas für dich versiegelt`,
      answered: (name: string) => `${name} hat auf deinen Umschlag geantwortet`,
      wished: (name: string) => `${name} hat einen Wunsch für dich`,
      decided: (name: string) => `${name} hat auf deinen Wunsch geantwortet`,
      matched: (n: number, fresh: boolean) => (fresh ? things(n, '1 neue Gemeinsamkeit auf der Liste', '% neue Gemeinsamkeiten auf der Liste') : things(n, '1 Gemeinsamkeit auf der Liste', '% Gemeinsamkeiten auf der Liste')),
      about: (name: string, n: number) => things(n, `${name} hat dir eine Antwort gezeigt`, `${name} hat dir % Antworten gezeigt`),
      shown: (name: string) => `${name} hat dir einen Check-in gezeigt`,
      idea: (name: string, n: number) => things(n, `${name} hat etwas auf die Liste geschrieben`, `${name} hat % Sachen auf die Liste geschrieben`),
    },
    someone: 'Dein Schatz',
    push: {
      title: 'Wenn die App zu ist',
      on: 'Benachrichtigungen sind auf diesem Gerät an. Sie sagen, wer, nie was.',
      off: 'Benachrichtigungen sind auf diesem Gerät aus. Neues wartet hier, bis du die App öffnest.',
      unknown: 'Eine Benachrichtigung kann dir sagen, wenn es etwas Neues gibt. Sie sagt, wer, nie was.',
      action: 'Benachrichtigungen',
    },
  },
}

export type NewsCopy = (typeof newsCopy)['en']

/** One line of news in words. */
export function lineOf(c: NewsCopy, kind: NewsKind, name: string, count: number, fresh: boolean): string {
  switch (kind) {
    case 'matched':
      return c.line.matched(count, fresh)
    case 'about':
      return c.line.about(name, count)
    case 'idea':
      return c.line.idea(name, count)
    default:
      return c.line[kind](name)
  }
}
