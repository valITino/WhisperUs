# Push notifications: switching them on

The other one gets a notification when something was sealed for them, when an envelope
opens for them, and when their envelope was answered.

**A notification says who and when, never what.** It is read on a lock screen, by anybody
who picks the phone up. So the words never carry what is inside an envelope, nor the line
on its outside: "Mia sealed something. It opens tonight at 22:00." The function does not
even ask the database for those columns, and never for a key.

How it travels:

1. A change reaches the database. A trigger (`supabase/migrations/0003_push.sql`) notices
   one of the three events and asks `pg_net` to call this function once the change is
   saved. For an envelope that opens at a time, a job that runs every minute
   (`private.announce_due`) does the same when the time has come.
2. This function looks up who should hear about it (the other person, on every device
   that did not mute this kind), checks that the news is still true, writes the words in
   their language and sends each device one Web Push message, signed with the room's
   VAPID key.
3. The service worker on the phone (`src/sw/sw.ts`) shows the notification and opens the
   envelope on a tap. A phone with an app lock asks for its code first.

## Nobody copies a secret anywhere

There is nothing to type into a dashboard and nothing to put into the app's build.

- The **shared secret** that the triggers send along is made inside the database.
- The **VAPID key pair** is made by the function itself the first time it is asked, and
  stored in the database.
- Both live in one row of `private.push_config`, which the API cannot read. The function
  fetches them with the service role key that Supabase gives every function by itself.
- The **app** asks the database for the public half of the key pair when the
  Notifications page opens. Until there is one it says "not set up yet".

Until step 3 below is done, the triggers do nothing. The migration is safe to apply first.

## Steps

### 1. Apply the migration

Apply `supabase/migrations/0003_push.sql` as it is, after the two before it. It needs the
extensions `pg_net` and `pg_cron` (Database, Extensions).

Optional check: run `supabase/tests/push_test.sql` as one SQL statement. It ends with
an error on purpose. The error message is the report, `PUSH REPORT (rolled back)`,
followed by lines that should all start with `ok`. It builds its own throwaway room,
rolls everything back and sends nothing, so it is safe next to the real room.

### 2. Deploy the function

```bash
npm run build:push
```

That writes the whole function into one plain file,
`supabase/functions/push/dist/index.js`, and prints its size and SHA-256. Deploy that
file's text as the function `push`, under the file name `index.ts` (it is plain
JavaScript, which is fine there), with **JWT verification off** (`verify_jwt: false`).
The database calls the function without a login. The function checks the shared secret
itself and refuses everything else.

The file has no imports, no backslashes and, beyond plain ASCII, only the letters ö and ü.
The four source files (`index.ts`, `handler.ts`, `logic.ts`, `webpush.ts`) can be
deployed instead; it is the same code.

The function needs no secrets set. A call without the secret is refused:

```bash
curl -i -X POST https://<project-ref>.supabase.co/functions/v1/push -d '{}'
```

Expected: `401` and `{"error":"wrong_secret"}`.

### 3. Tell the database where the function lives

One statement, in the SQL editor. The second address is where the app lives: push
services show it to nobody, they only want to know whom the messages come from.

```sql
select private.push_setup(
  'https://<project-ref>.supabase.co/functions/v1/push',
  'https://valitino.github.io/WhisperUs/'
);
```

This also makes the shared secret. It is never shown. Running the statement again
later changes the two addresses and keeps the secret and the keys.

### 4. Make the keys, once

One statement. It sends the function an `init` event, with the address and the secret
read from the database itself:

```sql
select net.http_post(
  url := function_url,
  body := '{"type":"init"}'::jsonb,
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', secret),
  timeout_milliseconds := 8000
)
from private.push_config;
```

### 5. Check that it worked

```sql
select status_code, content::text, created
from net._http_response
order by created desc
limit 1;
```

Expected: `200` and `{"ok":true,"publicKey":"B..."}`. And the database has the pair:

```sql
select vapid_public is not null as keys_ready, updated_at from private.push_config;
```

If the answer was `500` with `not_set_up`, the function looked a moment before step 3
was done. Wait ten seconds and run step 4 again.

### 6. Turn them on, on each phone

Us, Notifications, "Turn on notifications", then "Allow" when Chrome asks. Each device
is turned on by itself, and each can mute any of the three kinds. No new version of the
app is needed.

## Checking that it works

Have one person seal something "Right away" while the other has notifications on. Then
look at what the function answered:

```sql
select id, status_code, content::text, created
from net._http_response
order by created desc
limit 5;
```

- `200` with `{"type":"opened","sent":1,"gone":0,"failed":0}`: delivered to one device.
- `sent: 0`: nobody to tell. The other person has no device signed up, muted this kind,
  is paused, or the news was stale by the time it arrived.
- `gone: 1`: a device's subscription had expired. Its row was removed. The phone signs
  up again by itself the next time the app is opened.
- `failed: 1`: the push service refused. Usually the device signed up with keys that
  have been replaced since; it signs up again by itself the next time the app is opened.
- `401`: the function has an older secret in mind. It looks again by itself; the next
  event goes through.
- `500` with `not_set_up`: there is no row in `private.push_config` (step 3).
- No row at all in `net._http_response`: the triggers did nothing. Check
  `select function_url from private.push_config;`.

The function's own log (Edge Functions, `push`, Logs) shows every call.

## Switching notifications off again

```sql
delete from private.push_config;
```

The triggers go quiet at once and the app says "not set up yet". This also throws the
secret and the keys away. To switch on again, repeat steps 3 and 4. The phones that had
notifications on sign up again by themselves the next time the app is opened.

## A new secret

Only needed if the secret may have been seen by somebody.

```sql
select private.push_new_secret();
```

Nothing else to do: the function notices the first time the new secret arrives and
fetches its settings again. An event sent in that very moment may be lost.

## New keys

Only needed if the private key may have been seen by somebody.

```sql
select private.push_forget_keys();
```

Then run the statement from step 4 again: the function makes a new pair. Every phone
signs up again by itself the next time the app is opened; until then it gets nothing.
Copies of the function that are already running may keep using the old pair for up to
five minutes.

## What is deployed right now

Nothing yet. The room's Supabase project does not exist at the time of writing (PLAN.md,
"Open right now"). When it does, note here what was applied and deployed, and what the
checks answered.

One way to deploy without copying anything by hand is a one-line loader that imports this
folder's `index.ts` from GitHub at one fixed commit, so that what runs is exactly what was
tested:

```ts
import 'https://raw.githubusercontent.com/valITino/WhisperUs/<commit>/supabase/functions/push/index.ts'
```

To ship a change to the function: commit and push it, then deploy the loader again with the
new commit in the address. Pasting the single file from `npm run build:push` works too.

## What is in this folder

| File | What it does |
| --- | --- |
| `index.ts` | The Deno entry point. Hands requests to `handler.ts`, with the project's address and the service role key. |
| `handler.ts` | Fetches its settings, checks the secret, makes the keys when asked, reads the room, sends, removes devices that are gone. |
| `logic.ts` | The rules, free of any machinery: which changes are events, whether the news is still true, who gets told, the words in English and German. The pretend cloud for local development runs the same file, and the app words opening times with it. |
| `webpush.ts` | Web Push encryption (RFC 8291) and VAPID signing (RFC 8292) with Web Crypto. |
| `dist/index.js` | All of the above in one file, made by `npm run build:push`. Not in the repository. |

Everything except `index.ts` is covered by unit tests (`tests/unit/push.*.test.ts`), which
run the whole handler against a stand-in database and a stand-in push service and check
the encryption against the example in the RFC. One of them builds `dist/index.js` and
runs calls through that very file. The database side is covered by
`supabase/tests/push_test.sql`.

## Limits to know

- One call per event. The free plan includes 500,000 calls a month.
- A timed envelope is announced by the minute job, so its notification can be up to a
  minute late. The envelope itself opens on time: an open app fetches the key at the moment.
- A notification is a nicety: if the function is down, the write still goes through and
  the app shows the news the next time it is opened. Nothing is retried.
- Chrome on Android delivers to an installed app and to a plain browser tab alike, as
  long as Chrome itself may show notifications.
