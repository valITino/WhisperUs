-- Test for push notifications in the database (0003_push.sql): which changes call the
-- push function, that nothing else does, that the call never carries what is written in
-- or on an envelope, that a write never fails because of it, who may manage which
-- device's subscription, and who can get at the secret and the keys.
--
-- Run it in the Supabase SQL editor, or locally with supabase/tests/local/run.sh push.
-- It builds a throwaway second room with three throwaway logins, plays through the
-- three events, then ROLLS EVERYTHING BACK by ending with an exception whose message is
-- the report. "FAIL" lines mean something is wrong.
--
-- Safe next to a real room: it touches only its own rows, and nothing is ever sent.
-- pg_net delivers after a commit, and this never commits. While it runs it points the
-- push settings at an address that does not exist; the rollback restores the real ones,
-- secret and keys included.

do $$
declare
  u1 uuid := gen_random_uuid(); -- Mia's phone
  u2 uuid := gen_random_uuid(); -- Leo's phone
  u3 uuid := gen_random_uuid(); -- Leo's tablet
  u4 uuid := gen_random_uuid(); -- a stranger
  hh uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  quiet uuid := gen_random_uuid();   -- sealed before notifications are set up
  waiting uuid := gen_random_uuid(); -- opens by hand
  timed uuid := gen_random_uuid();   -- opens at a time
  instant uuid := gen_random_uuid(); -- opens at once
  sealed constant jsonb := '{"iv":"AAAAAAAAAAAAAAAA","box":"c2VhbGVk"}';
  target constant text := 'https://push-test.invalid/functions/v1/push';
  v_subject constant text := 'https://push-test.invalid/app/';
  key_a constant text := 'B' || repeat('a', 86);  -- shaped like a public key
  key_a_private constant text := repeat('p', 43);
  key_b constant text := 'B' || repeat('b', 86);
  key_b_private constant text := repeat('q', 43);
  v_secret text;
  ep_phone constant text := 'https://push-test.invalid/send/leos-phone';
  ep_tablet constant text := 'https://push-test.invalid/send/leos-tablet';
  ep_new constant text := 'https://push-test.invalid/send/leos-phone-renewed';
  seen integer := 0;
  n integer;
  b boolean;
  txt text;
  target_now text;
  ev jsonb;
  hdr jsonb;
  report text[] := '{}';
begin
  insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) values
    (u1, 'authenticated', 'authenticated', true, now(), now()),
    (u2, 'authenticated', 'authenticated', true, now(), now()),
    (u3, 'authenticated', 'authenticated', true, now(), now()),
    (u4, 'authenticated', 'authenticated', true, now(), now());
  insert into public.households (id, name) values (hh, 'Push test room');
  insert into public.members (id, household_id, name, is_admin) values
    (m1, hh, 'Mia Pushtest', true),
    (m2, hh, 'Leo Pushtest', false);
  insert into private.member_devices (user_id, member_id) values (u1, m1), (u2, m2), (u3, m2);

  -- ---- without settings the triggers do nothing
  delete from private.push_config;
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  insert into public.envelopes (id, household_id, author_id, open_mode) values (quiet, hh, m1, 'hand');
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  select count(*) into seen from public.envelopes where id = quiet;
  report := report || format('%s 01 no settings row: the envelope is saved (%s) and nothing is sent (%s)', case when n = 0 and seen = 1 then 'ok  ' else 'FAIL' end, seen, n);

  -- ---- switching on: one statement, and the secret is made in the database
  perform private.push_setup(target, v_subject);
  select c.secret into v_secret from private.push_config c;
  report := report || format('%s 01b set-up makes its own secret (%s characters) and stores address and subject', case when char_length(v_secret) >= 32 and (select count(*) from private.push_config c where c.function_url = target and c.subject = v_subject) = 1 then 'ok  ' else 'FAIL' end, char_length(v_secret));
  seen := 0;

  -- ---- sealed: an envelope that waits
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  insert into public.envelopes (id, household_id, author_id, open_mode, teaser, heat_outside) values (waiting, hh, m1, 'hand', 'What I never dared to say', 5);
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  select convert_from(body, 'UTF8')::jsonb, headers into ev, hdr from net.http_request_queue where url = target order by id desc limit 1;
  report := report || format('%s 02 sealing calls the function once (%s) with type, room, actor and envelope, and nothing else (%s)',
    case when n = seen + 1 and ev = jsonb_build_object('type', 'sealed', 'household_id', hh, 'actor_id', m1, 'envelope_id', waiting) then 'ok  ' else 'FAIL' end, n - seen, ev ->> 'type');
  report := report || format('%s 03 the call carries the shared secret and is JSON', case when hdr ->> 'x-push-secret' = v_secret and hdr ->> 'Content-Type' = 'application/json' then 'ok  ' else 'FAIL' end);
  seen := n;

  -- ---- ordinary edits are not events
  execute 'set local role authenticated';
  update public.envelopes set teaser = 'Reworded', wants = 'talk', heat_outside = 3 where id = waiting;
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 04 rewording the outside sends nothing (%s)', case when n = seen then 'ok  ' else 'FAIL' end, n - seen);

  -- ---- opened by hand: two layers leave together, one opening
  execute 'set local role authenticated';
  update public.envelopes set layers = jsonb_build_object('feel', sealed, 'words', sealed) where id = waiting;
  insert into public.keys (household_id, envelope_id, author_id, layer, key, opens_at) values (hh, waiting, m1, 'feel', 'key-feel', now());
  insert into public.keys (household_id, envelope_id, author_id, layer, key, opens_at) values (hh, waiting, m1, 'words', 'key-words', now());
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  select convert_from(body, 'UTF8')::jsonb into ev from net.http_request_queue where url = target order by id desc limit 1;
  select count(*) filter (where announced_at is not null) into txt from public.keys where envelope_id = waiting;
  report := report || format('%s 05 opening two layers by hand sends "opened" once, from the author (%s, %s), and notes it on both keys (%s)',
    case when n = seen + 1 and ev = jsonb_build_object('type', 'opened', 'household_id', hh, 'actor_id', m1, 'envelope_id', waiting) and txt = '2' then 'ok  ' else 'FAIL' end, n - seen, ev ->> 'type', txt);
  seen := n;

  -- ---- opening at once: the envelope says nothing, its key does
  execute 'set local role authenticated';
  insert into public.envelopes (id, household_id, author_id, open_mode, layers) values (instant, hh, m1, 'now', jsonb_build_object('words', sealed));
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 06 an envelope that opens at once is not announced as "sealed" (%s)', case when n = seen then 'ok  ' else 'FAIL' end, n - seen);
  execute 'set local role authenticated';
  insert into public.keys (household_id, envelope_id, author_id, layer, key, opens_at) values (hh, instant, m1, 'words', 'key-instant', now());
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  select convert_from(body, 'UTF8')::jsonb into ev from net.http_request_queue where url = target order by id desc limit 1;
  report := report || format('%s 07 its key arriving is the news: "opened" once (%s, %s)', case when n = seen + 1 and ev ->> 'type' = 'opened' and (ev ->> 'envelope_id')::uuid = instant then 'ok  ' else 'FAIL' end, n - seen, ev ->> 'type');
  seen := n;

  -- ---- a time: "sealed" now, "opened" when the minute job finds it
  execute 'set local role authenticated';
  insert into public.envelopes (id, household_id, author_id, open_mode, opens_at, layers) values (timed, hh, m1, 'at', now() + interval '1 hour', jsonb_build_object('feel', sealed, 'words', sealed));
  insert into public.keys (household_id, envelope_id, author_id, layer, key, opens_at) values
    (hh, timed, m1, 'feel', 'key-timed-feel', now() + interval '1 hour'),
    (hh, timed, m1, 'words', 'key-timed-words', now() + interval '1 hour');
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  select convert_from(body, 'UTF8')::jsonb into ev from net.http_request_queue where url = target order by id desc limit 1;
  report := report || format('%s 08 an envelope with a time sends "sealed" once, and its keys say nothing yet (%s, %s)', case when n = seen + 1 and ev ->> 'type' = 'sealed' then 'ok  ' else 'FAIL' end, n - seen, ev ->> 'type');
  seen := n;

  -- (The minute job runs inside the database, where nobody is logged in.)
  perform set_config('request.jwt.claims', '', true);
  perform private.announce_due();
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 09 the minute job finds nothing before the time (%s)', case when n = seen then 'ok  ' else 'FAIL' end, n - seen);

  execute 'set local session_replication_role = replica';
  update public.keys set opens_at = now() - interval '5 seconds' where envelope_id = timed;
  execute 'set local session_replication_role = origin';
  select private.announce_due() into txt;
  select count(*) into n from net.http_request_queue where url = target;
  select convert_from(body, 'UTF8')::jsonb into ev from net.http_request_queue where url = target order by id desc limit 1;
  report := report || format('%s 10 when the time has come the minute job sends "opened" once for the envelope, in the author''s name (%s sent for %s envelope, %s)',
    case when n = seen + 1 and txt = '1' and ev = jsonb_build_object('type', 'opened', 'household_id', hh, 'actor_id', m1, 'envelope_id', timed) then 'ok  ' else 'FAIL' end, n - seen, txt, ev ->> 'type');
  seen := n;
  perform private.announce_due();
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 11 and never twice (%s)', case when n = seen then 'ok  ' else 'FAIL' end, n - seen);

  -- ---- answered: the first answer, from the one who answers
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  update public.envelopes set seen = '{"words":"2026-11-13T21:00:00Z"}' where id = waiting;
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 12 opening an envelope sends nothing: there are no read receipts (%s)', case when n = seen then 'ok  ' else 'FAIL' end, n - seen);
  execute 'set local role authenticated';
  update public.envelopes set reply = '{"taps":["fire"],"heat":4,"at":"2026-11-13T21:02:00Z"}' where id = waiting;
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  select convert_from(body, 'UTF8')::jsonb into ev from net.http_request_queue where url = target order by id desc limit 1;
  report := report || format('%s 13 the first answer sends "answered" once, from whoever answered (%s, %s)', case when n = seen + 1 and ev = jsonb_build_object('type', 'answered', 'household_id', hh, 'actor_id', m2, 'envelope_id', waiting) then 'ok  ' else 'FAIL' end, n - seen, ev ->> 'type');
  seen := n;
  execute 'set local role authenticated';
  update public.envelopes set reply = '{"taps":["fire","again"],"heat":5,"at":"2026-11-13T21:02:00Z"}' where id = waiting;
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 14 changing the answer afterwards sends nothing (%s)', case when n = seen then 'ok  ' else 'FAIL' end, n - seen);

  -- ---- nothing that is written in or on an envelope ever travels
  select count(*) into n from net.http_request_queue q
  where q.url = target and (convert_from(q.body, 'UTF8') ~* 'dared|reworded|teaser|key-|c2VhbGVk|taps|heat' or (select count(*) from jsonb_object_keys(convert_from(q.body, 'UTF8')::jsonb)) <> 4);
  report := report || format('%s 15 no call carried a line, a key, an answer or anything sealed: four plain fields each (%s calls with more)', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  -- ---- changes from outside the app have nobody to name
  perform set_config('request.jwt.claims', '', true);
  insert into public.envelopes (household_id, author_id, open_mode) values (hh, m1, 'hand');
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 16 a change made from the SQL editor sends nothing (%s)', case when n = seen then 'ok  ' else 'FAIL' end, n - seen);

  -- ---- an envelope taken back is not announced
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  insert into public.envelopes (household_id, author_id, open_mode, deleted_at) values (hh, m2, 'hand', now());
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 17 an envelope that is taken back in the same breath sends nothing (%s)', case when n = seen then 'ok  ' else 'FAIL' end, n - seen);

  -- ---- a failing call never makes a write fail (only checkable against the stand-in)
  if to_regprocedure('net.is_stand_in()') is not null then
    update private.push_config set function_url = 'https://push-test.invalid/explode';
    execute 'set local role authenticated';
    perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
    begin
      insert into public.envelopes (id, household_id, author_id, open_mode) values (quiet, hh, m1, 'hand') on conflict (id) do update set teaser = 'Still saved';
      insert into public.envelopes (household_id, author_id, open_mode) values (hh, m1, 'hand');
      get diagnostics n = row_count;
      insert into public.keys (household_id, envelope_id, author_id, layer, key, opens_at) values (hh, quiet, m1, 'words', 'key-quiet', now());
      select count(*) into seen from public.keys where envelope_id = quiet and announced_at is not null;
      report := report || format('%s 18 when the call itself fails, the writes still go through (%s envelope, %s key)', case when n = 1 and seen = 1 then 'ok  ' else 'FAIL' end, n, seen);
    exception when others then
      report := report || format('FAIL 18 a failing call made the write fail (%s)', sqlerrm);
    end;
    execute 'reset role';
    update private.push_config set function_url = target;
  else
    report := report || text 'ok   18 (skipped here: a failing call can only be staged against the local stand-in)';
  end if;

  -- ---- subscriptions: each device manages its own
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform public.save_push_subscription(ep_phone, 'BPublicKey', 'AuthSecret', array['opened', 'nonsense', 'opened'], 'Test phone');
  execute 'reset role';
  select count(*), bool_and(member_id = m2 and user_id = u2 and household_id = hh and muted_types = array['opened']) into n, b from public.push_subscriptions where endpoint = ep_phone;
  report := report || format('%s 19 a device signs up: one row, tied to profile and login, unknown kinds dropped (%s, %s)', case when n = 1 and b then 'ok  ' else 'FAIL' end, n, b);

  execute 'set local role authenticated';
  begin
    select count(*) into n from public.push_subscriptions;
    report := report || format('FAIL 20 the app can read the subscriptions table directly (%s rows)', n);
  exception when others then
    report := report || format('ok   20 the table itself is closed to the app (%s)', sqlstate);
  end;
  begin
    insert into public.push_subscriptions (household_id, member_id, endpoint, p256dh, auth) values (hh, m2, 'https://push-test.invalid/send/sneaky', 'k', 'a');
    report := report || text 'FAIL 21 the app can insert a subscription directly';
  exception when others then
    report := report || format('ok   21 direct inserts are refused (%s)', sqlstate);
  end;

  perform public.set_push_muted(ep_phone, array['answered', 'sealed']);
  execute 'reset role';
  select muted_types into txt from public.push_subscriptions where endpoint = ep_phone;
  report := report || format('%s 22 muting is saved, in the usual order (%s)', case when txt = '{sealed,answered}' then 'ok  ' else 'FAIL' end, txt);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  begin
    perform public.set_push_muted(ep_phone, array['served']);
    report := report || text 'FAIL 23 the partner could mute my device';
  exception when others then
    report := report || format('%s 23 the partner cannot mute my device (%s)', case when sqlerrm = 'push_missing' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;
  perform public.remove_push_subscription(ep_phone);
  execute 'reset role';
  select count(*) into n from public.push_subscriptions where endpoint = ep_phone;
  report := report || format('%s 24 the partner cannot remove my device (%s row left)', case when n = 1 then 'ok  ' else 'FAIL' end, n);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  begin
    perform public.save_push_subscription('https://push-test.invalid/send/stranger', 'k', 'a');
    report := report || text 'FAIL 25 a stranger could sign up for notifications';
  exception when others then
    report := report || format('%s 25 a stranger cannot sign up (%s)', case when sqlerrm = 'not_in_room' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;
  begin
    perform public.set_push_muted(ep_phone, array['served']);
    report := report || text 'FAIL 26 a stranger could mute a device';
  exception when others then
    report := report || format('%s 26 a stranger cannot mute a device (%s)', case when sqlerrm = 'not_in_room' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  begin
    perform public.save_push_subscription('http://push-test.invalid/not-https', 'k', 'a');
    report := report || text 'FAIL 27 an address that is not https was accepted';
  exception when others then
    report := report || format('%s 27 an address that is not https is refused (%s)', case when sqlerrm = 'push_invalid' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;

  -- The browser swapped the subscription for a new one: the old row goes.
  perform public.save_push_subscription(ep_new, 'BPublicKey2', 'AuthSecret2', '{}', 'Test phone');
  execute 'reset role';
  select count(*), bool_and(endpoint = ep_new) into n, b from public.push_subscriptions where user_id = u2;
  report := report || format('%s 28 a renewed subscription replaces the device''s old one (%s row, new address: %s)', case when n = 1 and b then 'ok  ' else 'FAIL' end, n, b);

  -- The same browser, now used by the other person: the row changes hands.
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform public.save_push_subscription(ep_new, 'BPublicKey2', 'AuthSecret2', array['planned'], 'Shared browser');
  execute 'reset role';
  select count(*), bool_and(member_id = m1 and user_id = u1) into n, b from public.push_subscriptions where endpoint = ep_new;
  report := report || format('%s 29 one browser, one row: it belongs to whoever is logged in on it now (%s row, hers: %s)', case when n = 1 and b then 'ok  ' else 'FAIL' end, n, b);

  execute 'set local role authenticated';
  perform public.remove_push_subscription(ep_new);
  perform public.remove_push_subscription(ep_new);
  execute 'reset role';
  select count(*) into n from public.push_subscriptions where household_id = hh;
  report := report || format('%s 30 removing works, and removing twice is not an error (%s rows left)', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  -- ---- logging out takes the notifications along
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform public.save_push_subscription(ep_phone, 'BPublicKey', 'AuthSecret');
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform public.save_push_subscription(ep_tablet, 'BPublicKey3', 'AuthSecret3');
  perform public.sign_out_device();
  execute 'reset role';
  select count(*) filter (where endpoint = ep_tablet), count(*) filter (where endpoint = ep_phone) into n, seen from public.push_subscriptions;
  report := report || format('%s 31 logging a device out removes its subscription (%s) and leaves the other device''s (%s)', case when n = 0 and seen = 1 then 'ok  ' else 'FAIL' end, n, seen);

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform public.sign_out_member(m2);
  execute 'reset role';
  select count(*) into n from public.push_subscriptions where member_id = m2;
  report := report || format('%s 32 the admin''s "log out everywhere" silences every device of the partner (%s left)', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  -- ---- who may call what
  select not has_function_privilege('anon', 'public.save_push_subscription(text, text, text, text[], text)', 'execute')
     and not has_function_privilege('anon', 'public.set_push_muted(text, text[])', 'execute')
     and not has_function_privilege('anon', 'public.remove_push_subscription(text)', 'execute')
     and has_function_privilege('authenticated', 'public.save_push_subscription(text, text, text, text[], text)', 'execute')
     and has_function_privilege('authenticated', 'public.set_push_muted(text, text[])', 'execute')
     and has_function_privilege('authenticated', 'public.remove_push_subscription(text)', 'execute') into b;
  report := report || format('%s 33 the three functions are for logged-in devices only (%s)', case when b then 'ok  ' else 'FAIL' end, b);
  select not has_function_privilege('authenticated', 'private.send_push(text, uuid, uuid, uuid)', 'execute')
     and not has_function_privilege('authenticated', 'private.push_on_envelope()', 'execute')
     and not has_function_privilege('authenticated', 'private.push_on_key()', 'execute')
     and not has_function_privilege('authenticated', 'private.announce_due()', 'execute')
     and not has_function_privilege('authenticated', 'private.drop_device_pushes()', 'execute')
     and not has_table_privilege('authenticated', 'private.push_config', 'select')
     and not has_table_privilege('anon', 'private.push_config', 'select')
     and not has_table_privilege('authenticated', 'public.push_subscriptions', 'select')
     and has_function_privilege('authenticated', 'private.my_member_ids()', 'execute')
     and has_function_privilege('authenticated', 'private.seat_state()', 'execute') into b;
  report := report || format('%s 34 the settings, the secret and the sending are out of the app''s reach; the old helpers still work (%s)', case when b then 'ok  ' else 'FAIL' end, b);

  -- ---- the secret and the keys: made here, readable by the function only
  perform private.push_setup('https://push-test.invalid/functions/v1/push-moved', v_subject);
  select c.secret, c.function_url into txt, target_now from private.push_config c;
  report := report || format('%s 35 running set-up again moves the address (%s) and keeps the secret', case when txt = v_secret and target_now like '%%push-moved' then 'ok  ' else 'FAIL' end, target_now like '%%push-moved');

  perform private.push_new_secret();
  select c.secret into txt from private.push_config c;
  report := report || format('%s 36 a new secret on request: different, and long enough (%s characters)', case when txt <> v_secret and char_length(txt) >= 32 then 'ok  ' else 'FAIL' end, char_length(txt));
  v_secret := txt;

  begin
    perform private.push_setup('http://push-test.invalid/not-https', v_subject);
    report := report || text 'FAIL 37 set-up accepted an address that is not https';
  exception when others then
    report := report || format('ok   37 set-up refuses an address that is not https (%s)', sqlstate);
  end;

  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  begin
    perform public.push_settings();
    report := report || text 'FAIL 38 a logged-in device could read the secret and the private key';
  exception when others then
    report := report || format('ok   38 a logged-in device cannot read the secret or the private key (%s)', sqlstate);
  end;
  begin
    perform public.push_store_keys(key_a, key_a_private);
    report := report || text 'FAIL 39 a logged-in device could plant its own key pair';
  exception when others then
    report := report || format('ok   39 a logged-in device cannot plant a key pair (%s)', sqlstate);
  end;
  select public.push_public_key() into txt;
  report := report || format('%s 40 a logged-in device may ask for the public key: none yet (%s)', case when txt is null then 'ok  ' else 'FAIL' end, coalesce(txt, 'null'));
  execute 'reset role';

  execute 'set local role anon';
  n := 0;
  begin perform public.push_settings(); exception when others then n := n + 1; end;
  begin perform public.push_store_keys(key_a, key_a_private); exception when others then n := n + 1; end;
  begin perform public.push_public_key(); exception when others then n := n + 1; end;
  execute 'reset role';
  report := report || format('%s 41 somebody without a login gets none of the three (%s of 3 refused)', case when n = 3 then 'ok  ' else 'FAIL' end, n);

  execute 'set local role service_role';
  ev := public.push_settings();
  report := report || format('%s 42 the function (service role) gets secret and subject, and sees that there are no keys yet',
    case when ev ->> 'secret' = v_secret and ev ->> 'subject' = v_subject and ev -> 'vapid_public' = 'null'::jsonb and ev -> 'vapid_private' = 'null'::jsonb then 'ok  ' else 'FAIL' end);
  begin
    perform public.push_store_keys('not a key', key_a_private);
    report := report || text 'FAIL 43 something that is not a key was stored';
  exception when others then
    report := report || format('%s 43 something that is not a key is refused (%s)', case when sqlerrm = 'push_invalid' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;
  ev := public.push_store_keys(key_a, key_a_private);
  hdr := public.push_store_keys(key_b, key_b_private);
  report := report || format('%s 44 the first pair is kept; a second caller is answered with that same pair',
    case when ev = jsonb_build_object('vapid_public', key_a, 'vapid_private', key_a_private) and hdr = ev then 'ok  ' else 'FAIL' end);
  ev := public.push_settings();
  execute 'reset role';
  report := report || format('%s 45 from then on the function gets the pair with its settings', case when ev ->> 'vapid_public' = key_a and ev ->> 'vapid_private' = key_a_private and ev ->> 'secret' = v_secret then 'ok  ' else 'FAIL' end);

  execute 'set local role authenticated';
  select public.push_public_key() into txt;
  execute 'reset role';
  report := report || format('%s 46 and the app gets the public half, nothing more', case when txt = key_a then 'ok  ' else 'FAIL' end);

  perform private.push_setup(target, v_subject);
  select count(*) into n from private.push_config c where c.vapid_public = key_a and c.secret = v_secret;
  report := report || format('%s 47 running set-up again keeps the keys too (%s)', case when n = 1 then 'ok  ' else 'FAIL' end, n);

  perform private.push_forget_keys();
  execute 'set local role service_role';
  ev := public.push_store_keys(key_b, key_b_private);
  execute 'reset role';
  report := report || format('%s 48 after the keys are thrown away, a new pair can be stored', case when ev ->> 'vapid_public' = key_b then 'ok  ' else 'FAIL' end);

  delete from private.push_config;
  perform private.push_new_secret();
  perform private.push_forget_keys();
  execute 'set local role service_role';
  ev := public.push_settings();
  hdr := public.push_store_keys(key_a, key_a_private);
  execute 'reset role';
  select count(*) into n from private.push_config;
  report := report || format('%s 49 switched off: no settings, no keys, nothing stored (%s rows)', case when ev is null and hdr is null and public.push_public_key() is null and n = 0 then 'ok  ' else 'FAIL' end, n);

  select not has_function_privilege('authenticated', 'public.push_settings()', 'execute')
     and not has_function_privilege('authenticated', 'public.push_store_keys(text, text)', 'execute')
     and not has_function_privilege('anon', 'public.push_settings()', 'execute')
     and not has_function_privilege('anon', 'public.push_store_keys(text, text)', 'execute')
     and not has_function_privilege('anon', 'public.push_public_key()', 'execute')
     and has_function_privilege('authenticated', 'public.push_public_key()', 'execute')
     and has_function_privilege('service_role', 'public.push_settings()', 'execute')
     and has_function_privilege('service_role', 'public.push_store_keys(text, text)', 'execute')
     and not has_function_privilege('authenticated', 'private.push_setup(text, text)', 'execute')
     and not has_function_privilege('authenticated', 'private.push_new_secret()', 'execute')
     and not has_function_privilege('authenticated', 'private.push_forget_keys()', 'execute')
     and not has_function_privilege('service_role', 'private.push_setup(text, text)', 'execute')
     and not has_function_privilege('anon', 'private.push_setup(text, text)', 'execute') into b;
  report := report || format('%s 50 on paper too: settings and keys for the service role, the public key for logged-in devices, set-up for the owner alone (%s)', case when b then 'ok  ' else 'FAIL' end, b);

  raise exception E'PUSH REPORT (rolled back)\n%', array_to_string(report, E'\n');
end
$$;
