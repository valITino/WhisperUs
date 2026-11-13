-- Just enough of a Supabase project to apply supabase/migrations to a plain, empty
-- PostgreSQL database on this machine and run the SQL tests against it
-- (supabase/tests/local/run.sh). Nothing here is ever applied to the real project.
--
-- What is stood in for: the API roles, auth.users and auth.uid(), the "extensions"
-- schema with pgcrypto, storage's two tables, the realtime publication, pg_cron's
-- schedule() and pg_net's http_post(). The stand-in for pg_net only writes the request
-- into its queue table, which is what the real one does before its worker sends it.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

-- Supabase gives the API roles rights on everything created in "public" by default.
-- The migrations take away what must not be reachable; keep that starting point honest.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  aud text,
  role text,
  is_anonymous boolean not null default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create function auth.uid() returns uuid
language sql stable
as $fn$
  select (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')::uuid
$fn$;

create schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension pgcrypto with schema extensions;

create schema storage;
grant usage on schema storage to anon, authenticated, service_role;
create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text references storage.buckets (id),
  name text
);
alter table storage.objects enable row level security;
-- As in Supabase: the API roles may touch the table, the policies decide which rows.
grant all on storage.objects, storage.buckets to anon, authenticated, service_role;
create function storage.foldername(name text) returns text[]
language sql immutable
as $fn$
  select (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1]
$fn$;

set client_min_messages = error; -- (a plain server warns that it cannot publish; nothing here needs it to)
create publication supabase_realtime;
reset client_min_messages;

create schema cron;
create table cron.job (jobid bigserial primary key, jobname text unique, schedule text, command text);
create function cron.schedule(job_name text, schedule text, command text) returns bigint
language sql
as $fn$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid
$fn$;

create schema net;
create table net.http_request_queue (
  id bigserial primary key,
  method text not null,
  url text not null,
  headers jsonb,
  body bytea,
  timeout_milliseconds integer
);
create function net.http_post(
  url text,
  body jsonb default '{}'::jsonb,
  params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb,
  timeout_milliseconds integer default 2000
) returns bigint
language plpgsql
as $fn$
declare
  v_id bigint;
begin
  -- For the test that a failing call never makes a write fail.
  if url like '%/explode' then
    raise exception 'pg_net stand-in: asked to explode';
  end if;
  insert into net.http_request_queue (method, url, headers, body, timeout_milliseconds)
  values ('POST', url, headers, convert_to(body::text, 'UTF8'), timeout_milliseconds)
  returning id into v_id;
  return v_id;
end
$fn$;
-- Lets a test know it runs against the stand-in, where it may ask for an explosion.
create function net.is_stand_in() returns boolean language sql immutable as $fn$ select true $fn$;
