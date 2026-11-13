-- Test for the seal (0002_envelopes.sql): who can read a key and from when, what each
-- of the two may write on an envelope, what "once" burns, and what taking back leaves.
--
-- Run it in the Supabase SQL editor, or locally with supabase/tests/local/run.sh seal.
-- It builds a throwaway second room with three throwaway logins, plays through an
-- envelope's life, then ROLLS EVERYTHING BACK by ending with an exception whose message
-- is the report. "FAIL" lines mean a hole.
--
-- Safe next to a real room: it touches only its own rows.

do $$
declare
  u1 uuid := gen_random_uuid(); -- Mia's phone (she seals)
  u2 uuid := gen_random_uuid(); -- Leo's phone (it is for him)
  u3 uuid := gen_random_uuid(); -- a stranger
  hh uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  timed uuid := gen_random_uuid();  -- opens in an hour, keeps
  once uuid := gen_random_uuid();   -- opens now, one opening
  his uuid := gen_random_uuid();    -- an envelope of Leo's
  k_feel uuid := gen_random_uuid();
  k_words uuid := gen_random_uuid();
  k_once_words uuid := gen_random_uuid();
  k_once_voice uuid := gen_random_uuid();
  sound uuid := gen_random_uuid();
  sealed constant jsonb := '{"iv":"AAAAAAAAAAAAAAAA","box":"c2VhbGVk"}';
  r jsonb;
  n integer;
  b boolean;
  txt text;
  t1 timestamptz;
  report text[] := '{}';
begin
  insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) values
    (u1, 'authenticated', 'authenticated', true, now(), now()),
    (u2, 'authenticated', 'authenticated', true, now(), now()),
    (u3, 'authenticated', 'authenticated', true, now(), now());
  insert into public.households (id, name) values (hh, 'Seal test room');
  insert into public.members (id, household_id, name, is_admin) values
    (m1, hh, 'Mia Sealtest', true),
    (m2, hh, 'Leo Sealtest', false);
  insert into private.member_devices (user_id, member_id) values (u1, m1), (u2, m2);

  execute 'set local role authenticated';

  -- ---- she seals an envelope that opens in an hour
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  insert into public.envelopes (id, household_id, author_id, teaser, open_mode, opens_at, layers, seen, reply)
  values (timed, hh, m1, 'About Saturday', 'at', now() + interval '1 hour',
          jsonb_build_object('feel', sealed, 'words', sealed, 'smuggled', sealed),
          '{"words":"2020-01-01T00:00:00Z"}', '{"taps":["forged"]}');
  insert into public.keys (id, household_id, envelope_id, author_id, layer, key, opens_at) values
    (k_feel, hh, timed, m1, 'feel', 'key-feel', now() + interval '1 hour'),
    (k_words, hh, timed, m1, 'words', 'key-words', now() + interval '1 hour');
  select layers ? 'smuggled', seen, reply is null into b, r, txt from public.envelopes where id = timed;
  report := report || format('%s 01 a new envelope starts unopened and unanswered, with only real layers (extra layer kept: %s, seen: %s)',
    case when not b and r = '{}'::jsonb and txt::boolean then 'ok  ' else 'FAIL' end, b, r);
  select count(*) into n from public.keys where envelope_id = timed;
  report := report || format('%s 02 the author sees her own keys before their time (%s)', case when n = 2 then 'ok  ' else 'FAIL' end, n);

  -- ---- he sees the outside, and no key
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.keys;
  select teaser into txt from public.envelopes where id = timed;
  r := public.sync_pull(null);
  report := report || format('%s 03 before its time he reads the outside (%s) and no key: %s by hand, %s through sync',
    case when txt = 'About Saturday' and n = 0 and jsonb_array_length(r -> 'keys') = 0 and jsonb_array_length(r -> 'envelopes') = 1 then 'ok  ' else 'FAIL' end, txt, n, jsonb_array_length(r -> 'keys'));

  update public.keys set opens_at = now() - interval '1 minute' where envelope_id = timed;
  get diagnostics n = row_count;
  report := report || format('%s 04 he cannot bring the time forward (%s rows)', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  begin
    insert into public.keys (household_id, envelope_id, author_id, layer, key, opens_at) values (hh, timed, m2, 'voice', 'his-own-key', now());
    report := report || text 'FAIL 05 he could hang a key of his own on her envelope';
  exception when others then
    report := report || format('ok   05 he cannot add a key to her envelope (%s)', sqlstate);
  end;

  update public.envelopes
  set teaser = 'Rewritten', open_mode = 'now', opens_at = now(), layers = '{}', deleted_at = now(), keep = 'once', wants = 'talk', heat_outside = 5
  where id = timed;
  select teaser, open_mode, deleted_at is null and layers ? 'words' and keep = 'keep' into txt, r, b from (select teaser, to_jsonb(open_mode) as open_mode, deleted_at, layers, keep from public.envelopes where id = timed) e;
  report := report || format('%s 06 he cannot rewrite, reschedule, empty or take back her envelope (%s, %s, intact: %s)',
    case when txt = 'About Saturday' and r = '"at"'::jsonb and b then 'ok  ' else 'FAIL' end, txt, r, b);

  -- ---- a stranger sees nothing of it
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  select (select count(*) from public.envelopes) + (select count(*) from public.keys) + (select count(*) from public.media) into n;
  report := report || format('%s 07 a stranger reads no envelope, key or file (%s rows)', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  -- ---- she moves the time while it has not come
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  update public.keys set opens_at = now() + interval '2 hours', key = 'swapped', layer = 'voice', announced_at = now() where id = k_feel;
  select key = 'key-feel' and layer = 'feel' and announced_at is null and opens_at > now() + interval '90 minutes' into b from public.keys where id = k_feel;
  report := report || format('%s 08 the author can move a time that has not come; key, layer and the announcement note stay as they were (%s)', case when b then 'ok  ' else 'FAIL' end, b);

  begin
    insert into public.keys (household_id, envelope_id, author_id, layer, key, opens_at) values (hh, timed, m1, 'words', 'second-key', now());
    report := report || text 'FAIL 09 a layer got a second key';
  exception when others then
    report := report || format('%s 09 one key per layer (%s)', case when sqlstate = '23505' then 'ok  ' else 'FAIL' end, sqlstate);
  end;

  begin
    insert into public.keys (household_id, envelope_id, author_id, layer, key, opens_at) values (hh, timed, m1, 'voice', '', now());
    report := report || text 'FAIL 10 an empty key was accepted';
  exception when others then
    report := report || format('%s 10 an empty key is refused (%s)', case when sqlerrm = 'key_invalid' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;

  -- ---- the time comes (the words only; "how it felt" still waits)
  execute 'reset role';
  execute 'set local session_replication_role = replica';
  update public.keys set opens_at = now() - interval '1 hour', updated_at = now() - interval '2 hours' where id = k_words;
  execute 'set local session_replication_role = origin';
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select count(*), min(layer) into n, txt from public.keys;
  report := report || format('%s 11 from its time on he can fetch that key, and only that one (%s: %s)', case when n = 1 and txt = 'words' then 'ok  ' else 'FAIL' end, n, txt);
  r := public.sync_pull(now() - interval '90 minutes');
  report := report || format('%s 12 sync hands a key over when its time has come, although the row itself did not change (%s key, announcement note sent: %s)',
    case when jsonb_array_length(r -> 'keys') = 1 and not (r -> 'keys' -> 0) ? 'announced_at' then 'ok  ' else 'FAIL' end, jsonb_array_length(r -> 'keys'), (r -> 'keys' -> 0) ? 'announced_at');
  r := public.sync_pull(now() - interval '30 minutes');
  report := report || format('%s 13 and does not repeat it for ever (%s keys for a later cursor)', case when jsonb_array_length(r -> 'keys') = 0 then 'ok  ' else 'FAIL' end, jsonb_array_length(r -> 'keys'));

  -- ---- a key that is out stays out
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  update public.keys set opens_at = now() + interval '1 day' where id = k_words;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.keys where id = k_words;
  report := report || format('%s 14 a key that is out cannot be called back by moving its time (%s still readable)', case when n = 1 then 'ok  ' else 'FAIL' end, n);

  -- ---- he opens and answers; what he opened stays opened
  update public.envelopes set seen = '{"words":"2026-11-13T21:03:00Z","junk":"x"}' where id = timed;
  update public.envelopes set seen = '{"words":"2030-01-01T00:00:00Z","feel":"2026-11-13T21:04:00Z"}', reply = '{"taps":["fire"],"heat":5,"at":"2026-11-13T21:05:00Z"}' where id = timed;
  select seen, reply -> 'taps' ->> 0 into r, txt from public.envelopes where id = timed;
  report := report || format('%s 15 he marks what he opened: first times are kept, new ones added, junk dropped (%s), and his answer is in (%s)',
    case when r = '{"words":"2026-11-13T21:03:00Z","feel":"2026-11-13T21:04:00Z"}'::jsonb and txt = 'fire' then 'ok  ' else 'FAIL' end, r, txt);
  select layers ? 'words' into b from public.envelopes where id = timed;
  report := report || format('%s 16 an envelope that keeps is still there after opening (%s)', case when b then 'ok  ' else 'FAIL' end, b);

  -- ---- one opening: an envelope with words and a voice, open now
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  insert into public.envelopes (id, household_id, author_id, open_mode, keep, layers)
  values (once, hh, m1, 'now', 'once', jsonb_build_object('words', sealed, 'voice', sealed));
  insert into public.keys (id, household_id, envelope_id, author_id, layer, key, opens_at) values
    (k_once_words, hh, once, m1, 'words', 'key-once-words', now()),
    (k_once_voice, hh, once, m1, 'voice', 'key-once-voice', now());
  insert into public.media (id, household_id, envelope_id, author_id, bytes, uploaded) values (sound, hh, once, m1, 4096, true);

  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.keys where envelope_id = once;
  update public.media set deleted_at = now(), uploaded = false where id = sound;
  get diagnostics txt = row_count;
  report := report || format('%s 17 he can fetch both keys of an envelope that is open now (%s) and cannot touch her file (%s rows)', case when n = 2 and txt = '0' then 'ok  ' else 'FAIL' end, n, txt);

  update public.envelopes set seen = '{"words":"2026-11-13T22:00:00Z"}' where id = once;
  select count(*) into n from public.keys where envelope_id = once;
  select layers into r from public.envelopes where id = once;
  select deleted_at is null into b from public.media where id = sound;
  report := report || format('%s 18 opening the words once burns them: the sealed words are gone (%s left), he can fetch %s key, the voice and its file are untouched (%s)',
    case when r = jsonb_build_object('voice', sealed) and n = 1 and b then 'ok  ' else 'FAIL' end, (select string_agg(k, ',') from jsonb_object_keys(r) k), n, b);

  update public.envelopes set seen = '{"voice":"2026-11-13T22:01:00Z"}' where id = once;
  select count(*) into n from public.keys where envelope_id = once;
  select layers = '{}'::jsonb into b from public.envelopes where id = once;
  select deleted_at is not null into txt from public.media where id = sound;
  report := report || format('%s 19 then the voice: nothing sealed is left (%s), no key is left for him (%s), the file is marked gone (%s)', case when b and n = 0 and txt::boolean then 'ok  ' else 'FAIL' end, b, n, txt);

  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  select count(*), bool_and(key = '' and deleted_at is not null) into n, b from public.keys where envelope_id = once;
  report := report || format('%s 20 the author still sees the two rows, emptied: the keys themselves are gone from the cloud (%s rows, emptied: %s)', case when n = 2 and b then 'ok  ' else 'FAIL' end, n, b);
  update public.media set deleted_at = null where id = sound;
  select deleted_at is not null into b from public.media where id = sound;
  report := report || format('%s 21 a file that is gone stays gone (%s)', case when b then 'ok  ' else 'FAIL' end, b);

  -- ---- taking back
  update public.envelopes set deleted_at = now() where id = timed;
  select layers = '{}'::jsonb and teaser is null and heat_outside is null and reply is null into b from public.envelopes where id = timed;
  select count(*) filter (where key <> '') into n from public.keys where envelope_id = timed;
  report := report || format('%s 22 taking an envelope back empties it, outside and answer included (%s), and all its keys (%s still usable)', case when b and n = 0 then 'ok  ' else 'FAIL' end, b, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select count(*) into n from public.keys where envelope_id = timed;
  report := report || format('%s 23 and he can fetch none of them any more (%s)', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  begin
    insert into public.keys (household_id, envelope_id, author_id, layer, key, opens_at) values (hh, timed, m1, 'voice', 'late-key', now());
    report := report || text 'FAIL 24 a key could be added to an envelope that was taken back';
  exception when others then
    report := report || format('%s 24 no key for an envelope that was taken back (%s)', case when sqlerrm = 'forbidden' then 'ok  ' else 'FAIL' end, sqlerrm);
  end;

  -- ---- it works both ways, and nobody seals in the other one's name
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  begin
    insert into public.envelopes (household_id, author_id, teaser) values (hh, m1, 'Not from her');
    report := report || text 'FAIL 25 he could seal an envelope in her name';
  exception when others then
    report := report || format('ok   25 nobody seals in the other one''s name (%s)', sqlstate);
  end;
  insert into public.envelopes (id, household_id, author_id, open_mode) values (his, hh, m2, 'hand');
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  begin
    insert into public.keys (household_id, envelope_id, author_id, layer, key, opens_at) values (hh, his, m1, 'words', 'her-key', now());
    report := report || text 'FAIL 26 she could add a key to his envelope';
  exception when others then
    report := report || format('ok   26 she cannot add a key to his envelope either (%s)', sqlstate);
  end;
  begin
    insert into public.media (household_id, envelope_id, author_id, bytes) values (hh, his, m1, 10);
    report := report || text 'FAIL 27 she could attach a file to his envelope';
  exception when others then
    report := report || format('ok   27 nor a file (%s)', sqlstate);
  end;
  select layers = '{}'::jsonb into b from public.envelopes where id = his;
  select count(*) into n from public.keys where envelope_id = his;
  report := report || format('%s 28 an envelope that opens by hand holds nothing in the cloud until then: no sealed layer (%s), no key (%s)', case when b and n = 0 then 'ok  ' else 'FAIL' end, b, n);

  -- ---- on paper
  execute 'reset role';
  select not has_function_privilege('authenticated', 'private.burn_layers(uuid, text[])', 'execute')
     and not has_function_privilege('authenticated', 'private.guard_envelope()', 'execute')
     and not has_function_privilege('authenticated', 'private.guard_key()', 'execute')
     and not has_table_privilege('authenticated', 'public.keys', 'delete')
     and not has_table_privilege('authenticated', 'public.envelopes', 'delete')
     and not has_table_privilege('anon', 'public.keys', 'select')
     and not has_table_privilege('anon', 'public.envelopes', 'select')
     and (select bool_and(relrowsecurity) from pg_class where oid in ('public.envelopes'::regclass, 'public.keys'::regclass, 'public.media'::regclass)) into b;
  report := report || format('%s 29 on paper too: no deleting, nothing for visitors without a login, row-level security on all three tables (%s)', case when b then 'ok  ' else 'FAIL' end, b);

  raise exception E'SEAL REPORT (rolled back)\n%', array_to_string(report, E'\n');
end
$$;
