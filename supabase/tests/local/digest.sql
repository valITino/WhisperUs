-- A fingerprint of everything the migrations make: functions, tables, rights, policies,
-- triggers, indexes and checks. Run it on a live project (SQL editor) and locally
-- (supabase/tests/local/run.sh digest): the same lines mean the live database is what
-- the migration files say, statement for statement. It reads catalogues only.
with items as (
  select 'functions' as kind,
         n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as name,
         p.prosrc || '|' || p.prosecdef::text || '|' || p.provolatile::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') || '|' || pg_get_function_result(p.oid) as body
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' or (n.nspname = 'public' and p.proname <> 'rls_auto_enable')
  union all
  select 'function rights',
         n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
         'anon:' || has_function_privilege('anon', p.oid, 'execute') || ' authenticated:' || has_function_privilege('authenticated', p.oid, 'execute')
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'private' or (n.nspname = 'public' and p.proname <> 'rls_auto_enable')
  union all
  select 'columns', c.table_schema || '.' || c.table_name || '.' || c.column_name,
         c.data_type || '|' || c.is_nullable || '|' || coalesce(c.column_default, '')
  from information_schema.columns c where c.table_schema in ('public', 'private')
  union all
  select 'row-level security', n.nspname || '.' || c.relname, c.relrowsecurity::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and n.nspname in ('public', 'private')
  union all
  select 'table rights', n.nspname || '.' || c.relname || ' ' || r.role || ' ' || p.privilege,
         has_table_privilege(r.role, c.oid, p.privilege)::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r (role)
  cross join (values ('select'), ('insert'), ('update'), ('delete'), ('truncate')) p (privilege)
  where c.relkind = 'r' and n.nspname in ('public', 'private')
  union all
  select 'column rights', a.attrelid::regclass::text || '.' || a.attname || ' ' || r.role,
         'update:' || has_column_privilege(r.role, a.attrelid, a.attname, 'update') || ' insert:' || has_column_privilege(r.role, a.attrelid, a.attname, 'insert')
  from pg_attribute a join pg_class c on c.oid = a.attrelid join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r (role)
  where c.relkind = 'r' and n.nspname in ('public', 'private') and a.attnum > 0 and not a.attisdropped
  union all
  select 'policies', schemaname || '.' || tablename || ' "' || policyname || '"',
         cmd || '|' || array_to_string(roles, ',') || '|' || coalesce(qual, '') || '|' || coalesce(with_check, '')
  from pg_policies
  where schemaname in ('public', 'private') or (schemaname = 'storage' and policyname like 'room members%')
  union all
  select 'triggers', t.tgrelid::regclass::text || '.' || t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
  where not t.tgisinternal and n.nspname in ('public', 'private')
  union all
  select 'indexes', schemaname || '.' || indexname, indexdef from pg_indexes where schemaname in ('public', 'private')
  union all
  select 'checks and keys', conrelid::regclass::text || '.' || conname, pg_get_constraintdef(oid)
  from pg_constraint
  where connamespace in (select oid from pg_namespace where nspname in ('public', 'private')) and conrelid <> 0
)
select kind, count(*) as items, md5(string_agg(name || '=' || md5(body), ';' order by name)) as fingerprint
from items group by kind order by kind;
