# Plan

What the app is for, in one sentence: to make it easier for one of you to say what she
felt and wants, at her own pace, and for the other one to hear it well. Every milestone is
measured against that. [DECISIONS.md](DECISIONS.md) has the reasons.

Seven milestones. Each one ends with something the two of you can use, and with a look at
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
- [ ] **M3 The match list.** Things to say yes, maybe or no to, each of you alone:
      fantasies, wishes, places, positions. A match shows only when both said yes (or yes
      and maybe). A no is never shown to the other one. **Every answer can carry its why,**
      and a why can be sealed like anything else. The two of you fill the list: the app
      ships with categories and neutral examples, not with explicit text. Positions need
      drawings of our own.
- [ ] **M4 Dirty talk cards.** A deck the two of you write in a card editor. She draws a
      card, says it out loud if she wants, records it if she wants, says how it felt and
      why, seals it, and chooses what is revealed: only how it felt, or voice and all.
      Built on the envelope: a card is one more kind of envelope with a prompt on it.
- [ ] **M5 Echo and afterglow.** *Echo:* he answers with what he heard, in his own words,
      and she marks what he got right. *Afterglow:* after an evening, three or four
      questions each, alone, sealed until both are done, then opened together. With the
      why on each.
- [ ] **M6 The cockpit.** What warms her, what is harder, and how that moves over the
      months: reasons counted by tone, heat against courage, what was said in writing and
      what out loud, which wishes matched. Numbers about patterns, never a score for a
      person, and no streaks. Only what both have opened counts. Each of you sees the
      same page.
- [ ] **M7 Mood weather and hotwife mode.** *Mood weather:* one tap a day for how open
      she feels ("slow today, please"), shown on the room, so that he knows before he
      asks. *Hotwife mode:* a space of its own for that fantasy and for what comes after:
      wishes and limits with their why, a check-in before, a debrief after, all sealed
      and revealed like everything else.

## Open right now

- **The cloud is not connected yet.** The app is built and tested against the pretend
  cloud and against a local Postgres. Creating the Supabase project, applying the three
  migrations and putting the address into `.env.production` is the next step (README,
  "Connecting the cloud"). Until then the published address shows one page that says so.
- **Who opens the room** is for the two of you to decide (DECISIONS.md, section 8).
- **A real phone.** Recording, the lock when the app goes out of sight, and a real
  notification on a real lock screen have been seen in tests, not yet on your phones.

## Backlog

Not promised, kept so that it is not forgotten.

- **AI.** Left out on purpose. If it ever helps, then only on words she chooses to show
  it, never on sealed content, and never as a judge of anything.
- **Keys the cloud never sees.** A key both phones share and the cloud does not, so that
  even opened envelopes are unreadable in the database (DECISIONS.md, "What the seal is
  not").
- **Fingerprint unlock** for the app lock (WebAuthn).
- **"Not today".** One tap that tells the other one, kindly, that now is not the moment,
  without having to explain.
- **A heat ceiling.** Each person sets the hottest card or question the app may ever show
  them (`MemberPrefs.heatMax` exists in the data, nothing uses it yet).
- **Envelopes that disappear by themselves** after a time the author chooses.
- **A quiet name and icon** for the home screen, for anybody who wants the app to look
  like something else.
- **A backup of opened envelopes** as a file only the two of you can open.
- **iPhone.** Recording formats and notifications need their own look.
- **A smaller first load.** Split the JavaScript so that the start screen arrives first.
