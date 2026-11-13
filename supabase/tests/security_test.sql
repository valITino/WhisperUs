-- Security test for the WhisperUs database.
-- Run it in the Supabase SQL editor. It creates four throwaway logins, plays through
-- opening the room, outsider attacks, PIN login, the admin's powers and the master
-- key, then ROLLS EVERYTHING BACK by ending with an exception whose message is the
-- report. "FAIL" lines mean a hole.
-- Only run it while no real room exists yet (the single-room lock would trip).

do $$
declare
  u1 uuid := gen_random_uuid(); -- Ana's phone (she opens the room, so she is the admin)
  u2 uuid := gen_random_uuid(); -- Ben's phone
  u3 uuid := gen_random_uuid(); -- a stranger, later Ben's tablet
  u4 uuid := gen_random_uuid(); -- a fresh device
  r jsonb;
  hh uuid;
  m1 uuid;
  m2 uuid;
  code text;
  n integer;
  b boolean;
  env uuid := gen_random_uuid(); -- an envelope of Ana's
  t1 timestamptz;
  t2 timestamptz;
  txt text;
  report text[] := '{}';
begin
  insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) values
    (u1, 'authenticated', 'authenticated', true, now(), now()),
    (u2, 'authenticated', 'authenticated', true, now(), now()),
    (u3, 'authenticated', 'authenticated', true, now(), now()),
    (u4, 'authenticated', 'authenticated', true, now(), now());

  execute 'set local role authenticated';

  -- ---- person 1 opens the room
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  begin
    perform public.create_household('Test room', '{"name":"Ana"}', '123456');
    report := report || text 'FAIL 01 a room could be opened with the PIN 123456';
  exception when others then
    report := report || format('%s 01 too simple PIN refused (%s)', case when sqlerrm = 'pin_too_simple' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;
  select public.room_exists() into b;
  r := public.create_household('Test room', '{"name":"Ana","status":"Night owl","accessory":"bow"}', '271828');
  hh := (r ->> 'household_id')::uuid;
  m1 := (r ->> 'member_id')::uuid;
  select is_admin, status into b, txt from public.members where id = m1;
  report := report || format('%s 02 room opened, the opener is the admin (%s) with her status (%s)', case when b and txt = 'Night owl' then 'ok  ' else 'FAIL' end, b, txt);

  insert into public.envelopes (id, household_id, author_id, teaser) values (env, hh, m1, 'About Saturday');
  select count(*) into n from public.envelopes;
  report := report || format('%s 03 the author sees her own envelope (%s)', case when n = 1 then 'ok  ' else 'FAIL' end, n);
  select count(*) into n from public.members;
  report := report || format('%s 04 the room starts with one person (%s)', case when n = 1 then 'ok  ' else 'FAIL' end, n);

  r := public.create_invite('join');
  code := r ->> 'code';
  report := report || format('%s 05 invite code created (%s chars)', case when length(code) = 10 then 'ok  ' else 'FAIL' end, length(code));

  -- ---- a stranger with a valid anonymous login
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);

  select (select count(*) from public.envelopes) + (select count(*) from public.households)
       + (select count(*) from public.members) + (select count(*) from public.keys) + (select count(*) from public.media) into n;
  report := report || format('%s 06 stranger reads nothing (%s rows)', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  begin
    insert into public.envelopes (household_id, author_id) values (hh, m1);
    report := report || text 'FAIL 07 stranger could insert an envelope';
  exception when others then
    report := report || format('ok   07 stranger insert blocked (%s)', sqlstate);
  end;

  update public.envelopes set teaser = 'Hacked' where id = env;
  get diagnostics n = row_count;
  report := report || format('%s 08 stranger update touches %s rows', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  begin
    perform public.create_household('Evil room', '{}', '271828');
    report := report || text 'FAIL 09 stranger could open a second room';
  exception when others then
    report := report || format('%s 09 second room refused (%s)', case when sqlerrm = 'room_already_exists' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;

  begin
    perform public.join_household('WRONGCODE1', '{}', '271828');
    report := report || text 'FAIL 10 stranger joined with a wrong code';
  exception when others then
    report := report || format('%s 10 wrong invite refused (%s)', case when sqlerrm = 'invite_invalid' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;

  begin
    perform public.peek_invite('WRONGCODE1');
    report := report || text 'FAIL 11 a wrong code could be looked at';
  exception when others then
    report := report || format('%s 11 looking at a wrong code refused (%s)', case when sqlerrm = 'invite_invalid' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;

  r := public.sync_pull(null);
  n := jsonb_array_length(r -> 'envelopes') + jsonb_array_length(r -> 'keys') + jsonb_array_length(r -> 'members') + jsonb_array_length(r -> 'households');
  report := report || format('%s 12 stranger sync_pull is empty (%s rows) and says the seat is %s', case when n = 0 and r ->> 'seat' = 'gone' then 'ok  ' else 'FAIL' end, n, r ->> 'seat');

  begin
    select count(*) into n from public.invites;
    report := report || text 'FAIL 13 invites table is readable';
  exception when others then
    report := report || format('ok   13 invites table locked (%s)', sqlstate);
  end;

  begin
    select count(*) into n from private.member_pins;
    report := report || text 'FAIL 14 PIN hashes are readable';
  exception when others then
    report := report || format('ok   14 PIN hashes locked (%s)', sqlstate);
  end;

  begin
    insert into private.member_devices (user_id, member_id) values (u3, m1);
    report := report || text 'FAIL 15 stranger could log a device in by hand';
  exception when others then
    report := report || format('ok   15 device list locked (%s)', sqlstate);
  end;

  begin
    delete from private.login_attempts;
    report := report || text 'FAIL 16 stranger could wipe the wrong-try counters';
  exception when others then
    report := report || format('ok   16 wrong-try counters locked (%s)', sqlstate);
  end;

  begin
    perform private.rescue_code('Ana');
    report := report || text 'FAIL 17 the master key is reachable from the app';
  exception when others then
    report := report || format('%s 17 master key not reachable from the app (%s)', case when sqlstate = '42501' then 'ok  ' else 'FAIL' end, sqlstate);
  end;

  begin
    perform private.set_pin_for(m1, '864209');
    report := report || text 'FAIL 18 stranger could set somebody else''s PIN';
  exception when others then
    report := report || format('%s 18 PIN helper not reachable from the app (%s)', case when sqlstate = '42501' then 'ok  ' else 'FAIL' end, sqlstate);
  end;

  begin
    insert into storage.objects (bucket_id, name) values ('media', hh::text || '/stolen.bin');
    report := report || text 'FAIL 19 stranger could upload into the room folder';
  exception when others then
    report := report || format('ok   19 stranger file upload blocked (%s)', sqlstate);
  end;

  -- ---- person 2 joins with the code
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  r := public.peek_invite(lower(code));
  report := report || format('%s 20 the code shows who invites (%s to %s) before it is used', case when r ->> 'kind' = 'join' and r -> 'host' ->> 'name' = 'Ana' and r -> 'profile' = 'null'::jsonb then 'ok  ' else 'FAIL' end, r -> 'host' ->> 'name', r ->> 'room_name');

  begin
    perform public.join_household(code, '{"name":"Ben"}', '12');
    report := report || text 'FAIL 21 joined with a two-digit PIN';
  exception when others then
    report := report || format('%s 21 malformed PIN refused (%s)', case when sqlerrm = 'pin_invalid' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;

  begin
    perform public.join_household(code, '{"name":"  ana "}', '314159');
    report := report || text 'FAIL 22 joined under the partner''s name';
  exception when others then
    report := report || format('%s 22 the partner''s name is taken (%s)', case when sqlerrm = 'name_taken' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;

  r := public.join_household(lower(code), '{"name":"Ben"}', '314159');
  m2 := (r ->> 'member_id')::uuid;
  select count(*) into n from public.envelopes;
  select is_admin into b from public.members where id = m2;
  report := report || format('%s 23 partner joined, sees the envelope (%s) and is not an admin', case when n = 1 and not b then 'ok  ' else 'FAIL' end, n);

  select updated_at into t1 from public.envelopes where id = env;
  update public.envelopes set teaser = 'Rewritten by Ben', seen = '{"words":"2026-11-13T21:00:00Z"}' where id = env;
  get diagnostics n = row_count;
  select updated_at, teaser into t2, txt from public.envelopes where id = env;
  report := report || format('%s 24 the partner marks a layer opened and updated_at moves forward; the outside stays the author''s (%s)', case when n = 1 and t2 > t1 and txt = 'About Saturday' then 'ok  ' else 'FAIL' end, txt);

  update public.members set name = 'Not Ana' where id = m1;
  get diagnostics n = row_count;
  report := report || format('%s 25 cannot edit partner profile (%s rows)', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  update public.members set name = 'Benny', status = 'Always hungry', prefs = '{"lang":"de","theme":"dark"}' where id = m2;
  get diagnostics n = row_count;
  report := report || format('%s 26 can edit own profile and settings (%s rows)', case when n = 1 then 'ok  ' else 'FAIL' end, n);

  begin
    update public.members set is_admin = true where id = m2;
    report := report || text 'FAIL 27 a member could make themselves admin';
  exception when others then
    report := report || format('ok   27 admin flag cannot be edited (%s)', sqlstate);
  end;

  begin
    update public.members set disabled_at = now() where id = m1;
    report := report || text 'FAIL 28 a member could pause a profile by hand';
  exception when others then
    report := report || format('ok   28 paused flag cannot be edited (%s)', sqlstate);
  end;

  begin
    update public.members set name = 'ANA' where id = m2;
    report := report || text 'FAIL 29 a member could take the partner''s name';
  exception when others then
    report := report || format('%s 29 renaming to the partner''s name blocked (%s)', case when sqlstate = '23505' then 'ok  ' else 'FAIL' end, sqlstate);
  end;

  begin
    delete from public.envelopes where id = env;
    report := report || text 'FAIL 30 hard delete allowed';
  exception when others then
    report := report || format('ok   30 hard delete blocked (%s)', sqlstate);
  end;

  begin
    insert into storage.objects (bucket_id, name) values ('media', hh::text || '/' || gen_random_uuid()::text || '.bin');
    report := report || text 'ok   31 member can add a sealed file to the room folder';
  exception when others then
    report := report || format('FAIL 31 member file upload blocked (%s %s)', sqlstate, sqlerrm);
  end;

  -- ---- only the admin has the keys
  txt := '';
  begin perform public.create_invite('join'); txt := txt || ' invite'; exception when others then if sqlerrm <> 'admin_only' then txt := txt || ' invite:' || sqlerrm; end if; end;
  begin perform public.create_invite('restore', m1); txt := txt || ' restore'; exception when others then if sqlerrm <> 'admin_only' then txt := txt || ' restore:' || sqlerrm; end if; end;
  begin perform public.set_member_paused(m1, true); txt := txt || ' pause'; exception when others then if sqlerrm <> 'admin_only' then txt := txt || ' pause:' || sqlerrm; end if; end;
  begin perform public.sign_out_member(m1); txt := txt || ' logout'; exception when others then if sqlerrm <> 'admin_only' then txt := txt || ' logout:' || sqlerrm; end if; end;
  report := report || format('%s 32 the partner cannot invite, let back in, pause or log out the admin%s', case when txt = '' then 'ok  ' else 'FAIL' end, txt);

  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  txt := '';
  begin perform public.create_invite('join'); txt := txt || ' third-seat'; exception when others then if sqlerrm <> 'room_full' then txt := txt || ' full:' || sqlerrm; end if; end;
  begin perform public.set_member_paused(m1, true); txt := txt || ' self-pause'; exception when others then if sqlerrm <> 'not_yourself' then txt := txt || ' self:' || sqlerrm; end if; end;
  begin perform public.create_invite('restore', m1); txt := txt || ' self-restore'; exception when others then if sqlerrm <> 'not_yourself' then txt := txt || ' selfrestore:' || sqlerrm; end if; end;
  report := report || format('%s 33 the room is full at two, and the admin cannot pause herself%s', case when txt = '' then 'ok  ' else 'FAIL' end, txt);

  -- ---- the answer belongs to the one who answers
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  update public.envelopes set reply = '{"taps":["fire"],"heat":4,"at":"2026-11-13T21:05:00Z"}' where id = env;
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  update public.envelopes set reply = null, seen = '{}' where id = env;
  select reply -> 'taps' ->> 0, seen ->> 'words' into txt, code from public.envelopes where id = env;
  report := report || format('%s 34 the author cannot rewrite the other one''s answer (%s) nor what he opened (%s)',
    case when txt = 'fire' and code is not null then 'ok  ' else 'FAIL' end, txt, code);

  -- ---- PIN login from another device (u3 is Ben's tablet now)
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  r := public.sign_in_with_pin('Benny', '864209');
  txt := r::text;
  r := public.sign_in_with_pin('Nobody', '864209');
  report := report || format('%s 35 a wrong PIN and an unknown name get the same answer (%s)', case when txt = r::text and r ->> 'reason' = 'wrong' and (r ->> 'tries_left')::int = 4 then 'ok  ' else 'FAIL' end, txt);

  for i in 1 .. 3 loop
    r := public.sign_in_with_pin(' BENNY ', '864209');
  end loop;
  report := report || format('%s 36 one try left after four wrong ones (%s)', case when (r ->> 'tries_left')::int = 1 then 'ok  ' else 'FAIL' end, r ->> 'tries_left');
  r := public.sign_in_with_pin('benny', '864209');
  report := report || format('%s 37 the fifth wrong try pauses the name for 15 minutes (%s)', case when r ->> 'reason' = 'locked' and (r ->> 'retry_at')::timestamptz between now() + interval '14 minutes' and now() + interval '16 minutes' then 'ok  ' else 'FAIL' end, r ->> 'reason');
  r := public.sign_in_with_pin('Benny', '314159');
  select count(*) into n from public.envelopes;
  report := report || format('%s 38 while paused even the right PIN is refused (%s, sees %s envelopes)', case when r ->> 'reason' = 'locked' and n = 0 then 'ok  ' else 'FAIL' end, r ->> 'reason', n);

  -- the pause runs out
  execute 'reset role';
  update private.login_attempts set locked_until = now() - interval '1 second' where name_key = 'benny';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  r := public.sign_in_with_pin('benny', '314159');
  select count(*) into n from public.envelopes;
  select prefs ->> 'lang' into txt from public.members where id = m2;
  report := report || format('%s 39 name and PIN log a second device in: same profile, %s envelope, settings came along (%s)', case when (r ->> 'ok')::boolean and (r ->> 'member_id')::uuid = m2 and n = 1 and txt = 'de' then 'ok  ' else 'FAIL' end, n, txt);

  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.envelopes;
  report := report || format('%s 40 the first device stays logged in (%s envelope)', case when n = 1 then 'ok  ' else 'FAIL' end, n);

  -- ---- own devices and own PIN
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  n := public.sign_out_other_devices();
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  r := public.sync_pull(null);
  report := report || format('%s 41 "log out my other devices" logged out %s; that device now reads nothing (seat %s)', case when n = 1 and jsonb_array_length(r -> 'envelopes') = 0 and r ->> 'seat' = 'gone' then 'ok  ' else 'FAIL' end, n, r ->> 'seat');

  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  perform public.set_pin('864209');
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  r := public.sign_in_with_pin('Benny', '314159');
  txt := r ->> 'reason';
  r := public.sign_in_with_pin('Benny', '864209');
  report := report || format('%s 42 after a PIN change the old PIN is %s and the new one works (%s)', case when txt = 'wrong' and (r ->> 'ok')::boolean then 'ok  ' else 'FAIL' end, txt, r ->> 'ok');

  -- ---- the admin pauses the partner
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  perform public.set_member_paused(m2, true);
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  r := public.sync_pull(null);
  update public.members set status = 'Still here' where id = m2;
  get diagnostics n = row_count;
  report := report || format('%s 43 a paused profile reads nothing (%s envelopes, seat %s) and writes nothing (%s rows)', case when jsonb_array_length(r -> 'envelopes') = 0 and r ->> 'seat' = 'paused' and n = 0 then 'ok  ' else 'FAIL' end, jsonb_array_length(r -> 'envelopes'), r ->> 'seat', n);
  r := public.my_membership();
  report := report || format('%s 44 the device learns it is paused, not logged out (%s)', case when (r ->> 'paused')::boolean and (r ->> 'member_id')::uuid = m2 then 'ok  ' else 'FAIL' end, r ->> 'paused');
  begin
    insert into public.envelopes (household_id, author_id) values (hh, m2);
    report := report || text 'FAIL 45 a paused profile could seal an envelope';
  exception when others then
    report := report || format('ok   45 a paused profile cannot seal an envelope (%s)', sqlstate);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  r := public.sign_in_with_pin('Benny', '864209');
  report := report || format('%s 46 a paused profile cannot log in on a new device (%s)', case when r ->> 'reason' = 'paused' then 'ok  ' else 'FAIL' end, r ->> 'reason');

  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  select disabled_at is not null into b from public.members where id = m2;
  perform public.set_member_paused(m2, false);
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  select count(*) into n from public.envelopes;
  report := report || format('%s 47 the admin saw the pause (%s) and switched it off: the partner reads again (%s envelope)', case when b and n = 1 then 'ok  ' else 'FAIL' end, b, n);

  -- ---- the admin logs the partner out everywhere, then lets him back in
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  n := public.sign_out_member(m2);
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  r := public.sync_pull(null);
  report := report || format('%s 48 "log out everywhere" logged out %s devices; they read nothing (seat %s)', case when n = 2 and jsonb_array_length(r -> 'envelopes') = 0 and r ->> 'seat' = 'gone' then 'ok  ' else 'FAIL' end, n, r ->> 'seat');

  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  r := public.create_invite('restore', m2);
  code := r ->> 'code';
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  r := public.peek_invite(code);
  txt := r -> 'profile' ->> 'name';
  r := public.join_household(code, '{"name":"ignored"}', '975310');
  select count(*) into n from public.envelopes;
  report := report || format('%s 49 a restore code lets %s back in as the same profile with a new PIN (%s envelope)', case when txt = 'Benny' and r ->> 'kind' = 'restore' and (r ->> 'member_id')::uuid = m2 and n = 1 then 'ok  ' else 'FAIL' end, txt, n);

  begin
    perform public.join_household(code, '{}', '975310');
    report := report || text 'FAIL 50 a restore code worked twice';
  exception when others then
    report := report || format('%s 50 the code works once (%s)', case when sqlerrm in ('invite_invalid', 'already_in_room') then 'ok  ' else 'FAIL' end, sqlerrm);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  r := public.sign_in_with_pin('Benny', '864209');
  report := report || format('%s 51 the forgotten PIN no longer works (%s)', case when r ->> 'reason' = 'wrong' then 'ok  ' else 'FAIL' end, r ->> 'reason');

  -- ---- logging out
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  perform public.sign_out_device();
  select count(*) into n from public.envelopes;
  r := public.my_membership();
  report := report || format('%s 52 after logging out the device reads nothing (%s rows) and has no seat', case when n = 0 and r is null then 'ok  ' else 'FAIL' end, n);

  -- ---- the owner's master key (only from the SQL editor)
  execute 'reset role';
  code := private.rescue_code('ana');
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u4, 'role', 'authenticated')::text, true);
  r := public.join_household(code, '{}', '135791');
  select is_admin into b from public.members where id = m1;
  report := report || format('%s 53 the master key gets the admin back in on a fresh device (%s, still admin: %s)', case when (r ->> 'member_id')::uuid = m1 and r ->> 'kind' = 'restore' and b then 'ok  ' else 'FAIL' end, r ->> 'kind', b);

  perform public.create_invite('restore', m2);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  select count(*) into n from public.envelopes;
  report := report || format('%s 54 her old device is logged out by that (%s rows), and the new one has the admin''s keys', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  execute 'reset role';
  select count(*) into n from private.login_attempts where failed > 0 or locked_until > now();
  report := report || format('%s 55 no wrong-try counters are left for people who got in (%s left: only the made-up name and the one stale PIN try)', case when n <= 2 then 'ok  ' else 'FAIL' end, n);

  raise exception E'SECURITY REPORT (rolled back)\n%', array_to_string(report, E'\n');
end
$$;
