# Plan

What the app is for, in one sentence: to make it easier for one of you to say what she
felt and wants, at her own pace, and for the other one to hear it well. Every milestone is
measured against that. [DECISIONS.md](DECISIONS.md) has the reasons.

Eight milestones. Each one ends with something the two of you can use, and with a look at
it together before the next one starts.

- [x] **M1 The room.** The foundation from FoodwishUs, cleared of everything about food:
      a room for two with name and PIN, an admin, invites by QR code or link, settings
      that follow the person, offline start, sync between two phones that are never online
      together, notifications, the Sync page. New: no roles, an **app lock** per device,
      a design of its own ("letters after dark"), a build that says so when its cloud is
      not connected yet. Three database migrations with their rule tests.
- [x] **M2 Seal and reveal, and the confession booth.** The envelope with three layers
      (how it felt, words, voice), each sealed on the phone with its own key. Opens right
      away, at a time or by hand, each layer by itself. One opening or staying. Taking
      back. **The why** as its own building block, with warm and tender reasons and her
      own words. What she hopes for ("just take it in"). His answer: taps, how it landed,
      his why. No read receipts. Notifications that say who and when, never what.
- [x] **M3 Closer.** Five things that belong together, built in one go (17 November 2026).
      What a person notes about themselves stays on their phone and is shown part by part,
      only by their own choice (DECISIONS.md, section 12).
      - **A first look at yourself.** Right after signing up: six questions, each a step
        between two poles with its why, then a first walk through the list, then the two
        moments of the day. All of it optional, all of it found again under "About me".
      - **The check-in.** Twice a day at moments each person chooses, with a reminder only
        if they switch it on: energy, the day, closeness, how open for closeness, desire,
        kinky, how often sex was on the mind and which fantasy, what there was, and why.
        This is also the **mood weather**: what somebody shows of today stands on the
        other one's room ("Slow today, please"), so that he knows before he asks.
      - **The list** (the match list). Things to say "I would like that", "I am curious",
        "only in my head" or "not for me" to, each alone, with how strong the pull is and
        why. Something shows for both only where both answered openly. A "not for me"
        never leaves the phone. The app ships with twelve groups of plainly named items;
        the two of them write the rest themselves.
      - **Wishes.** Something one of them would like, said plainly with how much and why;
        the other one decides (yes, not now, let us talk, not for me) with how it lands
        and a why. A "not now" can become a "yes". A fantasy that may stay one asks for no
        decision.
      - **The cockpit.** One page for each of them (everything they noted) and one for two
        (only what each chose to show, the same page on both phones): how the days went,
        what was on the mind and how often, what there was, what was behind it, and what
        tends to go with more desire. A notebook, not a scoreboard.
      Migration `0004_closer.sql` with its rule test; four more kinds of notification.
- [ ] **M4 Dirty talk cards.** A deck the two of you write in a card editor. She draws a
      card, says it out loud if she wants, records it if she wants, says how it felt and
      why, seals it, and chooses what is revealed: only how it felt, or voice and all.
      Built on the envelope: a card is one more kind of envelope with a prompt on it.
- [ ] **M5 Echo and afterglow.** *Echo:* he answers with what he heard, in his own words,
      and she marks what he got right. *Afterglow:* after an evening, three or four
      questions each, alone, sealed until both are done, then opened together. With the
      why on each.
- [ ] **M6 The cockpit, from the envelopes too.** What M3 draws comes from check-ins, the
      list and wishes. Still to come, from what both have opened: reasons counted by tone,
      heat against courage, what was said in writing and what out loud.
- [ ] **M7 Positions and places on the list.** Positions need drawings of our own, places a
      little more than a word.
- [ ] **M8 Hotwife mode.** A space of its own for that fantasy and for what comes after:
      wishes and limits with their why, a check-in before, a debrief after, all sealed
      and revealed like everything else.

## Open right now

- **The cloud knows M3** (17 November 2026, with the owner's go). `0004_closer.sql` went
  into the live project in one piece (migration `closer_01_notes_list_wishes`). The schema
  fingerprint was the same on the live project and on a local database before it (the
  first three migrations) and after it (all four): ten lines of ten. The room's own rows
  are untouched, and the advisors report nothing of a new kind.
- **The notification function** is deployed again (version 2), as the same one-line loader,
  now pinned to the commit that knows the four new kinds. It starts and refuses a call
  without the secret, as it should.
- **The rules hold on the live project too** (18 November 2026): the owner ran
  `supabase/tests/closer_test.sql` in the SQL editor, 39 of 39. The push settings, the
  marks and the counts of rooms, people, logins and devices were the same before and
  after. A rule test goes into the SQL editor, not through the connector: Supabase asks
  the owner to confirm SQL it takes to be destructive (any `delete`, also the one hard
  delete the rules refuse), and that question does not reach the owner's app (five tries,
  each timed out after a minute, nothing ran). Do not disguise a statement to get past
  the question. Since 18 November the test empties no table: it removes only its own marks.
- **The room is open.** On 17 November 2026 the live project held one room with two people
  and three devices, one of them signed up for notifications (counts only: nothing of the
  room was read). So anonymous sign-ins are switched on and the app is reachable.
- **He opens the room**, so he is its admin. That opens no envelope (DECISIONS.md,
  section 8).
- **On real phones.** Recording, the lock when the app goes out of sight and a
  notification on a real lock screen have been seen in tests. How they behave on your two
  phones is for you to say; so are the four new kinds of notification.

## Backlog

Not promised, kept so that it is not forgotten.

- **AI.** Left out on purpose. If it ever helps, then only on words she chooses to show
  it, never on sealed content, and never as a judge of anything.
- **Keys the cloud never sees.** A key both phones share and the cloud does not, so that
  even opened envelopes are unreadable in the database (DECISIONS.md, "What the seal is
  not").
- **Fingerprint unlock** for the app lock (WebAuthn).
- **A copy of the diary.** What somebody notes about themselves is on one phone only. A
  way to carry it to a new phone, as a file only they can open.
- **"Ask me again in a month".** A wish answered with "not now" sleeps and comes back
  once, unless its author takes it back meanwhile.
- **A look back for two.** Once a week each picks one moment; shown when both have picked.
- **Going through the list again** every few months: only new things in common appear,
  never a move to "not for me".
- **A heat ceiling.** Each person sets the hottest card or question the app may ever show
  them (`MemberPrefs.heatMax` exists in the data, nothing uses it yet).
- **Envelopes that disappear by themselves** after a time the author chooses.
- **A quiet name and icon** for the home screen, for anybody who wants the app to look
  like something else.
- **A backup of opened envelopes** as a file only the two of you can open.
- **iPhone.** Recording formats and notifications need their own look.
- **A smaller first load.** Split the JavaScript so that the start screen arrives first.
