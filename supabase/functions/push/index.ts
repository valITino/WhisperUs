// Supabase Edge Function "push": turns one room event into notifications on the
// partner's devices. Deploy with JWT verification off: the database calls it with a
// shared secret instead (see README.md in this folder). All the work is in handler.ts.
//
// It needs no secrets of its own. Supabase gives every function these two.

import { pushHandler } from './handler.ts'

Deno.serve(pushHandler({ supabaseUrl: Deno.env.get('SUPABASE_URL') ?? '', serviceRoleKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '' }))
