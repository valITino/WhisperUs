-- WhisperUs: push notifications.
--
-- Three things are worth telling the other person about:
--   sealed     something was sealed for you and waits (for its time, or its author's hand)
--   opened     something opened for you: by hand, at once, or because its time has come
--   answered   the other one answered an envelope you opened for them
--
-- A notification shows on a lock screen. It never carries what is inside an envelope,
-- nor the line on its outside: the push function is only told which envelope, and what
-- kind of news.
--
-- How it travels: a trigger notices the change and asks pg_net to call the Edge Function
-- "push" (supabase/functions/push) once the change is committed. The function works out
-- who should hear about it and sends the notifications. An envelope whose time has come
-- is noticed by a job that looks once a minute, because nobody does anything at that moment.
--
-- Nobody ever copies a secret anywhere. Everything the function needs to know lives in
-- one row of private.push_config, which the API cannot read: where the function is, the
-- shared secret the triggers send along (made here, in the database), and the VAPID key
-- pair that signs the messages (made by the function the first time it is asked, and
-- stored here). The function itself only has what Supabase gives every function: the
-- project's address and the service role key, with which it fetches the rest.
-- While the row is missing the triggers do nothing, so this migration is safe to apply
-- before the function exists. To switch notifications on, follow
-- supabase/functions/push/README.md: it is three statements.
--
-- Every subscription is tied to the login (device) that made it. The app manages its own
-- through three functions, and a device that is logged out, by itself, by the admin or by
-- a restore code, stops getting notifications at once.

-- ------------------------------------------------------------ subscriptions ----

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  user_id uuid references auth.users (id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  muted_types text[] not null default '{}',
  user_agent text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_muted_known check (muted_types <@ array['sealed', 'opened', 'answered'])
);
create index push_subscriptions_member_idx on public.push_subscriptions (member_id);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);
create trigger touch before insert or update on public.push_subscriptions
  for each row execute function private.touch_row();

-- The app reaches this table only through the functions below. The push function reads
-- it with the service role.
alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;

-- Everything the push function needs to know. One row at most.
create table private.push_config (
  only_row boolean primary key default true check (only_row),
  -- Where the function lives.
  function_url text not null check (function_url ~ '^https://'),
  -- Sent along by the triggers; the function refuses calls without it.
  secret text not null check (char_length(secret) >= 32),
  -- Whom a push service may contact about our messages: an https address.
  subject text not null check (subject ~ '^https://'),
  -- The VAPID key pair, base64url. Empty until the function has made it.
  vapid_public text check (vapid_public ~ '^[A-Za-z0-9_-]{87}$'),
  vapid_private text check (vapid_private ~ '^[A-Za-z0-9_-]{43}$'),
  updated_at timestamptz not null default now(),
  check ((vapid_public is null) = (vapid_private is null))
);
alter table private.push_config enable row level security;
revoke all on private.push_config from public, anon, authenticated;

-- --------------------------------------------------------------- helpers ----

-- Only kinds of notification that exist, each once.
create function private.push_types(p_types text[]) returns text[]
language sql immutable set search_path = ''
as $$
  select coalesce(array_agg(known.kind order by known.place), '{}')
  from unnest(array['sealed', 'opened', 'answered']) with ordinality as known (kind, place)
  where known.kind = any (coalesce(p_types, '{}'))
$$;

-- Hand one event to the push function. Does nothing until private.push_config has its row.
-- p_actor is the member who did it: they are never told about it themselves.
create function private.send_push(p_type text, p_household uuid, p_actor uuid, p_envelope uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_config private.push_config;
begin
  if p_actor is null then
    return;
  end if;
  select * into v_config from private.push_config;
  if not found then
    return;
  end if;
  -- pg_net sends after this transaction has committed, so the function sees the change.
  perform net.http_post(
    url := v_config.function_url,
    body := jsonb_build_object('type', p_type, 'household_id', p_household, 'actor_id', p_actor, 'envelope_id', p_envelope),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_config.secret),
    timeout_milliseconds := 8000
  );
end
$$;

-- -------------------------------------------------------------- triggers ----

-- A notification is a nicety: whatever goes wrong in here, the write itself goes through.
-- The same rules live in supabase/functions/push/logic.ts (envelopeEvent, keyEvent),
-- which the pretend cloud uses. Keep the two in step.

-- A new envelope that waits is "sealed". The first answer is "answered". A change made
-- outside the app (the SQL editor, a job) has nobody to name and is not announced.
create function private.push_on_envelope() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if new.deleted_at is not null then
    return null;
  end if;
  select d.member_id into v_actor from private.member_devices d where d.user_id = (select auth.uid());
  if v_actor is null then
    return null;
  end if;
  if tg_op = 'INSERT' then
    -- One that opens at once says nothing here: its key arriving is the news.
    if new.open_mode <> 'now' then
      perform private.send_push('sealed', new.household_id, v_actor, new.id);
    end if;
  elsif old.reply is null and new.reply is not null then
    perform private.send_push('answered', new.household_id, v_actor, new.id);
  end if;
  return null;
exception when others then
  return null;
end
$$;

create trigger push_news after insert or update on public.envelopes
  for each row execute function private.push_on_envelope();

-- A key that is out and has not been announced: this is an opening. Several layers
-- opening together are one opening, so only the first key of a moment is announced.
-- Runs before the row is written because it notes the announcement on the row itself;
-- by its name it comes after "guard" and before "touch".
create function private.push_on_key() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.announced_at is not null or new.deleted_at is not null or new.key = '' or new.opens_at > now() then
    return new;
  end if;
  new.announced_at := now();
  begin
    if not exists (
      select 1 from public.keys k
      where k.envelope_id = new.envelope_id and k.id <> new.id
        and k.announced_at > now() - interval '10 seconds'
    ) then
      perform private.send_push('opened', new.household_id, new.author_id, new.envelope_id);
    end if;
  exception when others then
    null;
  end;
  return new;
end
$$;

create trigger push_news before insert or update on public.keys
  for each row execute function private.push_on_key();

-- The minute job: envelopes whose time has come. Marking the keys also changes their
-- rows, which is what wakes the other person's open app at that very moment.
create function private.announce_due() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_due record;
  v_count integer := 0;
begin
  for v_due in
    with due as (
      update public.keys k
      set announced_at = now()
      where k.announced_at is null and k.deleted_at is null and k.key <> '' and k.opens_at <= now()
      returning k.household_id, k.envelope_id, k.author_id
    )
    select distinct household_id, envelope_id, author_id from due
  loop
    v_count := v_count + 1;
    begin
      perform private.send_push('opened', v_due.household_id, v_due.author_id, v_due.envelope_id);
    exception when others then
      null;
    end;
  end loop;
  return v_count;
end
$$;

select cron.schedule('whisperus-announce-due', '* * * * *', $job$ select private.announce_due() $job$);

-- pg_cron notes every run. With a job every minute that adds up, so the notes of
-- finished runs are swept nightly.
select cron.schedule(
  'whisperus-sweep-job-notes',
  '29 3 * * *',
  $job$ delete from cron.job_run_details where end_time < now() - interval '2 days' $job$
);

-- A device that is logged out gets no more notifications. This covers every way out:
-- logging out, "log out my other devices", the admin's "log out everywhere", a restore
-- code, and the nightly sweep of stray logins.
create function private.drop_device_pushes() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.push_subscriptions where user_id = old.user_id;
  return null;
end
$$;

create trigger drop_pushes after delete on private.member_devices
  for each row execute function private.drop_device_pushes();

-- ---------------------------------------------------------------- set-up ----

-- Switch notifications on, or change where the function lives. Run once from the SQL
-- editor (it is not reachable from the app):
--   select private.push_setup('https://<ref>.supabase.co/functions/v1/push', 'https://<where the app lives>/');
-- The shared secret is made here the first time and never shown or returned. Running
-- this again keeps the secret and the keys.
create function private.push_setup(p_function_url text, p_subject text) returns void
language sql security definer set search_path = ''
as $$
  insert into private.push_config (function_url, secret, subject)
  values (p_function_url, encode(extensions.gen_random_bytes(32), 'hex'), p_subject)
  on conflict (only_row) do update
  set function_url = excluded.function_url, subject = excluded.subject, updated_at = now()
$$;

-- A new shared secret, should the old one ever have been seen. The function notices by
-- itself. Does nothing while notifications are not set up.
create function private.push_new_secret() returns void
language sql security definer set search_path = ''
as $$
  update private.push_config
  set secret = encode(extensions.gen_random_bytes(32), 'hex'), updated_at = now()
$$;

-- Throw the VAPID keys away. The function makes new ones the next time it is asked to
-- (README: "New keys"), and every device signs up again by itself when the app is opened.
create function private.push_forget_keys() returns void
language sql security definer set search_path = ''
as $$
  update private.push_config
  set vapid_public = null, vapid_private = null, updated_at = now()
$$;

-- For the app: the public half of the key pair, which a browser needs to sign up.
-- Null while notifications are not set up. It is public by nature.
create function public.push_public_key() returns text
language sql stable security definer set search_path = ''
as $$
  select vapid_public from private.push_config
$$;

-- For the push function alone (service role): everything it needs. Null without a row.
create function public.push_settings() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'secret', secret, 'subject', subject,
    'vapid_public', vapid_public, 'vapid_private', vapid_private
  )
  from private.push_config
$$;

-- For the push function alone: keep the key pair it just made, unless there is one
-- already. Answers with the pair that is stored afterwards, so two first calls at the
-- same moment end up using the same one. Null without a row.
create function public.push_store_keys(p_public text, p_private text) returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if coalesce(p_public, '') !~ '^[A-Za-z0-9_-]{87}$' or coalesce(p_private, '') !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'push_invalid' using errcode = 'P0001';
  end if;
  update private.push_config
  set vapid_public = p_public, vapid_private = p_private, updated_at = now()
  where vapid_public is null;
  return (
    select jsonb_build_object('vapid_public', vapid_public, 'vapid_private', vapid_private)
    from private.push_config
  );
end
$$;

-- ------------------------------------------------------------- functions ----

-- Sign this device up for notifications, or replace what is known about it.
create function public.save_push_subscription(
  p_endpoint text, p_p256dh text, p_auth text, p_muted_types text[] default '{}', p_user_agent text default null
) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.members;
begin
  select * into v_me from public.members where id in (select private.my_member_ids());
  if not found then
    raise exception 'not_in_room' using errcode = 'P0001';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or char_length(p_endpoint) > 2000
     or coalesce(p_p256dh, '') = '' or char_length(p_p256dh) > 200
     or coalesce(p_auth, '') = '' or char_length(p_auth) > 100 then
    raise exception 'push_invalid' using errcode = 'P0001';
  end if;

  -- One row per device (the browser may have swapped its subscription for a new one),
  -- and one row per browser (whoever is logged in on it now owns it).
  delete from public.push_subscriptions
  where (user_id = v_uid and endpoint <> p_endpoint)
     or (endpoint = p_endpoint and member_id <> v_me.id);

  insert into public.push_subscriptions (household_id, member_id, user_id, endpoint, p256dh, auth, muted_types, user_agent)
  values (v_me.household_id, v_me.id, v_uid, p_endpoint, p_p256dh, p_auth, private.push_types(p_muted_types), left(p_user_agent, 300))
  on conflict (endpoint) do update
  set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
      muted_types = excluded.muted_types, user_agent = excluded.user_agent;
end
$$;

-- Change which kinds of notification a device of mine mutes.
create function public.set_push_muted(p_endpoint text, p_muted_types text[]) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from private.my_member_ids()) then
    raise exception 'not_in_room' using errcode = 'P0001';
  end if;
  update public.push_subscriptions
  set muted_types = private.push_types(p_muted_types)
  where endpoint = p_endpoint and member_id in (select private.my_member_ids());
  if not found then
    raise exception 'push_missing' using errcode = 'P0001';
  end if;
end
$$;

-- No more notifications for this device. Not an error when there was nothing to remove.
create function public.remove_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions
  where endpoint = p_endpoint
    and (user_id = (select auth.uid()) or member_id in (select private.my_member_ids()))
$$;

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
    'public.save_push_subscription(text, text, text, text[], text)',
    'public.set_push_muted(text, text[])',
    'public.remove_push_subscription(text)',
    'public.push_public_key()'
  ]
  loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;

  -- The secret and the private key: for the push function's service role and nobody else.
  foreach f in array array[
    'public.push_settings()',
    'public.push_store_keys(text, text)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end
$$;
