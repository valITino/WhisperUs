-- Test for notes, the list and wishes (0004_closer.sql): who may write and read what a
-- person shows about themselves, that an answer on the list reaches the other person
-- only where both answered openly, that a "not for me" cannot exist here at all, what
-- each of the two may write on a wish, what taking back leaves, and which changes are
-- news (and that the news never carries a word of it).
--
-- Run it in the Supabase SQL editor, or locally with supabase/tests/local/run.sh closer.
-- It builds a throwaway second room with three throwaway logins, plays through it, then
-- ROLLS EVERYTHING BACK by ending with an exception whose message is the report.
-- "FAIL" lines mean a hole.
--
-- Safe next to a real room: it touches only its own rows, and nothing is ever sent.
-- pg_net delivers after a commit, and this never commits. While it runs it points the
-- push settings at an address that does not exist; the rollback restores the real ones.

do $$
declare
  u1 uuid := gen_random_uuid(); -- Mia's phone
  u2 uuid := gen_random_uuid(); -- Leo's phone
  u3 uuid := gen_random_uuid(); -- a stranger
  hh uuid := gen_random_uuid();
  m1 uuid := gen_random_uuid();
  m2 uuid := gen_random_uuid();
  note1 uuid := gen_random_uuid();
  l_mia uuid := gen_random_uuid();   -- her answer to "soft.massage"
  l_leo uuid := gen_random_uuid();   -- his answer to "soft.massage"
  l_leo2 uuid := gen_random_uuid();  -- his answer to "play.roles", which she never answers
  l_mia3 uuid := gen_random_uuid();  -- her answer to "words.whisper"
  l_leo3 uuid := gen_random_uuid();  -- his answer to "words.whisper"
  idea1 uuid := gen_random_uuid();
  wish1 uuid := gen_random_uuid();
  wish2 uuid := gen_random_uuid();
  target constant text := 'https://closer-test.invalid/functions/v1/push';
  v_why constant jsonb := '{"chips":["wish.long"],"own":["only with you"],"note":"Because of that evening."}';
  seen integer := 0;
  n integer;
  b boolean;
  txt text;
  r jsonb;
  ev jsonb;
  t1 timestamptz;
  report text[] := '{}';
begin
  insert into auth.users (id, aud, role, is_anonymous, created_at, updated_at) values
    (u1, 'authenticated', 'authenticated', true, now(), now()),
    (u2, 'authenticated', 'authenticated', true, now(), now()),
    (u3, 'authenticated', 'authenticated', true, now(), now());
  insert into public.households (id, name) values (hh, 'Closer test room');
  insert into public.members (id, household_id, name, is_admin) values
    (m1, hh, 'Mia Closertest', true),
    (m2, hh, 'Leo Closertest', false);
  insert into private.member_devices (user_id, member_id) values (u1, m1), (u2, m2);
  delete from private.push_config;
  perform private.push_setup(target, 'https://closer-test.invalid/app/');
  delete from private.push_marks;

  execute 'set local role authenticated';

  -- ------------------------------------------------------------------ notes ----
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  insert into public.notes (id, household_id, member_id, kind, ref, body) values (note1, hh, m1, 'checkin', '2026-11-17.am', '{"close":4,"open":2}');
  select count(*) into n from public.notes where id = note1 and member_id = m1;
  report := report || format('%s 01 she shows two parts of a check-in (%s row)', case when n = 1 then 'ok  ' else 'FAIL' end, n);
  begin
    insert into public.notes (household_id, member_id, kind, ref, body) values (hh, m2, 'about', 'say', '{"value":1}');
    select count(*) into n from public.notes where ref = 'say' and member_id = m2;
    report := report || format('%s 02 she cannot note anything in his name: it is filed as hers (%s rows under his name)', case when n = 0 then 'ok  ' else 'FAIL' end, n);
  exception when others then
    report := report || format('ok   02 she cannot note anything in his name (%s)', sqlstate);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select body into r from public.notes where id = note1;
  update public.notes set body = '{"close":1}', deleted_at = now() where id = note1;
  get diagnostics n = row_count;
  report := report || format('%s 03 he reads what she showed (%s) and can neither change nor remove it (%s rows)', case when r = '{"close":4,"open":2}'::jsonb and n = 0 then 'ok  ' else 'FAIL' end, r, n);
  begin
    delete from public.notes where id = note1;
    report := report || text 'FAIL 04 a note could be deleted for good';
  exception when others then
    report := report || format('ok   04 nothing is ever deleted for good (%s)', sqlstate);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  update public.notes set kind = 'about', ref = 'other', member_id = m2, body = '{}' where id = note1;
  select kind || ' ' || ref, body, member_id = m1 into txt, r, b from public.notes where id = note1;
  report := report || format('%s 05 showing nothing any more empties it; what it is and whose it is cannot change (%s, %s, hers: %s)', case when txt = 'checkin 2026-11-17.am' and r = '{}'::jsonb and b then 'ok  ' else 'FAIL' end, txt, r, b);
  update public.notes set body = '{"mood":5}', deleted_at = now() where id = note1;
  select body into r from public.notes where id = note1;
  report := report || format('%s 06 a note that is taken back is forgotten here (%s)', case when r = '{}'::jsonb then 'ok  ' else 'FAIL' end, r);

  -- --------------------------------------------------------------- the list ----
  insert into public.leanings (id, household_id, member_id, item, lean, pull, why) values (l_mia, hh, m1, 'soft.massage', 'yes', 4, v_why);
  begin
    insert into public.leanings (household_id, member_id, item, lean) values (hh, m1, 'looks.mirrors', 'no');
    report := report || text 'FAIL 07 a "not for me" could be stored in the cloud';
  exception when others then
    report := report || format('ok   07 a "not for me" cannot exist here (%s)', sqlstate);
  end;
  begin
    insert into public.leanings (household_id, member_id, item, lean) values (hh, m1, 'soft.massage', 'maybe');
    report := report || text 'FAIL 08 a second answer to the same item was accepted';
  exception when others then
    report := report || format('ok   08 one answer per person and item (%s)', sqlstate);
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  insert into public.leanings (id, household_id, member_id, item, lean) values (l_leo2, hh, m2, 'play.roles', 'maybe');
  select count(*) into n from public.leanings where member_id = m1;
  r := public.sync_pull(null);
  report := report || format('%s 09 while he has not answered that item he reads nothing of hers: %s by hand, %s rows through sync (his own)', case when n = 0 and jsonb_array_length(r -> 'leanings') = 1 then 'ok  ' else 'FAIL' end, n, jsonb_array_length(r -> 'leanings'));
  update public.leanings set lean = 'dream', pull = 1, deleted_at = now() where id = l_mia;
  get diagnostics n = row_count;
  report := report || format('%s 10 nor can he change it (%s rows)', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  execute 'reset role';
  t1 := clock_timestamp();
  select count(*) into seen from net.http_request_queue where url = target;
  execute 'set local role authenticated';
  insert into public.leanings (id, household_id, member_id, item, lean, pull) values (l_leo, hh, m2, 'soft.massage', 'maybe', 2);
  select count(*) into n from public.leanings where member_id = m1;
  r := public.sync_pull(t1);
  report := report || format('%s 11 once he answers it openly too he reads her answer: %s by hand, and sync hands it over although her row did not change (%s rows)',
    case when n = 1 and jsonb_array_length(r -> 'leanings') = 2 then 'ok  ' else 'FAIL' end, n, jsonb_array_length(r -> 'leanings'));
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  select convert_from(body, 'UTF8')::jsonb into ev from net.http_request_queue where url = target order by id desc limit 1;
  report := report || format('%s 12 that is news for her, once (%s), and it names nothing: %s',
    case when n = seen + 1 and ev = jsonb_build_object('type', 'matched', 'household_id', hh, 'actor_id', m2) then 'ok  ' else 'FAIL' end, n - seen, ev);
  seen := n;
  execute 'set local role authenticated';

  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  select count(*), count(*) filter (where item = 'play.roles') into n, txt from public.leanings where member_id = m2;
  report := report || format('%s 13 she reads his answer where they meet (%s) and not the one she never answered (%s)', case when n = 1 and txt = '0' then 'ok  ' else 'FAIL' end, n, txt);

  -- more in common within ten minutes is not announced again
  insert into public.leanings (id, household_id, member_id, item, lean) values (l_mia3, hh, m1, 'words.whisper', 'yes');
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  insert into public.leanings (id, household_id, member_id, item, lean) values (l_leo3, hh, m2, 'words.whisper', 'yes');
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 14 a second thing in common a moment later does not buzz her phone again (%s)', case when n = seen then 'ok  ' else 'FAIL' end, n - seen);
  execute 'set local role authenticated';

  -- she takes hers back
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  update public.leanings set deleted_at = now() where id = l_mia;
  select l.pull is null and l.why is null into b from public.leanings l where l.id = l_mia;
  select count(*) into n from public.leanings where member_id = m2 and item = 'soft.massage';
  report := report || format('%s 15 taking her answer back empties it (%s), and she no longer reads his (%s)', case when b and n = 0 then 'ok  ' else 'FAIL' end, b, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select count(*) filter (where deleted_at is not null) into n from public.leanings where id = l_mia;
  report := report || format('%s 16 his phone learns that hers is gone (%s)', case when n = 1 then 'ok  ' else 'FAIL' end, n);
  -- and says so again later
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  update public.leanings set deleted_at = null, lean = 'dream', item = 'smuggled.elsewhere', member_id = m2 where id = l_mia;
  select lean || ' ' || item, member_id = m1 and deleted_at is null into txt, b from public.leanings where id = l_mia;
  report := report || format('%s 17 an answer can come back, to the same item and under the same name (%s, %s)', case when txt = 'dream soft.massage' and b then 'ok  ' else 'FAIL' end, txt, b);

  -- ------------------------------------------------------------------ ideas ----
  insert into public.ideas (id, household_id, author_id, label, section) values (idea1, hh, m1, 'Something of our own', 'own');
  begin
    insert into public.ideas (household_id, author_id, label, section) values (hh, m1, '   ', 'own');
    report := report || text 'FAIL 18 an idea without words was accepted';
  exception when others then
    report := report || format('ok   18 an idea needs words (%s)', sqlstate);
  end;
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  select label into txt from public.ideas where id = idea1;
  update public.ideas set label = 'Rewritten', deleted_at = now() where id = idea1;
  get diagnostics n = row_count;
  report := report || format('%s 19 he reads what she wrote onto the list (%s) and cannot rewrite or remove it (%s rows)', case when txt = 'Something of our own' and n = 0 then 'ok  ' else 'FAIL' end, txt, n);
  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  update public.ideas set deleted_at = now() where id = idea1;
  select label into txt from public.ideas where id = idea1;
  report := report || format('%s 20 taken off the list, its words are forgotten here ("%s")', case when txt = '' then 'ok  ' else 'FAIL' end, txt);

  -- ----------------------------------------------------------------- wishes ----
  execute 'reset role';
  select count(*) into seen from net.http_request_queue where url = target;
  execute 'set local role authenticated';
  insert into public.wishes (id, household_id, author_id, text, item, mode, want, why, answer)
  values (wish1, hh, m1, 'A whole evening that is only ours', 'pace.unhurried', 'do', 5, v_why, '{"decision":"yes","forged":true}');
  select answer is null into b from public.wishes where id = wish1;
  report := report || format('%s 21 a new wish starts unanswered, whatever was sent along (%s)', case when b then 'ok  ' else 'FAIL' end, b);
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  select convert_from(body, 'UTF8')::jsonb into ev from net.http_request_queue where url = target order by id desc limit 1;
  report := report || format('%s 22 a wish is news once (%s), with type, room, actor and wish, and not a word of it (%s)',
    case when n = seen + 1 and ev = jsonb_build_object('type', 'wished', 'household_id', hh, 'actor_id', m1, 'wish_id', wish1) then 'ok  ' else 'FAIL' end, n - seen, ev ->> 'type');
  seen := n;
  execute 'set local role authenticated';

  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  update public.wishes set text = 'Rewritten', mode = 'dream', want = 1, why = '{}', item = null, deleted_at = now(), author_id = m2,
                           answer = '{"decision":"later","taps":["glad"],"heat":3,"why":{"chips":[],"own":[],"note":"Not this week."},"at":"2026-11-17T20:00:00Z"}'
  where id = wish1;
  select w.text, w.mode = 'do' and w.want = 5 and w.item = 'pace.unhurried' and w.deleted_at is null and w.author_id = m1 into txt, b
  from public.wishes w where w.id = wish1;
  report := report || format('%s 23 he can answer it, and nothing else: her words stand (%s, intact: %s), his answer is there (%s)',
    case when txt = 'A whole evening that is only ours' and b and (select answer ->> 'decision' from public.wishes where id = wish1) = 'later' then 'ok  ' else 'FAIL' end, txt, b, (select answer ->> 'decision' from public.wishes where id = wish1));
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  select convert_from(body, 'UTF8')::jsonb into ev from net.http_request_queue where url = target order by id desc limit 1;
  report := report || format('%s 24 his answer is news for her, once (%s), and does not say what he decided (%s)',
    case when n = seen + 1 and ev = jsonb_build_object('type', 'decided', 'household_id', hh, 'actor_id', m2, 'wish_id', wish1) then 'ok  ' else 'FAIL' end, n - seen, ev ->> 'type');
  seen := n;
  execute 'set local role authenticated';

  -- rewording the why is not news; a changed decision is; an answer cannot be taken away
  update public.wishes set answer = jsonb_set(answer, '{why,note}', '"Next week, gladly."') where id = wish1;
  update public.wishes set answer = null where id = wish1;
  select answer ->> 'decision' into txt from public.wishes where id = wish1;
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 25 rewording his why is not news (%s), and an answer cannot be taken away (%s)', case when n = seen and txt = 'later' then 'ok  ' else 'FAIL' end, n - seen, txt);
  execute 'set local role authenticated';
  update public.wishes set answer = jsonb_set(answer, '{decision}', '"yes"') where id = wish1;
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  select convert_from(body, 'UTF8')::jsonb ->> 'type' into txt from net.http_request_queue where url = target order by id desc limit 1;
  report := report || format('%s 26 a "not now" that becomes a "yes" is news again (%s, %s)', case when n = seen + 1 and txt = 'decided' then 'ok  ' else 'FAIL' end, n - seen, txt);
  seen := n;
  execute 'set local role authenticated';

  perform set_config('request.jwt.claims', json_build_object('sub', u1, 'role', 'authenticated')::text, true);
  update public.wishes set text = 'Something else entirely', mode = 'dream', want = 1, answer = '{"decision":"yes","forged":true}' where id = wish1;
  select text, answer ? 'forged' into txt, b from public.wishes where id = wish1;
  report := report || format('%s 27 she cannot write his answer, and what was answered stays as it was answered (%s, forged: %s)', case when txt = 'A whole evening that is only ours' and not b then 'ok  ' else 'FAIL' end, txt, b);
  update public.wishes set deleted_at = now() where id = wish1;
  select w.text = '' and w.item is null and w.want is null and w.answer is null and w.why = '{"chips":[],"own":[],"note":null}'::jsonb into b from public.wishes w where w.id = wish1;
  execute 'reset role';
  select count(*) into n from net.http_request_queue where url = target;
  report := report || format('%s 28 taking it back makes the cloud forget its words, its why and the answer (%s), quietly (%s)', case when b and n = seen then 'ok  ' else 'FAIL' end, b, n - seen);
  execute 'set local role authenticated';

  -- an unanswered wish can still be reworded; one without words cannot exist
  insert into public.wishes (id, household_id, author_id, text, mode) values (wish2, hh, m1, 'First wording', 'dream');
  update public.wishes set text = 'Second wording' where id = wish2;
  select text into txt from public.wishes where id = wish2;
  begin
    update public.wishes set text = '  ' where id = wish2;
    report := report || text 'FAIL 29 a wish without words was accepted';
  exception when others then
    report := report || format('ok   29 while unanswered she can reword it (%s), but not to nothing (%s)', txt, sqlstate);
  end;

  -- --------------------------------------------------------------- a stranger ----
  perform set_config('request.jwt.claims', json_build_object('sub', u3, 'role', 'authenticated')::text, true);
  select (select count(*) from public.notes) + (select count(*) from public.leanings) + (select count(*) from public.ideas) + (select count(*) from public.wishes) into n;
  report := report || format('%s 30 a stranger reads no note, answer, idea or wish (%s rows)', case when n = 0 then 'ok  ' else 'FAIL' end, n);
  begin
    insert into public.wishes (household_id, author_id, text) values (hh, m1, 'From outside');
    report := report || text 'FAIL 31 a stranger could put a wish into the room';
  exception when others then
    report := report || format('ok   31 and writes none (%s)', sqlstate);
  end;
  begin
    insert into public.leanings (household_id, member_id, item, lean) values (hh, m2, 'soft.massage', 'yes');
    report := report || text 'FAIL 32 a stranger could answer on the list';
  exception when others then
    report := report || format('ok   32 nor an answer on the list (%s)', sqlstate);
  end;
  update public.wishes set answer = '{"decision":"no"}' where id = wish2;
  get diagnostics n = row_count;
  report := report || format('%s 33 nor an answer to a wish (%s rows)', case when n = 0 then 'ok  ' else 'FAIL' end, n);

  -- ------------------------------------------------------- the check-in reminder ----
  execute 'reset role';
  select count(*) into seen from net.http_request_queue where url = target;
  delete from private.push_marks where kind = 'checkin';
  txt := to_char(now() at time zone 'Europe/Zurich', 'HH24:MI');
  update public.members set prefs = jsonb_build_object('checkin', jsonb_build_object('remind', true, 'times', jsonb_build_array('03:07', txt))) where id = m1;
  update public.members set prefs = jsonb_build_object('checkin', jsonb_build_object('remind', false, 'times', jsonb_build_array(txt, txt))) where id = m2;
  n := private.remind_checkins();
  select convert_from(body, 'UTF8')::jsonb into ev from net.http_request_queue where url = target order by id desc limit 1;
  report := report || format('%s 34 at the minute she asked for, she alone is reminded (%s), and the call names no one else (%s)',
    case when n >= 1 and ev = jsonb_build_object('type', 'checkin', 'household_id', hh, 'actor_id', m1) and (select count(*) from net.http_request_queue where url = target) = seen + 1 then 'ok  ' else 'FAIL' end, n, ev ->> 'type');
  n := private.remind_checkins();
  report := report || format('%s 35 asking again within the same minute reminds nobody twice (%s more for this room)', case when (select count(*) from net.http_request_queue where url = target) = seen + 1 then 'ok  ' else 'FAIL' end, (select count(*) from net.http_request_queue where url = target) - seen - 1);
  delete from private.push_marks where kind = 'checkin';
  update public.members set prefs = '{"checkin":"soon"}' where id = m1;
  update public.members set prefs = jsonb_build_object('checkin', jsonb_build_object('remind', true, 'times', txt)) where id = m2;
  begin
    n := private.remind_checkins();
    report := report || format('%s 36 settings that make no sense remind nobody and break nothing (%s for this room)', case when (select count(*) from net.http_request_queue where url = target) = seen + 1 then 'ok  ' else 'FAIL' end, (select count(*) from net.http_request_queue where url = target) - seen - 1);
  exception when others then
    report := report || format('FAIL 36 misshapen settings broke the reminder job (%s)', sqlerrm);
  end;
  update public.members set prefs = jsonb_build_object('checkin', jsonb_build_object('remind', true, 'times', jsonb_build_array(txt, '21:00'))), disabled_at = now() where id = m1;
  n := private.remind_checkins();
  report := report || format('%s 37 a paused seat is not reminded (%s for this room)', case when (select count(*) from net.http_request_queue where url = target) = seen + 1 then 'ok  ' else 'FAIL' end, (select count(*) from net.http_request_queue where url = target) - seen - 1);
  update public.members set disabled_at = null where id = m1;

  -- a device can mute the new kinds, and only kinds that exist
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims', json_build_object('sub', u2, 'role', 'authenticated')::text, true);
  perform public.save_push_subscription('https://closer-test.invalid/send/leo', 'p256dh-of-leo', 'auth-of-leo', array['checkin', 'gossip', 'wished', 'sealed']);
  execute 'reset role';
  select array_to_string(muted_types, ',') into txt from public.push_subscriptions where endpoint = 'https://closer-test.invalid/send/leo';
  report := report || format('%s 38 a device can mute the new kinds, and only kinds that exist (%s)', case when txt = 'sealed,wished,checkin' then 'ok  ' else 'FAIL' end, txt);

  -- --------------------------------------------------------------- on paper ----
  select not has_function_privilege('authenticated', 'private.guard_note()', 'execute')
     and not has_function_privilege('authenticated', 'private.guard_leaning()', 'execute')
     and not has_function_privilege('authenticated', 'private.guard_idea()', 'execute')
     and not has_function_privilege('authenticated', 'private.guard_wish()', 'execute')
     and not has_function_privilege('authenticated', 'private.send_news(jsonb)', 'execute')
     and not has_function_privilege('authenticated', 'private.remind_checkins()', 'execute')
     and not has_function_privilege('anon', 'private.i_lean(text)', 'execute')
     and has_function_privilege('authenticated', 'private.i_lean(text)', 'execute')
     and not has_table_privilege('authenticated', 'private.push_marks', 'select')
     and (select bool_and(not has_table_privilege('authenticated', c.oid, 'delete') and not has_table_privilege('anon', c.oid, 'select') and c.relrowsecurity)
          from pg_class c where c.oid in ('public.notes'::regclass, 'public.leanings'::regclass, 'public.ideas'::regclass, 'public.wishes'::regclass)) into b;
  report := report || format('%s 39 on paper too: no deleting, nothing for visitors without a login, row-level security on all four tables, the helpers out of reach (%s)', case when b then 'ok  ' else 'FAIL' end, b);

  raise exception E'CLOSER REPORT (rolled back)\n%', array_to_string(report, E'\n');
end
$$;
