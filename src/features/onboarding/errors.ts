// Turns what the cloud said into a sentence a person can act on: what happened and
// what to do next. Pure, so every code is covered by a unit test.

import { isBackendError } from '../../data/backend'

export const errorCopy = {
  en: {
    network: 'No connection to the cloud right now. Check your internet and try again.',
    anonymousDisabled:
      'The cloud does not allow device logins yet. In Supabase, open Authentication, then Sign In / Providers, and turn on "Allow anonymous sign-ins". Then try again.',
    setup: 'The cloud is not set up yet. Finish the Supabase setup from the README, then try again.',
    auth: 'This device could not reach its login in the cloud. Close the app, open it again and retry.',
    inviteInvalid: 'That code did not work. It may be mistyped, already used or older than 48 hours. Ask for a fresh one.',
    roomFull: 'This room already has two people. If you are one of them, go back in with your name and PIN.',
    alreadyInRoom: 'This device is already logged in to a room. Close the app, open it again and you should be in.',
    roomExists: 'The room is already open. Join with a code from your partner, or go back in with your name and PIN.',
    memberNotFound: 'That profile is no longer in the room. Ask the admin for a fresh code.',
    notInRoom: 'This device is not logged in any more. Log in again, then retry.',
    nameTaken: 'That name is already taken in this room, and names are how you two log in. Pick another one. A nickname works too.',
    nameInvalid: 'That name does not work. Use between 1 and 40 characters.',
    pinInvalid: 'A PIN has exactly six digits. Check it and try again.',
    pinTooSimple: 'That PIN is too easy to guess. Skip rows like 123456 and repeats like 111111 or 121212, then try again.',
    pinWrong: (triesLeft: number | undefined) => {
      if (triesLeft === undefined) return 'Name or PIN is not right. Check both and try again.'
      if (triesLeft === 1) return 'Name or PIN is not right. One more try, then this name takes a break.'
      return `Name or PIN is not right. ${triesLeft} tries left, then this name takes a break.`
    },
    pinLocked: (when: string | undefined) =>
      when
        ? `Too many wrong tries. This name is paused until ${when}. Try again then, or ask the room's admin to let you back in.`
        : "Too many wrong tries. This name is paused for a while. Try again later, or ask the room's admin to let you back in.",
    accountPaused: "Your seat in this room is paused. The room's admin can switch it on again. Nothing is lost.",
    adminOnly: "Only the room's admin can do that. Ask them to do it on their device.",
    notYourself: "That only works for your partner's seat, not for your own. Pick your partner and try again.",
    rejected: (code: string) => `The cloud said no (${code}). Wait a moment and try again.`,
    unknown: 'That did not work. Please try again.',
  },
  de: {
    network: 'Gerade keine Verbindung zur Cloud. Prüf dein Internet und versuch es nochmal.',
    anonymousDisabled:
      'Die Cloud erlaubt noch keine Geräte-Logins. Öffne in Supabase Authentication, dann Sign In / Providers, und schalte "Allow anonymous sign-ins" ein. Dann versuch es nochmal.',
    setup: 'Die Cloud ist noch nicht eingerichtet. Schliess das Supabase-Setup aus dem README ab und versuch es dann nochmal.',
    auth: 'Dieses Gerät hat sein Login in der Cloud nicht erreicht. Schliess die App, öffne sie wieder und versuch es nochmal.',
    inviteInvalid: 'Der Code hat nicht funktioniert. Vielleicht vertippt, schon benutzt oder älter als 48 Stunden. Lass dir einen frischen geben.',
    roomFull: 'In diesem Zimmer sind schon zwei. Wenn du eins davon bist, komm mit Name und PIN zurück.',
    alreadyInRoom: 'Dieses Gerät ist schon in einem Zimmer angemeldet. Schliess die App, öffne sie wieder, dann solltest du drin sein.',
    roomExists: 'Das Zimmer ist schon offen. Komm mit einem Code von deinem Schatz dazu oder mit Name und PIN zurück.',
    memberNotFound: 'Dieses Profil ist nicht mehr im Zimmer. Lass dir vom Admin einen frischen Code geben.',
    notInRoom: 'Dieses Gerät ist nicht mehr angemeldet. Melde dich neu an und versuch es dann nochmal.',
    nameTaken: 'Diesen Namen gibt es in diesem Zimmer schon, und mit dem Namen meldet ihr euch an. Nimm einen anderen. Ein Spitzname geht auch.',
    nameInvalid: 'Dieser Name geht nicht. Nimm zwischen 1 und 40 Zeichen.',
    pinInvalid: 'Ein PIN hat genau sechs Ziffern. Prüf ihn und versuch es nochmal.',
    pinTooSimple: 'Dieser PIN ist zu leicht zu erraten. Lass Reihen wie 123456 und Wiederholungen wie 111111 oder 121212 weg und versuch es nochmal.',
    pinWrong: (triesLeft: number | undefined) => {
      if (triesLeft === undefined) return 'Name oder PIN stimmt nicht. Prüf beides und versuch es nochmal.'
      if (triesLeft === 1) return 'Name oder PIN stimmt nicht. Noch ein Versuch, dann macht dieser Name Pause.'
      return `Name oder PIN stimmt nicht. Noch ${triesLeft} Versuche, dann macht dieser Name Pause.`
    },
    pinLocked: (when: string | undefined) =>
      when
        ? `Zu viele falsche Versuche. Dieser Name ist bis ${when} pausiert. Versuch es dann wieder oder bitte den Admin des Zimmers, dich wieder reinzulassen.`
        : 'Zu viele falsche Versuche. Dieser Name ist eine Weile pausiert. Versuch es später wieder oder bitte den Admin des Zimmers, dich wieder reinzulassen.',
    accountPaused: 'Dein Platz in diesem Zimmer ist pausiert. Der Admin des Zimmers kann ihn wieder einschalten. Verloren ist nichts.',
    adminOnly: 'Das kann nur der Admin des Zimmers. Bitte ihn oder sie, es auf dem eigenen Gerät zu tun.',
    notYourself: 'Das geht nur für den Platz deines Schatzes, nicht für deinen eigenen. Wähl deinen Schatz und versuch es nochmal.',
    rejected: (code: string) => `Die Cloud hat Nein gesagt (${code}). Warte kurz und versuch es nochmal.`,
    unknown: 'Das hat nicht geklappt. Bitte nochmal versuchen.',
  },
}

export type ErrorCopy = typeof errorCopy.en

/**
 * A friendly sentence for anything that can go wrong while opening, joining, logging in
 * or managing the room.
 * @param when Turns a moment into words ("14:32", "tomorrow, 09:15") for "paused until".
 */
export function explain(error: unknown, c: ErrorCopy, when?: (moment: string) => string): string {
  if (!isBackendError(error)) return c.unknown
  if (error.kind === 'network') return c.network
  if (error.kind === 'setup') return error.code === 'anonymous_disabled' ? c.anonymousDisabled : c.setup
  if (error.code === 'anonymous_disabled') return c.anonymousDisabled
  if (error.kind === 'auth') return c.auth
  switch (error.code) {
    case 'invite_invalid':
      return c.inviteInvalid
    case 'room_full':
      return c.roomFull
    case 'already_in_room':
      return c.alreadyInRoom
    case 'room_already_exists':
      return c.roomExists
    case 'member_not_found':
      return c.memberNotFound
    case 'not_in_room':
      return c.notInRoom
    case 'name_taken':
      return c.nameTaken
    case 'name_invalid':
      return c.nameInvalid
    case 'pin_invalid':
      return c.pinInvalid
    case 'pin_too_simple':
      return c.pinTooSimple
    case 'pin_wrong':
      return c.pinWrong(error.details.triesLeft)
    case 'pin_locked':
      return c.pinLocked(error.details.retryAt && when ? when(error.details.retryAt) : undefined)
    case 'account_paused':
      return c.accountPaused
    case 'admin_only':
      return c.adminOnly
    case 'not_yourself':
      return c.notYourself
    default:
      return c.rejected(error.code)
  }
}
