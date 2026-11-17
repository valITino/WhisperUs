# WhisperUs: working notes for Claude

A private, mobile-first app for two (Android, installable PWA). One of them says what is
hard to say out loud, in a booth, and seals it. The other one opens it when the author
allows, and answers. Slogan: "U tell. I listen."

Read `PLAN.md` (milestones), `DECISIONS.md` (why things are the way they are) and
`README.md` (how the two of them use it) before larger work.

## What this app is, and what it must never become

The people who use it are a real couple, and one of them finds it hard to open up. Every
change is measured against one question: does it make telling easier and being heard
safer?

- **Nothing rates a feeling.** No good or bad, no normal, no scores for a person, no
  streaks, no nudges to "share more". Reasons are *warm* or *tender*, and both can be true.
  A scale runs between two poles that are both all right, and can always be left empty.
- **The author decides.** When something opens, which part, for how long. Never open,
  reveal, preview or count anything on the author's behalf. What a person notes about
  themselves is shown part by part, and "only me" is the choice that is already made.
- **Counting can hurt what it counts.** The cockpit draws no hole for a day without a
  check-in, sets no targets, compares nobody, says nothing about a pattern until there
  is enough to go on, and never counts anybody's no (DECISIONS.md, section 12).
- **The why is offered everywhere and required nowhere.** Wherever somebody chooses or
  rates, the same picker asks "and why?" (`src/features/why`). It can always be left empty.
- **No read receipts**, in the app or in a notification.
- **Discretion.** A notification, the lock screen, the Sync page, a report, a log line:
  none of them ever carries a line from an envelope, a reason, a heat, or a hint at the
  subject. When in doubt, say less.
- **No explicit text ships with the app.** Prompts, cards and examples that are sexual in
  content are written by the two of them, in the app. The app provides the forms. The
  list ships with plainly named tags (`src/features/list/library.ts`) and stays that way.
- **Honest limits.** Do not describe the seal as more than it is (DECISIONS.md, "What the
  seal is not"). Copy that promises privacy has to be true as written.

## Commands

```bash
npm run dev         # dev server with a pretend cloud (never touches real data)
npm run typecheck
npm test            # vitest unit tests
npm run e2e         # Playwright, Android viewport, two phones against the dev server
npm run build:test  # production build wired to an address that leads nowhere
npm run e2e:pwa     # offline, update note, install, push and lock against that build
npm run build       # production build (talks to the cloud in .env.production, if any)
npm run build:push  # bundles the push Edge Function into one file for deploying
bash supabase/tests/local/run.sh          # the migrations and their rule tests on a local Postgres
bash supabase/tests/local/run.sh closer   # only the tests whose file name contains "closer"
bash supabase/tests/local/run.sh digest   # a fingerprint of the schema, to compare with the live project
```

Run several dev servers side by side with `WHISPERUS_PORT=5180 npm run dev` (the e2e
configs read the same variable). After changing `src/data/fake/cloudCore.ts` or
`tools/fakeCloudPlugin.ts`, restart the dev server: the pretend cloud lives inside it.

## How the app is put together

- `src/data/types.ts` is the shared vocabulary. Rows are camelCase in the app.
- **An envelope** has an outside (teaser, heat shown outside, wants, keep, openMode,
  opensAt) and up to three **layers**: `feel`, `words`, `voice`. Each layer is sealed on
  the author's phone with its own key (`src/data/seal.ts`, Web Crypto). Sealed layers live
  in `envelopes.layers`; keys travel separately as rows of `keys`. A layer that is held
  back (by "When I say", or because the author did not release it) stays in the local-only
  `vault` table. `src/data/envelopes.ts` turns rows, keys and vault into what a screen
  shows (`viewOf`): pure, and tested.
- **What a person notes about themselves** (a check-in, an answer about themselves, an
  answer on the list) is written whole to the local-only `diary` table and, under the
  same stable id (`stableId` in `types.ts`), in its shown parts only to a synced row:
  `notes` for check-ins and answers about oneself, `leanings` for open answers on the
  list. A "not for me" and anything kept quiet have no synced row at all.
  `src/data/journal.ts` writes both and turns rows and diary into what a screen shows
  (`mine`, `theirs`, `myLeanings`, `matchesOf`): pure, and tested.
- **Wishes** (`src/data/wishes.ts`) are plain rows of `wishes`: the author writes the
  wish, the other one writes `answer`. `ideas` are items the two of them wrote onto the
  list. `src/data/cockpit.ts` is the cockpit's arithmetic: pure, and tested.
- **Reading:** screens use hooks from `src/data/queries.ts` (and `useMe` in `hooks.ts`).
  They return `undefined` while loading and update live.
- **Writing:** screens call functions from `src/data/do.ts` (the actions of
  `src/data/actions.ts`, `journal.ts` and `wishes.ts`, bound to the app's database and
  cloud). A setting on the profile other than language and light is changed with
  `updateMyPrefs`, which keeps the rest of `Member.prefs` as it is. Never write to Dexie
  directly from a screen. Never await Web Crypto inside a Dexie transaction: decrypt
  first, then open the transaction.
- `src/data/sync.ts` pushes the outbox, pulls changes, uploads and fetches sealed voice
  notes, tidies what was taken back or burned, and wakes at the moment a timed envelope is
  due. Screens never talk to the backend, except logging in and the admin's tools, which
  go through `startRoom` / `joinRoom` / `logIn` / `logOut` and `backend` in
  `src/data/app.ts`.
- **The rules are the database's.** `supabase/migrations` decides who may change which
  field, who gets which key and when, what burns after one opening and what is wiped when
  an envelope is taken back. The pretend cloud in `src/data/fake` must follow the same
  rules; `tests/unit/supabaseContract.test.ts` and the SQL tests hold them together.
  Change one, change the other, and add the case to both tests.
- **People:** a person is a profile (`members`), a device is a login. Name + PIN logs in
  (`src/data/pin.ts`). Whoever opened the room is the admin (`Member.isAdmin`); the admin
  opens no envelope. There are no roles. Language and theme live in `Member.prefs` and
  follow the person (`src/app/settingsSync.ts`).
- **The why:** `src/features/why`. `library.ts` has the reasons per question with stable
  ids and a tone; `WhyPicker` asks, `WhyView` shows. A new place that asks for a why adds
  a context to the library, not a new component.
- **Who sees this:** `src/features/share/ShareChoice.tsx`, the same wherever something
  noted can be shown in parts. A new place uses it, not a toggle of its own.
- **Closer** (PLAN.md, M3), one folder each under `src/features`: `hello` (the first look
  after signing up, `/hello`), `about` (the questions about myself; `library.ts` has them),
  `checkin` (the check-in page, its vocabulary, the times page under Settings), `list`
  (the list with its sheets; `library.ts` has the groups and items), `wishes` (the tab,
  the form, one wish with its answer) and `cockpit` (mine at `/cockpit`, for two at
  `/cockpit/us`). Ids in the libraries are what gets saved: never change one.
- **Charts** are the two drawings in `src/ui/components/Chart.tsx` (`DayColumns`,
  `RankedBars`): one colour, thin marks, every value also in words. No other chart, no
  chart library.
- **The booth:** `src/features/booth`. Three steps on one page (say, feel, seal). The
  draft is kept for a day in localStorage (`draft.ts`); a recording never is.
- **An envelope's page:** `src/features/envelope`. `Mine.tsx` for its author, `Theirs.tsx`
  for the one it is for, `Reply.tsx` for the answer.
- **Voice:** `src/features/voice` (MediaRecorder, five minutes at most).
- **The app lock:** `src/features/lock`. Device-local, checked before anything else a
  logged-in device could show (`src/app/Shell.tsx`). Logging out clears it
  (`src/data/wipe.ts`).
- **Notifications:** `src/data/push.ts` on the device, `supabase/functions/push` on the
  server (`logic.ts` is pure and shared with the pretend cloud), triggers and the minute
  jobs in `0003_push.sql` and `0004_closer.sql`. Seven kinds; the list of them is in
  `logic.ts`, `backend.ts` and the newest migration, and a unit test keeps the three the
  same. Setting it up: `supabase/functions/push/README.md`.
- **Offline:** the service worker is `src/sw/sw.ts` (production build only).
- `src/app/router.ts`: hash routes. `navigate('/booth')`, `back('/')`, `useRoute()`,
  `matchPath('/envelope/:id', path)`. A page can hold the phone's back button
  (`setBlocker`); `navigate()` is never held.
- `src/app/Shell.tsx` owns the lock, the start, the four tabs (room, wishes, cockpit,
  us) and toasts. `src/App.tsx` shows the
  "not connected yet" page when the build knows no cloud (`src/data/cloud.ts`).
- **Refused changes** (`deadLetters`) leave the list only through `sync.retryRefused` and
  `sync.discardRefused`; `src/data/refused.ts` names them by kind, never by content.

## The cloud

- The real backend is Supabase (`supabaseBackend.ts`). **Never run tests or experiments
  against a real project**, and never point this app at another project's data.
  `.env.production` names this room's own project or nothing at all.
- The first three migrations are applied to the live project (13 November 2026) and are
  history: never edit them. A change to the database is a new migration, applied to the
  live project only with the owner's go, and checked afterwards by comparing
  `bash supabase/tests/local/run.sh digest` with `supabase/tests/local/digest.sql` run on
  the live project (the ten lines must be the same).
- `0004_closer.sql` is written, tested locally and **not applied** (17 November 2026):
  PLAN.md, "Open right now". Once it is applied it is history like the others. Until
  then the tables it brings are `LATER_TABLES` in `types.ts`: a cloud that does not know
  them answers "table_missing", and changes to them wait on the phone instead of being
  refused (`sync.ts`, `status.later`). The pretend cloud plays such a cloud with
  `cloud.closer = false`.
- The only tests that may run on the live project are the repository's own SQL rule tests
  (`supabase/tests/*.sql`): they build throwaway rows and roll themselves back.
- **What must not be readable by the project's owner is never sent.** Row-level security
  is not a seal: whoever owns the project can browse every table. Either seal it on the
  phone (envelopes) or keep it on the phone (the diary).
- Secrets never appear in the repository, a test or a chat. The publishable key is public
  by design; the secret key never leaves Supabase.

## Rules

- **Copy:** every string the user sees is translated (English and German, Swiss spelling:
  no ß). Shared words live in `src/i18n/en.ts` / `de.ts`; feature copy lives next to the
  feature and is read with `useCopy({ en: {...}, de: {...} })`. Sentence case, plain
  verbs, no filler. A button says what happens ("Seal it"), and the toast afterwards uses
  the same word ("Sealed"). Errors say what went wrong and how to fix it. No em dashes in
  copy. A time inside a sentence comes from `inWords` (`src/lib/when.ts`), a time as a
  label from `dayAndTime`.
- **Design:** build only from `src/ui/components` and `src/ui/deco`. Tokens are in
  `src/ui/styles.css`. Paper, ink, wax and candlelight: flat colour and hairlines, no
  gradients. Only floating things get a shadow. One main (candle) button per screen. Wax
  red is for seals and for the light of a running recording, never for errors or decoration. Handwriting (`handwritten`,
  `whispered`) only on envelopes and for words somebody wrote. No all-caps labels, no
  middle-dot separators, no arrows on buttons.
- **Card padding:** pass `pad={false}` to `Card` when you set your own spacing.
- **Phone first:** design for 360 to 430 px wide. Touch targets at least 44 px. Every
  control has a label (`aria-label` for icon buttons). Text contrast AA by day and after
  dark. Respect reduced motion. `tests/e2e/a11y.spec.ts` guards names, sideways scroll and
  the one h1 on every screen in both languages: add new screens to its lists.
- **Motion answers actions.** No entrance animations on every card.
- **Dates:** the room lives in Europe/Zurich. Use `src/lib/dates.ts` and `src/lib/when.ts`.
- **Tests:** unit tests for logic, a Playwright spec for each user flow, a SQL test for
  each database rule. Wait for visible results, never for timers. A test never depends
  on today's date (the pretend cloud's clock never runs backwards: start from
  `Date.now()`, not from a fixed day). Somebody new lands on `/hello` first: specs about
  anything else pass it with `skipFirstLook` (the helpers do). In e2e, move inside the
  app with `go(page, path)` from `tests/e2e/ship.helpers.ts` (the app's own router), and
  build state through the screens or through `window.__whisperus.actions`.
- **Verify by looking:** take screenshots by day and after dark at 412 x 915 and fix what
  looks off before calling a screen done.
- Commits end with the attribution lines used in `git log`.
