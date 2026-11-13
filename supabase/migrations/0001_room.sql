-- WhisperUs: the room.
-- One room (household) with two seats. Everything else hangs off household_id.
--
--   * Each device signs in anonymously; that login is then tied to a person's profile
--     (private.member_devices). One profile can be logged in on several devices.
--   * Each person has a six-digit PIN. Name + PIN logs them in on any phone or tablet.
--   * Whoever opens the room is its admin. Only the admin invites, lets the partner
--     back in, pauses the partner's profile and logs them out everywhere.
--   * Wrong tries are counted per typed name, whether that name exists or not, so a
--     stranger cannot find out who lives here. Five wrong tries pause the name for
--     15 minutes, doubling each time, at most a day.
--   * Language, theme and the heat ceiling live on the profile (members.prefs).
--   * The project owner has a master key: run  select private.rescue_code('Name');
--     in the Supabase SQL editor.
--
-- Every synced table carries: id (client-generated uuid), household_id, created_at,
-- updated_at (server clock, used as the sync cursor) and deleted_at (soft delete).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- tables ----

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  avatar text not null default 'key',
  color text not null default 'moss',
  accessory text check (accessory is null or char_length(accessory) <= 24),
  status text check (status is null or char_length(status) <= 60),
  prefs jsonb not null default '{}'::jsonb check (octet_length(prefs::text) <= 2000),
  is_admin boolean not null default false,
  disabled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint members_name_not_blank check (btrim(name) <> '')
);

-- Names are how people log in, so two people in a room cannot share one.
create unique index members_household_name_key
  on public.members (household_id, lower(btrim(name)))
  where deleted_at is null;
create index members_household_updated_idx on public.members (household_id, updated_at);

-- Pairing codes. Only reachable through the functions below.
create table public.invites (
  code text primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  kind text not null default 'join' check (kind in ('join', 'restore')),
  member_id uuid references public.members (id) on delete cascade,
  created_by uuid references public.members (id) on delete set null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index invites_household_idx on public.invites (household_id);

-- Which profile each login (one per device) belongs to.
create table private.member_devices (
  user_id uuid primary key references auth.users (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index member_devices_member_idx on private.member_devices (member_id);

create table private.member_pins (
  member_id uuid primary key references public.members (id) on delete cascade,
  pin_hash text not null,
  updated_at timestamptz not null default now()
);

create table private.login_attempts (
  name_key text primary key,
  failed integer not null default 0,
  lockouts integer not null default 0,
  locked_until timestamptz,
  last_attempt timestamptz not null default now()
);

alter table private.member_devices enable row level security;
alter table private.member_pins enable row level security;
alter table private.login_attempts enable row level security;
revoke all on private.member_devices, private.member_pins, private.login_attempts from public, anon, authenticated;

-- --------------------------------------------------------------- helpers ----

-- A paused profile is in neither list, so every policy shuts it out at once.
create function private.my_household_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.household_id
  from private.member_devices d
  join public.members m on m.id = d.member_id
  where d.user_id = (select auth.uid()) and m.deleted_at is null and m.disabled_at is null
$$;

create function private.my_member_ids() returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select m.id
  from private.member_devices d
  join public.members m on m.id = d.member_id
  where d.user_id = (select auth.uid()) and m.deleted_at is null and m.disabled_at is null
$$;

-- Whether this device still has its seat: 'ok', 'paused' by the admin, or 'gone'.
create function private.seat_state() returns text
language sql stable security definer set search_path = ''
as $$
  select coalesce((
    select case when m.disabled_at is null then 'ok' else 'paused' end
    from private.member_devices d
    join public.members m on m.id = d.member_id
    where d.user_id = (select auth.uid()) and m.deleted_at is null
  ), 'gone')
$$;

-- Human-friendly random codes (no I, O, 0, 1).
create function private.random_code(p_length integer) returns text
language plpgsql volatile set search_path = ''
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := extensions.gen_random_bytes(p_length);
  result text := '';
begin
  for i in 0 .. p_length - 1 loop
    result := result || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return result;
end
$$;

create function private.name_key(p_name text) returns text
language sql immutable set search_path = ''
as $$
  select lower(btrim(coalesce(p_name, '')))
$$;

-- Null when the PIN is fine. The app checks the same rules (src/data/pin.ts).
create function private.pin_problem(p_pin text) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_pin is null or p_pin !~ '^[0-9]{6}$' then 'pin_invalid'
    when p_pin ~ '^([0-9])\1{5}$' or p_pin ~ '^([0-9][0-9])\1\1$' or p_pin ~ '^([0-9]{3})\1$' then 'pin_too_simple'
    when position(p_pin in '01234567890123456789') > 0 or position(p_pin in '98765432109876543210') > 0 then 'pin_too_simple'
    else null
  end
$$;

create function private.set_pin_for(p_member uuid, p_pin text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_problem text := private.pin_problem(p_pin);
begin
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;
  insert into private.member_pins (member_id, pin_hash)
  values (p_member, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)))
  on conflict (member_id) do update set pin_hash = excluded.pin_hash, updated_at = now();
end
$$;

create function private.add_member(
  p_household uuid, p_member jsonb, p_name text, p_avatar text, p_color text, p_admin boolean
) returns uuid
language sql security definer set search_path = ''
as $$
  insert into public.members (household_id, name, avatar, color, accessory, status, is_admin)
  values (
    p_household,
    left(coalesce(nullif(btrim(p_member ->> 'name'), ''), p_name), 40),
    coalesce(p_member ->> 'avatar', p_avatar),
    coalesce(p_member ->> 'color', p_color),
    nullif(p_member ->> 'accessory', ''),
    nullif(left(btrim(p_member ->> 'status'), 60), ''),
    p_admin
  )
  returning id
$$;

-- What a person looks like to someone holding a valid code.
create function private.person_card(p_member uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('name', m.name, 'avatar', m.avatar, 'color', m.color, 'accessory', m.accessory)
  from public.members m
  where m.id = p_member and m.deleted_at is null
$$;

-- The owner's master key, for when both people are locked out. It is not reachable
-- from the app: run it in the Supabase SQL editor and type the code on the start screen.
--   select private.rescue_code('Mia');
create function private.rescue_code(p_name text) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_member public.members;
  v_code text;
begin
  select * into v_member from public.members
  where deleted_at is null and private.name_key(name) = private.name_key(p_name)
  limit 1;
  if not found then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  v_code := private.random_code(10);
  insert into public.invites (code, household_id, kind, member_id, created_by, expires_at)
  values (v_code, v_member.household_id, 'restore', v_member.id, v_member.id, now() + interval '48 hours');
  return v_code;
end
$$;

-- Server clock is the sync cursor; identity columns never change.
create function private.touch_row() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.household_id := old.household_id;
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;

create function private.touch_household() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := clock_timestamp();
  if tg_op = 'UPDATE' then
    new.id := old.id;
    new.created_at := old.created_at;
  end if;
  return new;
end
$$;

-- ------------------------------------------------- triggers, RLS, grants ----

create trigger touch before insert or update on public.households
  for each row execute function private.touch_household();
create trigger touch before insert or update on public.members
  for each row execute function private.touch_row();

-- households: members read; members may rename and change shared settings.
alter table public.households enable row level security;
revoke all on public.households from anon, authenticated;
grant select on public.households to authenticated;
grant update (name, settings) on public.households to authenticated;
create policy "room members read" on public.households for select to authenticated
  using (id in (select private.my_household_ids()));
create policy "room members edit" on public.households for update to authenticated
  using (id in (select private.my_household_ids()))
  with check (id in (select private.my_household_ids()));

-- members: both see both profiles; each edits only their own profile fields.
-- Rows are created only by the pairing functions. is_admin and disabled_at get no
-- grant: they change only through the admin functions below.
alter table public.members enable row level security;
revoke all on public.members from anon, authenticated;
grant select on public.members to authenticated;
grant update (name, avatar, color, status, accessory, prefs) on public.members to authenticated;
create policy "room members read" on public.members for select to authenticated
  using (household_id in (select private.my_household_ids()));
create policy "edit own profile" on public.members for update to authenticated
  using (id in (select private.my_member_ids()))
  with check (id in (select private.my_member_ids()));

-- invites: no direct access at all.
alter table public.invites enable row level security;
revoke all on public.invites from anon, authenticated;

-- ------------------------------------------------------------- functions ----

-- Has somebody opened the room yet? Lets the app say so before a profile is filled in.
create function public.room_exists() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.households where deleted_at is null)
$$;

-- Open the room. There is exactly one per project, and whoever opens it is its admin.
-- Once it exists nobody else can open another, so a leaked public key is useless to strangers.
create function public.create_household(p_household_name text, p_member jsonb, p_pin text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_problem text := private.pin_problem(p_pin);
  v_household uuid;
  v_member uuid;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if exists (select 1 from private.member_devices where user_id = v_uid) then
    raise exception 'already_in_room' using errcode = 'P0001';
  end if;
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtext('whisperus.create_household'));
  if exists (select 1 from public.households where deleted_at is null) then
    raise exception 'room_already_exists' using errcode = 'P0001';
  end if;

  insert into public.households (name)
  values (coalesce(nullif(btrim(p_household_name), ''), 'Our room'))
  returning id into v_household;

  v_member := private.add_member(v_household, coalesce(p_member, '{}'::jsonb), 'One', 'moon', 'candle', true);

  perform private.set_pin_for(v_member, p_pin);
  insert into private.member_devices (user_id, member_id) values (v_uid, v_member);

  return jsonb_build_object('household_id', v_household, 'member_id', v_member);
end
$$;

-- A code from the admin. 'join' invites the second person. 'restore' lets the partner
-- back in without their PIN: they choose a new one.
create function public.create_invite(p_kind text default 'join', p_member_id uuid default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_me public.members;
  v_code text;
  v_expires timestamptz := now() + interval '48 hours';
begin
  select * into v_me from public.members where id in (select private.my_member_ids());
  if not found then
    raise exception 'not_in_room' using errcode = 'P0001';
  end if;
  if not v_me.is_admin then
    raise exception 'admin_only' using errcode = 'P0001';
  end if;
  if p_kind not in ('join', 'restore') then
    raise exception 'bad_invite_kind' using errcode = 'P0001';
  end if;

  if p_kind = 'join' then
    if (select count(*) from public.members where household_id = v_me.household_id and deleted_at is null) >= 2 then
      raise exception 'room_full' using errcode = 'P0001';
    end if;
    p_member_id := null;
  else
    if p_member_id = v_me.id then
      raise exception 'not_yourself' using errcode = 'P0001';
    end if;
    if not exists (
      select 1 from public.members
      where id = p_member_id and household_id = v_me.household_id and deleted_at is null
    ) then
      raise exception 'member_not_found' using errcode = 'P0001';
    end if;
  end if;

  delete from public.invites
  where household_id = v_me.household_id and (used_at is not null or expires_at < now());

  v_code := private.random_code(10);
  insert into public.invites (code, household_id, kind, member_id, created_by, expires_at)
  values (v_code, v_me.household_id, p_kind, p_member_id, v_me.id, v_expires);

  return jsonb_build_object('code', v_code, 'kind', p_kind, 'expires_at', v_expires);
end
$$;

-- Look at a code without using it: who invites, and into which room.
create function public.peek_invite(p_code text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_invite public.invites;
begin
  if auth.uid() is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  select * into v_invite
  from public.invites
  where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if not found or v_invite.used_at is not null or v_invite.expires_at < now() then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'kind', v_invite.kind,
    'room_name', (select h.name from public.households h where h.id = v_invite.household_id),
    'host', private.person_card(v_invite.created_by),
    'profile', case when v_invite.kind = 'restore' then private.person_card(v_invite.member_id) end
  );
end
$$;

-- Use a code. 'join' takes the second seat with the given profile and PIN. 'restore'
-- logs this device in as the existing profile, replaces its PIN and logs its other
-- devices out (one of them may be the lost phone).
create function public.join_household(p_code text, p_member jsonb, p_pin text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_problem text := private.pin_problem(p_pin);
  v_invite public.invites;
  v_member uuid;
  v_name text;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if exists (select 1 from private.member_devices where user_id = v_uid) then
    raise exception 'already_in_room' using errcode = 'P0001';
  end if;

  select * into v_invite
  from public.invites
  where code = upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
  for update;
  if not found or v_invite.used_at is not null or v_invite.expires_at < now() then
    raise exception 'invite_invalid' using errcode = 'P0001';
  end if;
  if v_problem is not null then
    raise exception '%', v_problem using errcode = 'P0001';
  end if;

  if v_invite.kind = 'join' then
    if (select count(*) from public.members where household_id = v_invite.household_id and deleted_at is null) >= 2 then
      raise exception 'room_full' using errcode = 'P0001';
    end if;
    if exists (
      select 1 from public.members
      where household_id = v_invite.household_id and deleted_at is null
        and private.name_key(name) = coalesce(nullif(private.name_key(p_member ->> 'name'), ''), 'two')
    ) then
      raise exception 'name_taken' using errcode = 'P0001';
    end if;
    v_member := private.add_member(v_invite.household_id, coalesce(p_member, '{}'::jsonb), 'Two', 'key', 'moss', false);
  else
    select id, name into v_member, v_name from public.members
    where id = v_invite.member_id and deleted_at is null;
    if v_member is null then
      raise exception 'member_not_found' using errcode = 'P0001';
    end if;
    delete from private.login_attempts where name_key = left(private.name_key(v_name), 40);
    delete from private.member_devices where member_id = v_member;
  end if;

  perform private.set_pin_for(v_member, p_pin);
  insert into private.member_devices (user_id, member_id) values (v_uid, v_member);
  update public.invites set used_at = now() where code = v_invite.code;

  return jsonb_build_object(
    'household_id', v_invite.household_id,
    'member_id', v_member,
    'kind', v_invite.kind
  );
end
$$;

-- Log this device in as an existing person. A wrong PIN is an answer, not an error:
-- an error would roll back the count of wrong tries.
create function public.sign_in_with_pin(p_name text, p_pin text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_key text := left(private.name_key(p_name), 40);
  v_try private.login_attempts;
  v_member public.members;
  v_until timestamptz;
begin
  if v_uid is null then
    raise exception 'not_signed_in' using errcode = '28000';
  end if;
  if exists (select 1 from private.member_devices where user_id = v_uid) then
    raise exception 'already_in_room' using errcode = 'P0001';
  end if;

  -- One row per typed name, locked while we look, so parallel guesses queue up.
  insert into private.login_attempts (name_key) values (v_key) on conflict (name_key) do nothing;
  select * into v_try from private.login_attempts where name_key = v_key for update;

  if v_try.locked_until is not null and v_try.locked_until > now() then
    return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_at', v_try.locked_until);
  end if;

  select m.* into v_member
  from public.members m
  join private.member_pins p on p.member_id = m.id
  where m.deleted_at is null
    and private.name_key(m.name) = v_key
    and p.pin_hash = extensions.crypt(coalesce(p_pin, ''), p.pin_hash)
  limit 1;

  if not found then
    -- A name nobody has costs the same time as a wrong PIN, and gets the same answer.
    if not exists (
      select 1 from public.members m
      join private.member_pins p on p.member_id = m.id
      where m.deleted_at is null and private.name_key(m.name) = v_key
    ) then
      perform extensions.crypt(coalesce(p_pin, ''), extensions.gen_salt('bf', 8));
    end if;

    if v_try.failed + 1 >= 5 then
      v_until := now() + make_interval(mins => least(15 * (2 ^ least(v_try.lockouts, 10))::integer, 1440));
      update private.login_attempts
      set failed = 0, lockouts = v_try.lockouts + 1, locked_until = v_until, last_attempt = now()
      where name_key = v_key;
      return jsonb_build_object('ok', false, 'reason', 'locked', 'retry_at', v_until);
    end if;

    update private.login_attempts set failed = v_try.failed + 1, last_attempt = now() where name_key = v_key;
    return jsonb_build_object('ok', false, 'reason', 'wrong', 'tries_left', 5 - (v_try.failed + 1));
  end if;

  delete from private.login_attempts where name_key = v_key;
  if v_member.disabled_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'paused');
  end if;

  insert into private.member_devices (user_id, member_id) values (v_uid, v_member.id);
  return jsonb_build_object('ok', true, 'household_id', v_member.household_id, 'member_id', v_member.id);
end
$$;

-- Replace my PIN.
create function public.set_pin(p_pin text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_me public.members;
begin
  select * into v_me from public.members where id in (select private.my_member_ids());
  if not found then
    raise exception 'not_in_room' using errcode = 'P0001';
  end if;
  perform private.set_pin_for(v_me.id, p_pin);
  delete from private.login_attempts where name_key = left(private.name_key(v_me.name), 40);
end
$$;

-- Log this device out.
create function public.sign_out_device() returns void
language sql security definer set search_path = ''
as $$
  delete from private.member_devices where user_id = (select auth.uid())
$$;

-- Log every other device out of my profile. Returns how many there were.
create function public.sign_out_other_devices() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_me uuid;
  v_count integer;
begin
  select id into v_me from public.members where id in (select private.my_member_ids());
  if v_me is null then
    raise exception 'not_in_room' using errcode = 'P0001';
  end if;
  delete from private.member_devices where member_id = v_me and user_id <> auth.uid();
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- The admin's partner, or an error. Shared by the two admin functions below.
create function private.partner_for_admin(p_member_id uuid) returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_me public.members;
begin
  select * into v_me from public.members where id in (select private.my_member_ids());
  if not found then
    raise exception 'not_in_room' using errcode = 'P0001';
  end if;
  if not v_me.is_admin then
    raise exception 'admin_only' using errcode = 'P0001';
  end if;
  if p_member_id = v_me.id then
    raise exception 'not_yourself' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.members
    where id = p_member_id and household_id = v_me.household_id and deleted_at is null
  ) then
    raise exception 'member_not_found' using errcode = 'P0001';
  end if;
  return p_member_id;
end
$$;

-- Admin only: pause the partner's profile (no log-in, no reading, no writing; nothing
-- is deleted), or switch it on again.
create function public.set_member_paused(p_member_id uuid, p_paused boolean) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_partner uuid := private.partner_for_admin(p_member_id);
begin
  update public.members
  set disabled_at = case when p_paused then now() else null end
  where id = v_partner and (disabled_at is not null) is distinct from coalesce(p_paused, false);
end
$$;

-- Admin only: log the partner out on all their devices. Returns how many there were.
create function public.sign_out_member(p_member_id uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_partner uuid := private.partner_for_admin(p_member_id);
  v_count integer;
begin
  delete from private.member_devices where member_id = v_partner;
  get diagnostics v_count = row_count;
  return v_count;
end
$$;

-- Who am I in this room? Null when this device is not logged in.
create function public.my_membership() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'household_id', m.household_id,
    'member_id', m.id,
    'paused', m.disabled_at is not null
  )
  from private.member_devices d
  join public.members m on m.id = d.member_id
  where d.user_id = (select auth.uid()) and m.deleted_at is null
  limit 1
$$;

-- Everything that changed since the cursor, plus whether this device still has its seat.
-- Runs with the caller's rights, so row-level security decides what comes back.
-- (0002_envelopes.sql replaces it with the version that knows envelopes.)
create function public.sync_pull(p_since timestamptz default null) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'server_time', now(),
    'seat', private.seat_state(),
    'households', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.households t
                   where p_since is null or t.updated_at > p_since),
    'members', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.members t
                where p_since is null or t.updated_at > p_since)
  )
$$;

-- Free Supabase projects pause after about a week without activity. Two pings call
-- this harmless function: a scheduled GitHub workflow, and a daily job in here.
-- It reveals nothing but the server's clock.
create function public.ping() returns timestamptz
language sql stable security invoker set search_path = ''
as $$ select now() $$;

-- ---------------------------------------------------------------- grants ----

-- Nothing in the private schema is callable from outside, except the three helpers
-- that policies and sync_pull run with the caller's rights.
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.my_household_ids() to authenticated;
grant execute on function private.my_member_ids() to authenticated;
grant execute on function private.seat_state() to authenticated;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.room_exists()',
    'public.create_household(text, jsonb, text)',
    'public.create_invite(text, uuid)',
    'public.peek_invite(text)',
    'public.join_household(text, jsonb, text)',
    'public.sign_in_with_pin(text, text)',
    'public.set_pin(text)',
    'public.sign_out_device()',
    'public.sign_out_other_devices()',
    'public.set_member_paused(uuid, boolean)',
    'public.sign_out_member(uuid)',
    'public.sync_pull(timestamptz)',
    'public.my_membership()'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end
$$;

revoke all on function public.ping() from public;
grant execute on function public.ping() to anon, authenticated;

-- -------------------------------------------------------------- realtime ----

alter publication supabase_realtime add table public.households;
alter publication supabase_realtime add table public.members;

-- ----------------------------------------------------------- housekeeping ----

-- The app signs devices in anonymously, so anyone who finds the public key could
-- create empty logins. They can read and write nothing, and this nightly job sweeps
-- away logins that belong to no profile, and old wrong-try counters.
select cron.schedule(
  'whisperus-purge-stray-logins',
  '17 3 * * *',
  $job$
    delete from auth.users u
    where u.is_anonymous
      and u.created_at < now() - interval '2 days'
      and not exists (select 1 from private.member_devices d where d.user_id = u.id);
    delete from private.login_attempts
    where last_attempt < now() - interval '2 days'
      and (locked_until is null or locked_until < now());
  $job$
);

-- The keep-alive from inside: once a day the database calls its own public API with
-- the publishable key (public by design). Where that API lives is told once, from the
-- SQL editor:
--   select private.keepalive_setup('https://<ref>.supabase.co', '<publishable key>');
-- Until then the job does nothing.
create table private.keepalive (
  only_row boolean primary key default true check (only_row),
  api_url text not null check (api_url ~ '^https://'),
  api_key text not null
);
alter table private.keepalive enable row level security;
revoke all on private.keepalive from public, anon, authenticated;

create function private.keepalive_setup(p_api_url text, p_api_key text) returns void
language sql security definer set search_path = ''
as $$
  insert into private.keepalive (api_url, api_key) values (rtrim(p_api_url, '/'), p_api_key)
  on conflict (only_row) do update set api_url = excluded.api_url, api_key = excluded.api_key
$$;

create function private.keepalive_ping() returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_config private.keepalive;
begin
  select * into v_config from private.keepalive;
  if not found then
    return;
  end if;
  perform net.http_post(
    url := v_config.api_url || '/rest/v1/rpc/ping',
    headers := jsonb_build_object('apikey', v_config.api_key, 'Content-Type', 'application/json'),
    body := '{}'::jsonb
  );
end
$$;

revoke all on function private.keepalive_setup(text, text) from public, anon, authenticated;
revoke all on function private.keepalive_ping() from public, anon, authenticated;

select cron.schedule('whisperus-keepalive', '41 4 * * *', $job$ select private.keepalive_ping() $job$);
