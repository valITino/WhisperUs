-- WhisperUs: envelopes, their keys, and sealed files.
--
-- An envelope is something one of the two sealed for the other. Three tables:
--
--   envelopes  The outside: who sealed it, a line on the outside, when it opens, what
--              its author hopes for in return. Both read it at once. The inside is in
--              "layers" (how it felt, the words, the voice): each layer is encrypted on
--              the author's phone with a key of its own. The database never sees inside.
--   keys       The key to one layer. This is the seal: the cloud hands a key to the
--              other person from its opening time on, never earlier. A layer the author
--              opens "by hand" has no row here until that moment; neither the layer nor
--              its key has left the author's phone before.
--   media      A sealed file (the sound of a voice note). The bytes live in storage,
--              encrypted with the layer's key.
--
-- Who may write what:
--   * Only the author creates, changes and takes back an envelope, hands out its keys
--     and attaches files.
--   * The other person may write exactly two things on an envelope: which layers they
--     have opened ("seen", only ever adding) and their answer ("reply").
--   * A key that is out stays out: its time cannot be moved once it has come.
--   * An envelope that opens once ("keep" = 'once'): what the other one has opened is
--     burned here at that moment. The sealed layer goes, the key is emptied, the file
--     is marked gone.
--   * Taking an envelope back burns everything in it, and wipes its outside and its answer.
--
-- The same rules live in the pretend cloud (src/data/fake/cloudCore.ts). Keep the two in step.

-- ---------------------------------------------------------------- tables ----

create table public.envelopes (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  author_id uuid not null references public.members (id) on delete cascade,
  kind text not null default 'confession' check (kind in ('confession')),
  -- A line on the outside, readable while sealed.
  teaser text check (teaser is null or char_length(teaser) <= 120),
  heat_outside smallint check (heat_outside between 1 and 5),
  -- What the author hopes for: just listen, tell me what it did to you, let us talk.
  wants text not null default 'listen' check (wants in ('listen', 'react', 'talk')),
  keep text not null default 'keep' check (keep in ('keep', 'once')),
  open_mode text not null default 'hand' check (open_mode in ('now', 'at', 'hand')),
  opens_at timestamptz,
  -- { "feel": { "iv": "...", "box": "..." }, "words": {...}, "voice": {...} }: sealed, unreadable here.
  layers jsonb not null default '{}'::jsonb check (jsonb_typeof(layers) = 'object' and octet_length(layers::text) <= 80000),
  -- { "words": "2026-11-13T21:03:11Z" }: when the other one first opened each layer.
  seen jsonb not null default '{}'::jsonb check (jsonb_typeof(seen) = 'object' and octet_length(seen::text) <= 400),
  reply jsonb check (reply is null or (jsonb_typeof(reply) = 'object' and octet_length(reply::text) <= 8000)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.keys (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  envelope_id uuid not null references public.envelopes (id) on delete cascade,
  author_id uuid not null references public.members (id) on delete cascade,
  layer text not null check (layer in ('feel', 'words', 'voice')),
  -- The layer's AES-256 key, base64. Emptied when the layer is burned.
  key text not null check (char_length(key) <= 100),
  -- From this moment the other person may fetch it.
  opens_at timestamptz not null,
  -- Server only: when the opening was announced (a notification). Never sent to phones.
  announced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
-- One key per layer, whatever happens on two devices at once.
create unique index keys_envelope_layer_key on public.keys (envelope_id, layer);

create table public.media (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  envelope_id uuid not null references public.envelopes (id) on delete cascade,
  author_id uuid not null references public.members (id) on delete cascade,
  kind text not null default 'voice' check (kind in ('voice')),
  bytes integer check (bytes between 1 and 10485760),
  -- True once the sealed bytes are in storage at  media/<household_id>/<id>.bin
  uploaded boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index envelopes_household_updated_idx on public.envelopes (household_id, updated_at);
create index keys_household_updated_idx on public.keys (household_id, updated_at);
create index keys_due_idx on public.keys (opens_at) where announced_at is null;
create index media_household_updated_idx on public.media (household_id, updated_at);
create index media_envelope_idx on public.media (envelope_id);

-- ---------------------------------------------------------------- guards ----

-- Burn layers of an envelope: their keys become useless, a sealed sound is marked gone.
-- Called only from the envelope's guard below.
create function private.burn_layers(p_envelope uuid, p_layers text[]) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.keys
  set key = '', deleted_at = coalesce(deleted_at, now())
  where envelope_id = p_envelope and layer = any (p_layers) and key <> '';
  if 'voice' = any (p_layers) then
    update public.media set deleted_at = now()
    where envelope_id = p_envelope and deleted_at is null;
  end if;
end
$$;

create function private.only_layers(p_value jsonb) returns jsonb
language sql immutable set search_path = ''
as $$
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
  from jsonb_each(coalesce(p_value, '{}'::jsonb)) e
  where e.key in ('feel', 'words', 'voice') and e.value <> 'null'::jsonb
$$;

-- The author owns the envelope; the other one owns "seen" and the answer.
create function private.guard_envelope() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me uuid;
  v_opened text[];
begin
  -- A change made outside the app (the SQL editor, a job) is the owner's own business.
  if v_uid is null then
    return new;
  end if;
  select d.member_id into v_me from private.member_devices d where d.user_id = v_uid;

  if tg_op = 'INSERT' then
    if v_me is null or new.author_id is distinct from v_me then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.seen := '{}'::jsonb;
    new.reply := null;
  else
    new.author_id := old.author_id;
    new.kind := old.kind;
    if v_me is not distinct from old.author_id then
      -- The author cannot speak for the other one.
      new.seen := old.seen;
      new.reply := old.reply;
    else
      -- The other one may only say what they opened, and answer.
      new.teaser := old.teaser;
      new.heat_outside := old.heat_outside;
      new.wants := old.wants;
      new.keep := old.keep;
      new.open_mode := old.open_mode;
      new.opens_at := old.opens_at;
      new.layers := old.layers;
      new.deleted_at := old.deleted_at;
      -- What was opened stays opened, at the time it was first said.
      new.seen := private.only_layers(new.seen) || old.seen;
    end if;
  end if;
  new.layers := private.only_layers(new.layers);

  if new.deleted_at is not null then
    -- Taken back: the cloud forgets what was inside, what stood on the outside and what
    -- was answered. An empty shell stays, so that both phones learn it is gone.
    new.layers := '{}'::jsonb;
    new.teaser := null;
    new.heat_outside := null;
    new.reply := null;
    perform private.burn_layers(new.id, array['feel', 'words', 'voice']);
  elsif new.keep = 'once' then
    -- One opening: what the other one has opened is gone.
    select coalesce(array_agg(k), '{}') into v_opened from jsonb_object_keys(new.seen) k;
    if cardinality(v_opened) > 0 then
      new.layers := new.layers - v_opened;
      perform private.burn_layers(new.id, v_opened);
    end if;
  end if;
  return new;
end
$$;

-- Only the author hands out keys, one per layer, and a key that is out stays out.
create function private.guard_key() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me uuid;
begin
  -- Changes from inside the database (a burn, the minute job, the owner) pass.
  if v_uid is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  select d.member_id into v_me from private.member_devices d where d.user_id = v_uid;

  if tg_op = 'INSERT' then
    if v_me is null or not exists (
      select 1 from public.envelopes e
      where e.id = new.envelope_id and e.household_id = new.household_id
        and e.author_id = v_me and e.deleted_at is null
    ) then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    if coalesce(new.key, '') = '' then
      raise exception 'key_invalid' using errcode = 'P0001';
    end if;
    new.author_id := v_me;
    new.deleted_at := null;
    new.announced_at := null;
  else
    if old.author_id is distinct from v_me then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.envelope_id := old.envelope_id;
    new.author_id := old.author_id;
    new.layer := old.layer;
    new.key := old.key;
    new.deleted_at := old.deleted_at;
    new.announced_at := old.announced_at;
    -- Only the opening time may change, and only while it has not come.
    if old.opens_at <= now() or old.deleted_at is not null then
      new.opens_at := old.opens_at;
    end if;
  end if;
  return new;
end
$$;

-- A sealed file belongs to its author's envelope.
create function private.guard_media() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me uuid;
begin
  if v_uid is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  select d.member_id into v_me from private.member_devices d where d.user_id = v_uid;

  if tg_op = 'INSERT' then
    if v_me is null or not exists (
      select 1 from public.envelopes e
      where e.id = new.envelope_id and e.household_id = new.household_id and e.author_id = v_me
    ) then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.author_id := v_me;
  else
    if old.author_id is distinct from v_me then
      raise exception 'forbidden' using errcode = 'P0001';
    end if;
    new.envelope_id := old.envelope_id;
    new.author_id := old.author_id;
    new.kind := old.kind;
    -- A file that is gone stays gone.
    new.deleted_at := coalesce(old.deleted_at, new.deleted_at);
  end if;
  return new;
end
$$;

-- (Triggers on one table fire in the order of their names: guard, then touch.)
create trigger guard before insert or update on public.envelopes
  for each row execute function private.guard_envelope();
create trigger guard before insert or update on public.keys
  for each row execute function private.guard_key();
create trigger guard before insert or update on public.media
  for each row execute function private.guard_media();

create trigger touch before insert or update on public.envelopes
  for each row execute function private.touch_row();
create trigger touch before insert or update on public.keys
  for each row execute function private.touch_row();
create trigger touch before insert or update on public.media
  for each row execute function private.touch_row();

-- ------------------------------------------------------------------- RLS ----
-- There is no delete policy anywhere: rows are soft-deleted through deleted_at.

alter table public.envelopes enable row level security;
revoke all on public.envelopes from anon, authenticated;
grant select, insert, update on public.envelopes to authenticated;
create policy "room members read" on public.envelopes for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy "authors add" on public.envelopes for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()));
-- Both may update; the guard decides which columns each of them really changes.
create policy "room members edit" on public.envelopes for update to authenticated
  using (household_id in (select private.my_household_ids()))
  with check (household_id in (select private.my_household_ids()));

-- The seal. The author always sees their keys. The other person sees a key from its
-- opening time on, and never one that was burned.
alter table public.keys enable row level security;
revoke all on public.keys from anon, authenticated;
grant select, insert, update on public.keys to authenticated;
create policy "authors always, the other one when it is time" on public.keys for select to authenticated
  using (
    household_id in (select private.my_household_ids())
    and (
      author_id in (select private.my_member_ids())
      or (opens_at <= now() and deleted_at is null)
    )
  );
create policy "authors add" on public.keys for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()));
create policy "authors edit" on public.keys for update to authenticated
  using (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()))
  with check (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()));

alter table public.media enable row level security;
revoke all on public.media from anon, authenticated;
grant select, insert, update on public.media to authenticated;
create policy "room members read" on public.media for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy "authors add" on public.media for insert to authenticated
  with check (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()));
create policy "authors edit" on public.media for update to authenticated
  using (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()))
  with check (household_id in (select private.my_household_ids()) and author_id in (select private.my_member_ids()));

-- ------------------------------------------------------------------ sync ----

-- Everything that changed since the cursor, plus whether this device still has its seat.
-- Runs with the caller's rights, so row-level security decides what comes back.
-- A key that opened since the cursor counts as changed although its row did not: that
-- is how a phone receives a key at its opening time.
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
              where p_since is null or t.updated_at > p_since)
  )
$$;

revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_household_ids() to authenticated;
grant execute on function private.my_member_ids() to authenticated;
grant execute on function private.seat_state() to authenticated;

revoke all on function public.sync_pull(timestamptz) from public, anon;
grant execute on function public.sync_pull(timestamptz) to authenticated;

-- -------------------------------------------------------------- realtime ----

alter publication supabase_realtime add table public.envelopes;
alter publication supabase_realtime add table public.keys;
alter publication supabase_realtime add table public.media;

-- --------------------------------------------------------------- storage ----

-- Sealed files only: every object in here is encrypted on a phone before it arrives.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 10485760, array['application/octet-stream'])
on conflict (id) do nothing;

create policy "room members read media" on storage.objects for select to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select h::text from private.my_household_ids() h)
  );

create policy "room members add media" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select h::text from private.my_household_ids() h)
  );

create policy "room members replace media" on storage.objects for update to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select h::text from private.my_household_ids() h)
  )
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select h::text from private.my_household_ids() h)
  );

create policy "room members remove media" on storage.objects for delete to authenticated
  using (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (select h::text from private.my_household_ids() h)
  );
