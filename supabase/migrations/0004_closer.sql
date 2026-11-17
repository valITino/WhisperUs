-- WhisperUs: closer. What a person shows about themselves, the list, and wishes.
--
-- Four tables:
--
--   notes     Something a person noted about themselves and chose to show: parts of a
--             check-in ("how I am right now"), or an answer to one of the questions about
--             themselves. The whole of what they noted stays on their phone and never
--             comes here. "body" holds only the parts they opened, and is emptied when
--             they show nothing any more.
--   leanings  "I would like that", "I am curious" or "only in my head" to one item of
--             the list. The other person can read a row only while they have such a row
--             for the same item themselves. A "not for me" has no row: it never leaves
--             the phone it was tapped on.
--   ideas     An item one of the two wrote onto the list in their own words. Both read
--             it; neither learns from it what the other one answers.
--   wishes    Something one of the two wishes for, said plainly, and the other one's
--             answer: a decision, how it lands, and a why. Not sealed.
--
-- Who may write what:
--   * A note, a leaning and an idea are their author's alone to write, change and take back.
--   * On a wish, the author writes the wish and the other person writes the answer,
--     and nothing else. What was answered stays as it was answered (the author can
--     still take it back). An answer can be replaced, not taken away.
--   * Taking anything back empties it here. An empty shell stays, so both phones learn
--     that it is gone.
--
-- What this is not: these rows are plain. Row-level security keeps them inside the room
-- and keeps an unmet answer on the list from the other person's phone; whoever owns the
-- project can read them in the dashboard, deliberately. What must not be readable by
-- anybody is never sent here: it stays in the phone's own diary (DECISIONS.md, section 12).
--
-- Notifications: four more kinds of news (wished, decided, matched, checkin). They say
-- who, never what: not a word of a wish, not the decision, not the item.
--
-- The same rules live in the pretend cloud (src/data/fake/cloudCore.ts). Keep the two in step.

-- ---------------------------------------------------------------- tables ----

create table public.notes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  kind text not null check (kind in ('checkin', 'about')),
  -- checkin: the day and its half, '2026-11-17.am'. about: the question's id.
  ref text not null check (char_length(ref) between 1 and 40),
  -- When it was noted, by the phone's clock.
  at timestamptz not null default now(),
  -- Only the parts its author opened. '{}': nothing is shown (any more).
  body jsonb not null default '{}'::jsonb check (jsonb_typeof(body) = 'object' and octet_length(body::text) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.leanings (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  -- An item of the app's list ('soft.massage') or the id of an idea.
  item text not null check (char_length(item) between 1 and 60),
  lean text not null check (lean in ('yes', 'maybe', 'dream')),
  pull smallint check (pull between 1 and 5),
  -- Only once its author shows it.
  why jsonb check (why is null or (jsonb_typeof(why) = 'object' and octet_length(why::text) <= 4000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- One answer per person and item, whatever happens on two devices at once.
create unique index leanings_member_item_key on public.leanings (member_id, item);

create table public.ideas (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  author_id uuid not null references public.members (id) on delete cascade,
  label text not null check (char_length(label) <= 60),
  -- The group of the list it stands in.
  section text not null check (char_length(section) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint ideas_label_not_blank check (deleted_at is not null or btrim(label) <> '')
);

create table public.wishes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  author_id uuid not null references public.members (id) on delete cascade,
  text text not null check (char_length(text) <= 400),
  item text check (item is null or char_length(item) <= 60),
  -- do: I would like us to do this. dream: a fantasy that may stay one.
  mode text not null default 'do' check (mode in ('do', 'dream')),
  want smallint check (want between 1 and 5),
  why jsonb not null default '{"chips":[],"own":[],"note":null}'::jsonb check (jsonb_typeof(why) = 'object' and octet_length(why::text) <= 4000),
  -- { "decision": "yes", "taps": [], "heat": 3, "why": {...}, "at": "..." }: only the other one writes it.
  answer jsonb check (answer is null or (jsonb_typeof(answer) = 'object' and octet_length(answer::text) <= 8000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint wishes_text_not_blank check (deleted_at is not null or btrim(text) <> '')
);

create index notes_household_updated_idx on public.notes (household_id, updated_at);
create index leanings_household_updated_idx on public.leanings (household_id, updated_at);
create index leanings_item_idx on public.leanings (household_id, item);
create index ideas_household_updated_idx on public.ideas (household_id, updated_at);
create index wishes_household_updated_idx on public.wishes (household_id, updated_at);

-- ---------------------------------------------------------------- guards ----

-- What somebody shows about themselves is theirs alone to write.
create function private.guard_note() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me uuid;
begin
  -- A change made outside the app (the SQL editor, a job) is the owner's own business.
  if v_uid is null then
    return new;
  end if;
  select d.member_id into v_me from private.member_devices d where d.user_id = v_uid;

  if tg_op = 'INSERT' then
    if v_me is null then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.member_id := v_me;
  else
    if old.member_id is distinct from v_me then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.member_id := old.member_id;
    new.kind := old.kind;
    new.ref := old.ref;
  end if;
  -- Taken back: the cloud forgets what was shown.
  if new.deleted_at is not null then
    new.body := '{}'::jsonb;
  end if;
  return new;
end
$$;

-- An answer on the list is its author's alone to write.
create function private.guard_leaning() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me uuid;
begin
  if v_uid is null then
    return new;
  end if;
  select d.member_id into v_me from private.member_devices d where d.user_id = v_uid;

  if tg_op = 'INSERT' then
    if v_me is null then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.member_id := v_me;
  else
    if old.member_id is distinct from v_me then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.member_id := old.member_id;
    new.item := old.item;
  end if;
  if new.deleted_at is not null then
    new.pull := null;
    new.why := null;
  end if;
  return new;
end
$$;

-- What somebody wrote onto the list is theirs to change and to take off.
create function private.guard_idea() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me uuid;
begin
  if v_uid is null then
    return new;
  end if;
  select d.member_id into v_me from private.member_devices d where d.user_id = v_uid;

  if tg_op = 'INSERT' then
    if v_me is null then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.author_id := v_me;
  else
    if old.author_id is distinct from v_me then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.author_id := old.author_id;
  end if;
  if new.deleted_at is not null then
    new.label := '';
  end if;
  return new;
end
$$;

-- The author owns the wish; the other one owns the answer.
create function private.guard_wish() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me uuid;
begin
  if v_uid is null then
    return new;
  end if;
  select d.member_id into v_me from private.member_devices d where d.user_id = v_uid;

  if tg_op = 'INSERT' then
    if v_me is null then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.author_id := v_me;
    new.answer := null;
  else
    new.author_id := old.author_id;
    if v_me is not distinct from old.author_id then
      -- The author cannot speak for the other one.
      new.answer := old.answer;
      -- What was answered stays as it was answered.
      if old.answer is not null then
        new.text := old.text;
        new.item := old.item;
        new.mode := old.mode;
        new.want := old.want;
        new.why := old.why;
      end if;
    else
      -- The other one may only answer. An answer can be replaced, not taken away.
      new.text := old.text;
      new.item := old.item;
      new.mode := old.mode;
      new.want := old.want;
      new.why := old.why;
      new.deleted_at := old.deleted_at;
      new.answer := coalesce(new.answer, old.answer);
    end if;
  end if;

  if new.deleted_at is not null then
    -- Taken back: the cloud forgets its words, its why and the answer.
    new.text := '';
    new.item := null;
    new.want := null;
    new.why := '{"chips":[],"own":[],"note":null}'::jsonb;
    new.answer := null;
  end if;
  return new;
end
$$;

-- (Triggers on one table fire in the order of their names: guard, then touch.)
create trigger guard before insert or update on public.notes
  for each row execute function private.guard_note();
create trigger guard before insert or update on public.leanings
  for each row execute function private.guard_leaning();
create trigger guard before insert or update on public.ideas
  for each row execute function private.guard_idea();
create trigger guard before insert or update on public.wishes
  for each row execute function private.guard_wish();

create trigger touch before insert or update on public.notes
  for each row execute function private.touch_row();
create trigger touch before insert or update on public.leanings
  for each row execute function private.touch_row();
create trigger touch before insert or update on public.ideas
  for each row execute function private.touch_row();
create trigger touch before insert or update on public.wishes
  for each row execute function private.touch_row();

-- ------------------------------------------------------------------- RLS ----
-- There is no delete policy anywhere: rows are soft-deleted through deleted_at.

-- Whether the caller answers this item of the list openly right now. It runs with the
-- owner's rights because the policy below asks about the very table it protects.
create function private.i_lean(p_item text) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.leanings l
    where l.item = p_item and l.deleted_at is null
      and l.member_id in (select private.my_member_ids())
  )
$$;

alter table public.notes enable row level security;
revoke all on public.notes from anon, authenticated;
grant select, insert, update on public.notes to authenticated;
create policy "room members read" on public.notes for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy "authors add" on public.notes for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and member_id in (select private.my_member_ids()));
create policy "authors edit" on public.notes for update to authenticated
  using (household_id in (select private.my_household_ids()) and member_id in (select private.my_member_ids()))
  with check (household_id in (select private.my_household_ids()) and member_id in (select private.my_member_ids()));

-- The list. My own answers always; the other one's only where I answered openly too.
alter table public.leanings enable row level security;
revoke all on public.leanings from anon, authenticated;
grant select, insert, update on public.leanings to authenticated;
create policy "mine always, the other one's where we meet" on public.leanings for select to authenticated
  using (
    household_id in (select private.my_household_ids())
    and (
      member_id in (select private.my_member_ids())
      or private.i_lean(item)
    )
  );
create policy "authors add" on public.leanings for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and member_id in (select private.my_member_ids()));
create policy "authors edit" on public.leanings for update to authenticated
  using (household_id in (select private.my_household_ids()) and member_id in (select private.my_member_ids()))
  with check (household_id in (select private.my_household_ids()) and member_id in (select private.my_member_ids()));

alter table public.ideas enable row level security;
revoke all on public.ideas from anon, authenticated;
grant select, insert, update on public.ideas to authenticated;
create policy "room members read" on public.ideas for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy "authors add" on public.ideas for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()));
create policy "authors edit" on public.ideas for update to authenticated
  using (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()))
  with check (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()));

alter table public.wishes enable row level security;
revoke all on public.wishes from anon, authenticated;
grant select, insert, update on public.wishes to authenticated;
create policy "room members read" on public.wishes for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy "authors add" on public.wishes for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()));
-- Both may update; the guard decides which columns each of them really changes.
create policy "room members edit" on public.wishes for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));

-- ------------------------------------------------------------------ sync ----

-- Everything that changed since the cursor, plus whether this device still has its seat.
-- Runs with the caller's rights, so row-level security decides what comes back.
-- A key that opened since the cursor counts as changed although its row did not. In the
-- same way an answer of the other one's on the list counts as changed at the moment my
-- own answer to that item does: that is how a phone learns what the two have in common.
create or replace function public.sync_pull(p_since timestamptz default null) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'server_time', now(),
    'seat', private.seat_state(),
    'households', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.households t
                   where p_since is null or t.updated_at > p_since),
    'members', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.members t
                where p_since is null or t.updated_at > p_since),
    'envelopes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.envelopes t
                  where p_since is null or t.updated_at > p_since),
    'keys', (select coalesce(jsonb_agg(to_jsonb(t) - 'announced_at'), '[]'::jsonb) from public.keys t
             where p_since is null or t.updated_at > p_since or (t.opens_at > p_since and t.opens_at <= now())),
    'media', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.media t
              where p_since is null or t.updated_at > p_since),
    'notes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.notes t
              where p_since is null or t.updated_at > p_since),
    'leanings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.leanings t
                 where p_since is null or t.updated_at > p_since
                    or exists (
                      select 1 from public.leanings mine
                      where mine.item = t.item and mine.id <> t.id and mine.updated_at > p_since
                        and mine.member_id in (select private.my_member_ids())
                    )),
    'ideas', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.ideas t
              where p_since is null or t.updated_at > p_since),
    'wishes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.wishes t
               where p_since is null or t.updated_at > p_since)
  )
$$;

-- -------------------------------------------------------------- realtime ----

alter publication supabase_realtime add table public.notes;
alter publication supabase_realtime add table public.leanings;
alter publication supabase_realtime add table public.ideas;
alter publication supabase_realtime add table public.wishes;

-- --------------------------------------------------------- notifications ----
--
--   wished    the other one has a wish for you
--   decided   the other one answered your wish (also when a decision changes later)
--   matched   the list has something new that both of you answered openly
--   checkin   the minute you asked to be reminded of, to note how you are (only you)

alter table public.push_subscriptions
  drop constraint push_subscriptions_muted_known,
  add constraint push_subscriptions_muted_known
    check (muted_types <@ array['sealed', 'opened', 'answered', 'wished', 'decided', 'matched', 'checkin']);

-- Only kinds of notification that exist, each once.
create or replace function private.push_types(p_types text[]) returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(known.kind order by known.place), '{}')
  from unnest(array['sealed', 'opened', 'answered', 'wished', 'decided', 'matched', 'checkin']) with ordinality as known (kind, place)
  where known.kind = any (coalesce(p_types, '{}'))
$$;

-- When somebody was last told a kind of news that is not told twice in a row.
create table private.push_marks (
  member_id uuid not null references public.members (id) on delete cascade,
  kind text not null,
  told_at timestamptz not null default now(),
  primary key (member_id, kind)
);
alter table private.push_marks enable row level security;
revoke all on private.push_marks from public, anon, authenticated;

-- Hand one event to the push function, as it is. Does nothing until private.push_config
-- has its row. (private.send_push of 0003 does the same for the three kinds about envelopes.)
create function private.send_news(p_event jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_config private.push_config;
begin
  if p_event ->> 'actor_id' is null then
    return;
  end if;
  select * into v_config from private.push_config;
  if not found then
    return;
  end if;
  -- pg_net sends after this transaction has committed, so the function sees the change.
  perform net.http_post(
    url := v_config.function_url,
    body := p_event,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_config.secret),
    timeout_milliseconds := 8000
  );
end
$$;

-- A notification is a nicety: whatever goes wrong in here, the write itself goes through.
-- The same rules live in supabase/functions/push/logic.ts (wishEvent, matchEvent,
-- checkinDue), which the pretend cloud uses. Keep the two in step.

-- A new wish is "wished". An answer is "decided", and so is a decision that changes.
create function private.push_on_wish() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
  v_was text;
  v_is text;
begin
  if new.deleted_at is not null then
    return null;
  end if;
  select d.member_id into v_actor from private.member_devices d where d.user_id = (select auth.uid());
  if v_actor is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    perform private.send_news(jsonb_build_object('type', 'wished', 'household_id', new.household_id, 'actor_id', v_actor, 'wish_id', new.id));
    return null;
  end if;
  -- The decision of an answer: '' for an answer without one, null while there is no answer.
  v_was := case when old.answer is null then null else coalesce(old.answer ->> 'decision', '') end;
  v_is := case when new.answer is null then null else coalesce(new.answer ->> 'decision', '') end;
  if v_is is not null and v_is is distinct from v_was then
    perform private.send_news(jsonb_build_object('type', 'decided', 'household_id', new.household_id, 'actor_id', v_actor, 'wish_id', new.id));
  end if;
  return null;
exception when others then
  return null;
end
$$;

create trigger push_news after insert or update on public.wishes
  for each row execute function private.push_on_wish();

-- An answer on the list that just became open, where the other one answered openly too:
-- "matched", for the other one. Not again within ten minutes: somebody going through the
-- list must not make the other phone buzz twenty times.
create function private.push_on_leaning() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_other uuid;
begin
  if new.deleted_at is not null or (select auth.uid()) is null then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.deleted_at is null then
    return null;
  end if;
  select l.member_id into v_other
  from public.leanings l
  where l.household_id = new.household_id and l.item = new.item
    and l.member_id <> new.member_id and l.deleted_at is null
  limit 1;
  if v_other is null then
    return null;
  end if;
  if exists (
    select 1 from private.push_marks k
    where k.member_id = v_other and k.kind = 'matched' and k.told_at > now() - interval '10 minutes'
  ) then
    return null;
  end if;
  insert into private.push_marks (member_id, kind, told_at) values (v_other, 'matched', now())
  on conflict (member_id, kind) do update set told_at = excluded.told_at;
  perform private.send_news(jsonb_build_object('type', 'matched', 'household_id', new.household_id, 'actor_id', new.member_id));
  return null;
exception when others then
  return null;
end
$$;

create trigger push_news after insert or update on public.leanings
  for each row execute function private.push_on_leaning();

-- The other minute job: whoever asked to be reminded to check in at this minute of the
-- room's clock (members.prefs: { "checkin": { "remind": true, "times": ["08:30", "21:00"] } })
-- is told, once, and nobody else is. The cloud cannot know whether they have checked in
-- already: what they note stays on their phone.
create function private.remind_checkins() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_clock constant text := to_char(now() at time zone 'Europe/Zurich', 'HH24:MI');
  v_minute constant timestamptz := date_trunc('minute', now());
  v_due record;
  v_count integer := 0;
begin
  for v_due in
    select m.id, m.household_id
    from public.members m
    where m.deleted_at is null and m.disabled_at is null
      and m.prefs #>> '{checkin,remind}' = 'true'
      and v_clock in (m.prefs #>> '{checkin,times,0}', m.prefs #>> '{checkin,times,1}')
      and not exists (
        select 1 from private.push_marks k
        where k.member_id = m.id and k.kind = 'checkin' and k.told_at >= v_minute
      )
  loop
    insert into private.push_marks (member_id, kind, told_at) values (v_due.id, 'checkin', now())
    on conflict (member_id, kind) do update set told_at = excluded.told_at;
    v_count := v_count + 1;
    begin
      perform private.send_news(jsonb_build_object('type', 'checkin', 'household_id', v_due.household_id, 'actor_id', v_due.id));
    exception when others then
      null;
    end;
  end loop;
  return v_count;
end
$$;

select cron.schedule('whisperus-remind-checkins', '* * * * *', $job$ select private.remind_checkins() $job$);

-- ---------------------------------------------------------------- grants ----

-- Nothing in the private schema is callable from outside, except the helpers that
-- policies and sync_pull run with the caller's rights.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_household_ids() to authenticated;
grant execute on function private.my_member_ids() to authenticated;
grant execute on function private.seat_state() to authenticated;
grant execute on function private.i_lean(text) to authenticated;
