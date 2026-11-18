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
that could turn telling into a duty. (The one reminder the app knows is the check-in's,
and it is the person's own alarm: off until they switch it on, at the minutes they pick,
for themselves alone. Section 12.)

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

The why appears in seven places, each with a library of its own: on what was said
(`said`) and on the answer to it (`received`), on an answer about oneself (`about`), on a
check-in (`checkin`: what helped, what got in the way), on an answer on the list
(`leaning`), on a wish (`wish`) and on the answer to a wish (`decision`). The cards and
the afterglow will reuse the same picker.

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

Seven kinds. About envelopes: **sealed** (something waits for you), **opened** (it is open
for you now), **answered** (your envelope was answered). Several layers opening together
are one "opened". A minute job in the database (`private.announce_due`) announces timed
envelopes when their time has come, although nobody touches a phone at that moment.
Since `0004_closer.sql`: **wished** ("Mia has a wish for you."), **decided** ("Leo answered
your wish.", never what he decided: a no is not for a lock screen), **matched** ("You and
Leo have something new in common.", never what, and not again within ten minutes: an
evening with the list must not make the other phone buzz twenty times), and **checkin**
("How are you right now?"), which goes to the one who asked for it and to nobody else.
The function asks the database only for who and when of a wish, never for its words, its
why or the decision, and for nothing at all from the list.

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
touch `envelopes`, `keys` or `media`, and the People page says so. Who opens the room
can be argued either way: she, so that the one with more to protect holds the keys to the
room; he, so that she never has to deal with the technical side. They chose the second:
he opens it, and he owns the cloud project as well.

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

**A build without a cloud says so.** A build made with no address in `.env.production`
shows one page ("Not connected yet") instead of a start screen whose buttons fail. It
never falls back to another project. A unit test guards the file: one cloud completely
or none at all, and never a secret key.

**The live database is checked against the files.** The migrations reached the live
project through a connector, in parts. So that this proves nothing by itself, a query
(`supabase/tests/local/digest.sql`) fingerprints every function, right, policy, trigger,
index and check; the same ten lines on the live project and on a local database built
from the files mean the two are the same, statement for statement.

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
  letter's seal would be sits the one thing the app is for. Two places on each side of
  it: the room and wishes, the cockpit and "Us".
- **The cockpit is a notebook.** Thin ink columns on a hairline, one colour, a few
  sentences. No tiles, no gauges, no totals to reach. Every column can be read out in
  words (a tap, or the arrow keys), and a screen reader gets the list.
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

## 12. Closer: what is noted, what is shown, what is counted

The owner asked for five things with "ratings" on all of them: questions at sign-up, a
cockpit for each and one for both, kinks to pick, a check-in twice a day, and wishes that
the other one decides on. They are built (PLAN.md, M3). This section says how they were
made to fit the one question every change is measured against: does it make telling
easier and being heard safer?

**A rating describes, it never grades.** Every scale in the app runs between two poles
that are both all right: "Slow today, please" to "Come closer", "Once we are close" to
"Out of nowhere", "A passing thought" to "I long for it". There is no good end and no
bad end, no points, no result. Tapping the chosen step takes it away again: not answering
is an answer. "Nothing rates a feeling" still holds; a person says where they stand.

**The why is offered everywhere and required nowhere, also on a decision.** The request
was "always with a reason". The picker is always there, one tap away, and it can always
be left empty. A why somebody had to give is an excuse, and a no that has to be justified
is harder to say kindly. The research agrees (below).

**Two places, one rule.** What a person notes about themselves (a check-in, an answer
about themselves, an answer on the list) is written whole to the `diary`, a table that
never leaves the phone. Only the parts its author opens are written to a row that syncs
(`notes`, `leanings`), under the same id. Nothing is ever shown on anybody's behalf, and
"only me" is the answer that is already chosen.

Why not simply keep everything in the cloud behind row-level security? For the same
reason the seal exists: one of the two owns the project and can browse every table. A
check-in that says how often she thought about sex today must not be one click away from
him. So it is not there at all.

**The list.** Each answers alone: "I would like that", "I am curious", "only in my head",
"not for me", with how strong the pull is and why.
- Something shows for both only where both answered openly (one of the first three).
  The database enforces it: the other one's row can be read only while one has such a
  row for the same item oneself (`private.i_lean`), and `sync_pull` hands it over at the
  moment one's own answer arrives.
- **A "not for me" never leaves the phone.** It has no row in the cloud, and the table
  would not take one. So "he never sees a no" is true as written, also for whoever owns
  the project.
- "Only in my head" is its own answer because a fantasy somebody likes to imagine is not
  a wish to do it, and saying which it is makes saying it easier.
- An answer can be **kept to oneself**: it stays in the diary and meets nothing. This is
  the per-item choice the match rule would otherwise take away.
- The why of an answer travels only if its author says so, and is then read only where
  the two meet.
- **What ships with the app** are twelve groups of plainly named items, the kind of word
  a mainstream platform shows as a tag. Nothing explicit, in keeping with section 6.
  Whatever the two want beyond it they write onto the list themselves, and it behaves
  like every other item.

**Wishes are said, not sealed.** A wish is read as soon as it is sent, like an answer:
it is addressed to the one person who could otherwise only read it in the dashboard, so
sealing it would protect nothing. Its author writes the wish, the other one writes the
answer and nothing else. What was answered stays as it was answered (a yes must not end
up under other words); it can still be taken back, and the cloud then forgets its words,
its why and the answer. A "not now" can become a "yes". A wish can also be "a fantasy
that may stay one", which asks for no decision. Every answer can carry a warm line ("I
like that you asked"), because a kind no does a couple no harm and a cold one does.

**The check-in** asks about the day and the person, never about how an encounter went,
and never right after one. One per half of a day (the day turns at four in the morning),
so checking in again changes it instead of adding to a tally. What somebody shows of
today stands on the other one's room: "Slow today, please" is the mood weather the plan
had for later.

**The reminder is one's own alarm.** Off until switched on, at two minutes the person
picks, sent to their devices only, and it says "How are you right now?" and nothing else.
The cloud cannot know whether they have checked in already (what they note is not
there), so it reminds either way and never follows up.

**The cockpit counts with care,** because counting can hurt what it counts.
- A day without a check-in is simply not drawn. Nothing is ever "missed", and there are
  no streaks.
- No targets, no averages against anybody, nothing that reads as a score for a person.
- Tendencies ("stronger later in the day", "what often goes with more desire") appear
  only once there is enough to go on, and are worded as companions, not causes.
- **Nobody's no is ever counted.** The page for two counts wishes said and yeses.
- The page for two is drawn only from what each chose to show, in the same order on both
  phones, so both see the same page. Where both showed desire, the two rows stand under
  the sentence "Two rhythms, and neither is the right one".

**Where this comes from.** The questions and the check-in's "what helped, what got in the
way" follow the dual control model (Bancroft and Janssen; Nagoski's worksheets) and
Basson's desire that follows closeness instead of preceding it. That telling likes and
dislikes raises satisfaction through feeling understood: MacNeil and Byers. That a
reassuring no does no harm and a reluctant yes does: studies on turning a partner down
kindly (read here in summaries, not in full). The cautions
are from Etkin (measuring an enjoyable thing lowers the joy in it, unless it is framed as
learning), Loewenstein (couples told to raise their frequency were less happy), Lupton
and the criticism of apps that keep a report card of sex, and from studies of mood
trackers (logging feels like a burden when nothing helps to read the data). Answer
options are close to the yes / maybe / fantasy / no of the Scarleteen inventory, and the
match rule is the one of Spicer and similar apps.

### What closer is not

- **The diary exists once.** It is on the phone it was noted on. Logging that phone out,
  or losing it, loses it; logging out counts the entries and asks first. Another device
  of the same person has only what they showed.
- **Shown is plain.** A shown part of a check-in, an open answer on the list, something
  written onto the list, a wish and its answer are ordinary rows. Row-level security
  keeps them inside the room and keeps an unmet answer off the other phone. Whoever owns
  the project could read them in the dashboard, deliberately. What must not be readable
  by anybody is never sent.
- **Saying yes to everything shows the other one's open answers.** That is in the nature
  of such a list. It never shows a "not for me" or anything kept quiet, and it cannot
  tell either of them from silence.
- **The reminder needs notifications** to be on for the device. It is sent by a job in
  the database that looks once a minute, so it arrives within that minute, not on the
  second, and a minute the job misses is a reminder that does not come.

## 13. The way through: news, and a profile to look at

Added on 18 November 2026, after the first days of use. Three things were missing.
Nothing said what was new, except a number on a tab. A tap on a picture led to a form.
And what the other one had shown about themselves stood at the foot of a page about
oneself, three taps from the room.

### The news

One list, read in three places: the bell on the room, the lines under it, and the News
page (`src/data/news.ts`, pure and tested; `src/features/news`). It is the in-app side of
the notifications and follows their rule (section 4). A line says who, what kind of thing
and when, and leads to the thing itself. It never carries what is in it: not a wish's
words, not what was decided, not the line on an envelope.

- **No read receipts here either.** There is no line for "the other one opened what you
  sealed" or "read your wish". The envelope's row does carry the moment a layer was first
  opened (the cloud needs it to burn a layer after one opening), and the news leave it
  alone. An answer is news. Reading is not.
- **"New" lasts until the thing itself was looked at**, wherever one gets to it from.
  Opening the News page marks nothing, so a line cannot be "read" without the wish, the
  answer or the list having been seen. One mark serves the bell, the tabs and the page.
  The marks are kept on the phone only: what somebody has looked at is about that screen,
  not about the two of them.
- **Counted, and listed without a count.** Counted: an envelope open for me, an answer to
  mine, a wish for me, an answer to my wish, new things in common, answers the other one
  showed about themselves, things they wrote onto the list. Listed without a count: an
  envelope that still waits (there is nothing to do yet) and a check-in with something
  shown (it stands on the room already, and twice a day would turn the bell from a signal
  into a habit).
- **The numbers on the tabs are the same list, by place:** under "Wishes" what lives
  there (wishes, the list), on "Room" the rest. Together they are the number on the bell.
- What has been looked at stays listed for thirty days, twenty lines at most. The list
  is made from the rows on the phone each time; nothing new is stored or sent for it.

### A profile for each of the two

Two pages, one drawing (`src/features/profile/ProfileScreen.tsx`, `src/data/profile.ts`).
`/profile/partner` is what the other one chose to show me: how they are (their newest
check-in with something shown, every shown part of it), their answers about themselves,
where the two of us meet on the list, their wishes, what they sealed. `/profile` is my
own, and it is drawn from the same rows: the ones that travel, never the diary. So the
sentence on it, "This is what Leo sees of you", is true part by part. A unit test reads
her profile from her phone and from his and compares the two.

- A tap on a picture opens a profile. Changing name, picture and status line is one step
  further ("Edit profile"), where it is expected.
- "Us" begins with the two of them, each a card that opens their profile. The settings
  follow.
- What I keep to myself is not on my profile. The page says so and leads to where it
  lives: the questions about me, the list, my cockpit.
- The other one's answers moved from the foot of "About me" to their profile.

Limits, as everywhere: "what Leo sees" means what has reached the cloud. While a change
still waits on the phone (the room says so), the other phone is a step behind. And an
open answer on the list that met nothing is on nobody's profile, though it is a plain
row in the cloud like every open answer (section 12).

## Limits to know

- **Android and Chrome first.** Recording, installing and notifications are tested there.
  iPhone would need its own look at recording formats and at notifications.
- **Voice notes travel whole.** A five-minute note is a few megabytes and needs a
  connection that holds for the upload. It is queued and retried.
- **The first load is one piece of JavaScript** (about 325 kB compressed). After the first
  visit the app starts from the phone.
- **A paused or logged-out author** cannot release held layers. Nothing is lost while the
  phone keeps its data.
- **Clocks.** A timed envelope opens by the cloud's clock, not the phone's. A phone with a
  wrong clock shows a wrong countdown and still opens at the right moment.
