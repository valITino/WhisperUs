# Decisions

Why things are the way they are. The foundation (sync, log-in, the admin, hosting,
notifications) comes from FoodwishUs, where it has run for a real couple since November
2026. Everything from "The seal" on is this app's own.

## What the app is for

One of the two finds it hard to say out loud what she felt, liked or wants, even when the
feeling is strong and good. Saying it face to face asks for three things at once: finding
the words, bearing the other one's eyes, and bearing the answer in the same second.

So the app takes those three apart.

- **Finding the words** happens alone, in the booth, with as much time as it takes, in
  writing or as a voice note, with a first line to borrow.
- **Being seen** is decided by the one who speaks: when it opens, which part of it, and
  for how long it stays.
- **The answer** comes later and has a shape that cannot hurt by accident: a tap, how it
  landed, and a why.

Everything else follows from that. The app is a place to practise being heard, not a game
with points. There are no streaks, no reminders to "seal something today", no counters
that could turn telling into a duty.

## 1. The seal

**Each layer has its own key.** An envelope has up to three layers: how it felt (`feel`),
the words (`words`) and the voice (`voice`). Each is encrypted on the author's phone with
its own AES-256-GCM key (Web Crypto). What goes to the cloud is `{ iv, box }`, unreadable
there. The keys travel separately, as rows of the `keys` table. That is what makes "open
the feelings now and the voice next week" possible, and it is why a seal is more than a
flag on a row.

**Why encrypt at all, in a room for two?** Because the person who owns the Supabase
project is one of the two, and can browse every table. A row that says `opens_at` and is
readable in the dashboard is not sealed, it is merely impolite to read. With the seal, the
dashboard shows locked bytes.

**Three ways to open, three different promises.**

| Mode | What leaves the phone at sealing | Who holds the key until then |
| --- | --- | --- |
| Right away (`now`) | sealed layers and their keys | the cloud hands them out at once |
| At a time (`at`) | sealed layers, and keys stamped with the time | the cloud. Row-level security shows a key to the other one only when `opens_at <= now()`, and `sync_pull` answers the same way |
| When I say (`hand`) | only the outside | nobody. Sealed layers and keys stay in a table on the author's phone (`vault`) that never syncs |

"When I say" is the default in the booth: the gentlest choice is the one where nothing can
happen by accident.

**Holding a part back.** In any mode, a layer the author does not release stays in the
vault. The other phone does not learn that it exists: no placeholder, no "one more part is
sealed". Otherwise a held-back voice note would become a question ("why don't you let me
hear it?").

**One opening.** With `keep = 'once'`, the moment the reader marks a layer as seen the
database removes the sealed layer, empties the key and marks the sound gone
(`private.burn_layers`). The reader's phone deletes its key and its copy. What is on
screen stays until the page is left. The author keeps theirs.

**Taking back.** The author soft-deletes the envelope. The database then empties
everything about it: sealed layers, keys, the sound, the line on the outside, the answer.
An empty shell remains so that both phones learn it is gone. What has been read cannot be
unread, and the app says so before it happens.

**The rules live in the database** (`supabase/migrations/0002_envelopes.sql`), not in the
app: only the author hands out keys, one per layer; a key that is out stays out and its
time cannot be moved once it has come; the other one may only add to "seen" and write the
answer. `supabase/tests/seal_test.sql` plays both people and a stranger against them. The
pretend cloud (`src/data/fake/cloudCore.ts`) follows the same rules, and
`tests/unit/supabaseContract.test.ts` holds the two together.

### What the seal is not

Said plainly, because a promise that is bigger than the truth is worse than none.

- **It is a seal, not a vault.** After a layer is released its key sits next to it in the
  cloud, so that the reader's other devices can open it too. From then on the owner of the
  project could read it. The protection is for the time *before* opening.
- **Timed keys are escrowed.** For "At a time" the key is in the `keys` table from the
  moment of sealing. The other one's phone cannot fetch it early. The project owner could
  read it in the dashboard, deliberately. For anything where that matters: "When I say".
- **The outside is plain.** The line on the envelope, the heat shown outside, what is
  hoped for, and the answer are ordinary columns. So are names and status lines.
- **Held layers exist once.** A layer in the vault is on one phone and nowhere else. If
  that phone is logged out, lost or wiped, the layer is gone and the envelope can never be
  opened. Logging out counts them and asks first.
- **The reader can keep what they read.** A screenshot, a second phone filming the first:
  no app can prevent that. "One opening" removes the copies the app controls.

A later version could encrypt with a key both phones share and the cloud never sees
(derived when the second person joins). That would close the "after release" gap at the
price of a harder story for a new device. It is in the backlog, not promised.

## 2. The why

The user's own words: the why matters wherever she chooses or rates, "because from there
on we can work it out step by step".

So the why is not a comment field at the bottom of a form. It is one primitive, used the
same way everywhere:

```ts
type Why = { chips: string[]; own: string[]; note: string | null }
```

- **Chips** are reasons from a small library per question (`src/features/why/library.ts`),
  saved by a stable id (`said.exposed`). Ids survive a change of language and of wording,
  so that a later Cockpit can count them over months.
- **Own words** are saved as written and never translated or tidied beyond trimming.
- **A note** is one or two sentences in free text.

**Two tones, never good and bad.** A reason is *warm* (what was easy to feel) or *tender*
(what was harder). The picker shows both side by side and says that both can be true of
the same moment. "It turned me on" and "Afraid you will see me differently" are not
opposites. A unit test guards the wording: no reason calls a feeling bad, wrong or normal.

**Never required.** A why can always be left empty. Asking is an offer.

Today the why appears twice: on what was said (`said`), and on the answer (`received`).
The match list, the cards and the afterglow will reuse the same picker with their own
libraries.

## 3. What the other one is asked for, and what is never shown

**"What do you hope for?"** Every envelope says it: *just take it in*, *tell me what it
did to you*, or *let us talk about it*. The reader sees it after breaking the seal. With
"just take it in" no answer form is pushed at them, only a quiet "Answer anyway". The
fear of the reaction is half of what makes speaking hard. Deciding beforehand what kind
of reaction is wanted takes that fear apart.

**The answer has a shape.** Taps ("I am here", "Thank you for telling me", "So hot", "Tell
me more"), how it landed, and a why with its own library, including tender reasons for the
reader ("I need a moment to take it in", "A sting of jealousy"). Honest answers need words
that are allowed.

**No read receipts.** "Seen" exists in the data because one-time envelopes need it and
because answering needs it. It is never shown to the author, and it triggers no
notification. Otherwise the author watches a clock ("opened an hour ago and still no
answer"), and the reader feels watched.

## 4. Notifications: who and when, never what

A notification is read on a lock screen, by anybody who picks the phone up. So it says
that something is there, who it is from and, for a timed envelope, when it opens:
"Mia sealed something. It opens tonight at 22:00." It never carries the line on the
envelope, a word from inside, the heat, or a hint at the subject. The push function does
not even ask the database for those columns, and never for a key
(`tests/unit/push.handler.test.ts` checks the queries).

Three kinds: **sealed** (something waits for you), **opened** (it is open for you now),
**answered** (your envelope was answered). Several layers opening together are one
"opened". A minute job in the database (`private.announce_due`) announces timed envelopes
when their time has come, although nobody touches a phone at that moment.

The same sentence for "when" is used in the notification and on the page
(`whenWords` in `supabase/functions/push/logic.ts`, read by `src/lib/when.ts`).

Setting it up needs nobody to copy a secret: see section 9.

## 5. The app lock

A six-digit code per device, asked for when the app starts and when it comes back from
being out of sight ("at once" by default, so that even the picture the phone keeps for its
app switcher shows the lock). Stored as a slow hash (PBKDF2-SHA256, 150,000 rounds) with a
salt, in the device's own storage. Five wrong tries, then a wait that doubles from 30
seconds up to 15 minutes, and the count survives closing the app.

- **It is not the PIN.** The PIN logs a device in and is checked by the cloud. The lock
  keeps a logged-in device shut and works offline. Each device has its own.
- **It is not encryption.** Somebody who can read the phone's storage with other tools is
  not stopped. The settings page says so in one sentence.
- **Forgotten code:** the only way past it is to log the device out. That needs a
  connection, and name and PIN to come back. The lock, the booth's draft and the device's
  settings go with it, so a forgotten code never locks the next login out.
- **Accepted:** somebody holding the locked phone can use "Forgot the code?" to log it
  out and thereby destroy envelopes that are held on it. They gain nothing by it, and the
  alternative (a phone that can never be recovered) is worse.
- **The lock screen says nothing.** No names, no room, not even the app's name.

Fingerprint unlock (WebAuthn) is in the backlog.

## 6. Discretion in small things

- The start screen has no demo and no "look around": this is not an app to show around.
- The installed app does not offer itself in other apps' share sheets, has no shortcuts
  and asks search engines to stay away (`noindex`).
- The Sync page lists refused changes by what kind of thing they were ("A new envelope"),
  never by content. "Copy details" holds counts and codes, no names, nothing from an
  envelope.
- The booth keeps a written draft for a day on the phone. A recording is never kept.
- The fallback notification, for a message the app cannot read, says "Something is
  waiting for you."
- Explicit text is never shipped with the app. Whatever cards or prompts the two of them
  want later, they write themselves.

## 7. Sync: Supabase plus a local-first layer of our own

The app reads everything from a database on the phone (IndexedDB through Dexie), so screens
open instantly and work offline. Every change is also queued in an outbox and sent to
Supabase when there is a connection. The other phone picks changes up through Supabase
Realtime, on app focus, on reconnect, on a one-minute timer, and at the moment a timed
envelope is due.

Sync is asynchronous: the two phones never need to be online at the same time
(`tests/e2e/sync.spec.ts` plays exactly that).

**Conflict rules.** Edits travel as patches holding only the changed fields. Same field:
the change that reaches the cloud last wins. Rows are never hard-deleted, only marked
`deleted_at`. For envelopes the database decides who may change which field, so the two
people cannot overwrite each other at all.

**Refused changes.** If the cloud rejects a change three times it is set aside (not
dropped) and the queue moves on. The Sync page lists them with "Try again" and "Discard".
If the rejection is because the device was logged out or its profile paused, nothing is
set aside: the device says so and keeps its unsent work.

**Voice notes** are sealed on the phone, queued, and uploaded as opaque bytes to a private
storage bucket (`media`, at most 10 MB, `application/octet-stream`). The file in the cloud
is not a playable recording (`tests/e2e/envelope.spec.ts` looks at its first bytes).
Recording is capped at five minutes at a low bitrate.

## 8. Sign-in: a name and a PIN, one admin, one room

Each device signs in anonymously (no email, no password). That invisible login is tied to
a person's profile, and one profile can have several devices.

- **First time:** the first person opens the room; the second joins with a 10-character
  invite code, shown as a QR code or link. Both choose a six-digit PIN.
- **Any other device:** name and PIN.
- **Forgotten PIN:** the admin makes a one-time restore code.
- **Everything lost:** the owner of the Supabase project runs
  `select private.rescue_code('Name')` in the SQL editor.

Wrong tries are counted per typed name: five tries, then a pause of 15 minutes that
doubles up to a day. A wrong PIN and an unknown name give the same answer. PINs are stored
as bcrypt hashes in a schema the API cannot see.

**One admin.** Whoever opens the room is its admin: invites, restore codes, pausing and
logging out the partner's seat. **The admin opens no envelope.** None of the admin's tools
touch `envelopes`, `keys` or `media`, and the People page says so. Who should open the
room is for the two of them to decide. It can be argued either way: she, so that the one
with more to protect holds the keys to the room; he, so that she never has to deal with
the technical side.

**No roles.** FoodwishUs had a cook and an eater. Here there are two people. Either can
seal, either can answer. `tests/e2e/pairing.spec.ts` has him open the room and the other
specs have her do it, so nothing depends on who went first.

**One room, two seats.** The repository and the publishable key are public, so anyone
could create an anonymous login against the project. That login can do nothing:
row-level security limits every row and file to room members, a room can be created only
while none exists, and joining needs a valid code. `supabase/tests/security_test.sql`
plays a stranger against the database.

## 9. Hosting and the cloud

**GitHub Pages, public repository.** Free hosting needs a public repository. Only code is
public. The address of the cloud and its publishable key are in the build by design: what
protects the room is the database's rules and the seal, never a hidden address.

**A build without a cloud says so.** Until the room's own Supabase project exists,
`.env.production` is empty and the published app shows one page ("Not connected yet").
It never falls back to another project. A unit test guards the file: one cloud completely
or none at all, and never a secret key.

**Notifications without copied secrets.** The shared secret between the database triggers
and the push function, and the VAPID key pair, live in a table only the service role can
read. The function makes the key pair itself the first time it is asked. The owner runs
two SQL statements and never sees or copies a key.

**Keeping a free project awake.** Free projects pause after a week without activity. The
database pings itself (`private.keepalive_setup`), and a GitHub workflow pings every two
days, reading the address from `.env.production` and doing nothing while it is empty.

**If Supabase ever goes away.** The app talks to the cloud through one interface
(`src/data/backend.ts`) with two implementations, the real one and the pretend one. A
third could replace Supabase without touching a screen.

## 10. Design: letters after dark

The subject is correspondence: something written, sealed, handed over, opened. So the
interface is made of paper, ink, wax and candlelight, and of nothing that looks like a
dashboard.

- **Colour.** Lilac paper and aubergine ink by day; aubergine night after dark. One amber
  "candle" for the one main action on a screen. Wax red only for seals (the seal on the
  bar, the lock, the envelope) and for the light of a running recording. Never for
  errors or decoration.
- **Type.** Bodoni Moda for titles (the high contrast of engraved stationery), Figtree
  for everything to read and tap, La Belle Aurore for handwriting, used only on envelopes
  and in the words somebody wrote.
- **The bar** is the back of an envelope: the flap's point in the middle, and where a
  letter's seal would be sits the one thing the app is for.
- **Motion answers actions.** The seal breaks when it is tapped. Nothing moves to greet
  you.
- **Words.** Sentence case, plain verbs, both languages, Swiss spelling in German. A
  button says what happens and the toast afterwards uses the same word. Nothing rates a
  feeling.

`tests/e2e/a11y.spec.ts` walks every screen at 360 px in both languages: every control has
a name, nothing scrolls sideways, one h1 per screen.

## 11. Small dependencies on purpose

React, Dexie, supabase-js, Motion, date-fns, a QR generator, three fonts. Encryption is
the browser's own Web Crypto. Recording is the browser's MediaRecorder. No UI kit, no
state library, no crypto library. Fewer things that can change under a private app that
should still open in five years.

## Limits to know

- **Android and Chrome first.** Recording, installing and notifications are tested there.
  iPhone would need its own look at recording formats and at notifications.
- **Voice notes travel whole.** A five-minute note is a few megabytes and needs a
  connection that holds for the upload. It is queued and retried.
- **The first load is one piece of JavaScript** (about 290 kB compressed). After the first
  visit the app starts from the phone.
- **A paused or logged-out author** cannot release held layers. Nothing is lost while the
  phone keeps its data.
- **Clocks.** A timed envelope opens by the cloud's clock, not the phone's. A phone with a
  wrong clock shows a wrong countdown and still opens at the right moment.
