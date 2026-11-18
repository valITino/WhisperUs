// Words for the first look: what a person is asked right after signing up.

export const helloCopy = {
  en: {
    title: 'A first look at yourself',
    step: (n: number, of: number) => `${n} of ${of}`,
    intro: {
      title: 'Before you step in',
      body: 'A few questions about you, then the list, then when you would like to be asked how you are. It takes about three minutes.',
      points: ['Your answers are yours. Nobody sees one unless you show it.', 'There is no good answer and no bad one, only where you stand today.', 'Leave out whatever you like. You can come back to all of it.'],
      begin: 'Begin',
      later: 'Later',
    },
    next: 'Next',
    list: {
      title: 'What draws you',
      body: 'Tap what catches your eye and say what you think of it. A handful is plenty for a start: the whole list waits under Wishes.',
    },
    times: {
      title: 'When shall the app ask how you are?',
      body: 'Twice a day, a minute each time. What you note feeds your cockpit, and stays with you unless you show it.',
      done: 'Done',
    },
    welcome: 'Welcome',
    later: 'It waits for you on the room',
    card: {
      title: 'A first look at yourself',
      body: 'A few questions about you, only for you at first. About three minutes.',
      action: 'Begin',
      decline: 'No, thank you',
      declined: 'It is gone from the room. The questions stay on your profile.',
    },
  },
  de: {
    title: 'Ein erster Blick auf dich',
    step: (n: number, of: number) => `${n} von ${of}`,
    intro: {
      title: 'Bevor du eintrittst',
      body: 'Ein paar Fragen zu dir, dann die Liste, dann wann du gefragt werden möchtest, wie es dir geht. Es dauert etwa drei Minuten.',
      points: ['Deine Antworten gehören dir. Niemand sieht eine, ausser du zeigst sie.', 'Es gibt keine gute und keine schlechte Antwort, nur wo du heute stehst.', 'Lass weg, was du magst. Du kannst zu allem zurückkommen.'],
      begin: 'Anfangen',
      later: 'Später',
    },
    next: 'Weiter',
    list: {
      title: 'Was dich anzieht',
      body: 'Tipp an, was dir ins Auge fällt, und sag, was du darüber denkst. Eine Handvoll genügt für den Anfang: Die ganze Liste wartet unter Wünsche.',
    },
    times: {
      title: 'Wann soll die App fragen, wie es dir geht?',
      body: 'Zweimal am Tag, je eine Minute. Was du notierst, speist dein Cockpit und bleibt bei dir, ausser du zeigst es.',
      done: 'Fertig',
    },
    welcome: 'Willkommen',
    later: 'Er wartet im Zimmer auf dich',
    card: {
      title: 'Ein erster Blick auf dich',
      body: 'Ein paar Fragen zu dir, zuerst nur für dich. Etwa drei Minuten.',
      action: 'Anfangen',
      decline: 'Nein, danke',
      declined: 'Er ist aus dem Zimmer verschwunden. Die Fragen bleiben in deinem Profil.',
    },
  },
}
