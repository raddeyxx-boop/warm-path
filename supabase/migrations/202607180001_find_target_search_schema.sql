-- Step 3: schema support for authenticated target searches and per-user caching.
-- This migration is additive and intentionally leaves legacy ownership columns nullable.

alter table public.workflow_runs
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.workflow_runs
add column if not exists status text not null default 'queued';

alter table public.workflow_runs
add column if not exists created_at timestamptz not null default now();

alter table public.workflow_runs
add column if not exists started_at timestamptz;

alter table public.workflow_runs
add column if not exists completed_at timestamptz;

alter table public.workflow_runs
add column if not exists failed_at timestamptz;

alter table public.workflow_runs
add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'workflow_runs_find_target_status_check'
      and conrelid = 'public.workflow_runs'::regclass
  ) then
    alter table public.workflow_runs
    add constraint workflow_runs_find_target_status_check
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')) not valid;
  end if;
end $$;

alter table public.ranked_candidates
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.ranked_candidates
add column if not exists workflow_run_id uuid references public.workflow_runs(id) on delete set null;

alter table public.top_candidates
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.top_candidates
add column if not exists workflow_run_id uuid references public.workflow_runs(id) on delete set null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any (c.conkey)
    where c.conrelid = 'public.ranked_candidates'::regclass
      and c.confrelid = 'public.workflow_runs'::regclass
      and c.contype = 'f'
      and a.attname = 'workflow_run_id'
  ) then
    alter table public.ranked_candidates
    add constraint ranked_candidates_workflow_run_id_fkey
    foreign key (workflow_run_id) references public.workflow_runs(id) on delete set null;
  end if;

  if not exists (
    select 1
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid
     and a.attnum = any (c.conkey)
    where c.conrelid = 'public.top_candidates'::regclass
      and c.confrelid = 'public.workflow_runs'::regclass
      and c.contype = 'f'
      and a.attname = 'workflow_run_id'
  ) then
    alter table public.top_candidates
    add constraint top_candidates_workflow_run_id_fkey
    foreign key (workflow_run_id) references public.workflow_runs(id) on delete set null;
  end if;
end $$;

create table if not exists public.search_requests (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  workflow_run_id uuid references public.workflow_runs(id) on delete set null,
  target_name text not null,
  current_company text not null,
  linkedin_name text not null,
  location text not null,
  keywords text,
  company_filter text,
  school_filter text,
  normalized_search_key text not null,
  status text not null default 'queued'
    check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  cache_hit boolean not null default false,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  error_message text,
  updated_at timestamptz not null default now(),
  check (btrim(normalized_search_key) <> '')
);

create table if not exists public.search_cache (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  normalized_search_key text not null,
  source_workflow_run_id uuid references public.workflow_runs(id) on delete set null,
  candidate_snapshot jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days'),
  updated_at timestamptz not null default now(),
  check (btrim(normalized_search_key) <> ''),
  check (jsonb_typeof(candidate_snapshot) = 'array'),
  constraint search_cache_owner_key_unique unique (owner_user_id, normalized_search_key)
);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists workflow_runs_set_updated_at on public.workflow_runs;
create trigger workflow_runs_set_updated_at
before update on public.workflow_runs
for each row execute function public.set_updated_at();

drop trigger if exists search_requests_set_updated_at on public.search_requests;
create trigger search_requests_set_updated_at
before update on public.search_requests
for each row execute function public.set_updated_at();

drop trigger if exists search_cache_set_updated_at on public.search_cache;
create trigger search_cache_set_updated_at
before update on public.search_cache
for each row execute function public.set_updated_at();

create or replace function public.inherit_workflow_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  workflow_owner uuid;
begin
  if new.workflow_run_id is not null then
    select owner_user_id into workflow_owner
    from public.workflow_runs
    where id = new.workflow_run_id;

    if workflow_owner is null then
      raise exception 'Referenced workflow run must have an owner';
    end if;

    if new.owner_user_id is null then
      new.owner_user_id = workflow_owner;
    elsif new.owner_user_id <> workflow_owner then
      raise exception 'Candidate owner must match workflow run owner';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists ranked_candidates_inherit_workflow_owner on public.ranked_candidates;
create trigger ranked_candidates_inherit_workflow_owner
before insert or update of workflow_run_id, owner_user_id on public.ranked_candidates
for each row execute function public.inherit_workflow_owner();

drop trigger if exists top_candidates_inherit_workflow_owner on public.top_candidates;
create trigger top_candidates_inherit_workflow_owner
before insert or update of workflow_run_id, owner_user_id on public.top_candidates
for each row execute function public.inherit_workflow_owner();

create or replace function public.enforce_related_workflow_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  related_run_id uuid;
  workflow_owner uuid;
begin
  if tg_table_name = 'search_requests' then
    related_run_id := new.workflow_run_id;
  else
    related_run_id := new.source_workflow_run_id;
  end if;

  if related_run_id is not null then
    select owner_user_id into workflow_owner
    from public.workflow_runs
    where id = related_run_id;

    if workflow_owner is null or workflow_owner <> new.owner_user_id then
      raise exception 'Related workflow run owner must match record owner';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists search_requests_enforce_workflow_owner on public.search_requests;
create trigger search_requests_enforce_workflow_owner
before insert or update of workflow_run_id, owner_user_id on public.search_requests
for each row execute function public.enforce_related_workflow_owner();

drop trigger if exists search_cache_enforce_workflow_owner on public.search_cache;
create trigger search_cache_enforce_workflow_owner
before insert or update of source_workflow_run_id, owner_user_id on public.search_cache
for each row execute function public.enforce_related_workflow_owner();

create index if not exists workflow_runs_owner_user_id_idx
on public.workflow_runs (owner_user_id);

create index if not exists workflow_runs_status_idx
on public.workflow_runs (status);

create index if not exists ranked_candidates_workflow_run_id_idx
on public.ranked_candidates (workflow_run_id);

create index if not exists ranked_candidates_owner_user_id_idx
on public.ranked_candidates (owner_user_id);

create index if not exists top_candidates_workflow_run_id_idx
on public.top_candidates (workflow_run_id);

create index if not exists top_candidates_owner_user_id_idx
on public.top_candidates (owner_user_id);

create index if not exists search_requests_owner_created_at_idx
on public.search_requests (owner_user_id, created_at desc);

create index if not exists search_requests_owner_status_idx
on public.search_requests (owner_user_id, status);

create unique index if not exists search_requests_one_active_per_owner_idx
on public.search_requests (owner_user_id)
where status in ('queued', 'running');

create index if not exists search_requests_workflow_run_id_idx
on public.search_requests (workflow_run_id)
where workflow_run_id is not null;

create index if not exists search_cache_lookup_idx
on public.search_cache (owner_user_id, normalized_search_key, expires_at);

create index if not exists search_cache_expires_at_idx
on public.search_cache (expires_at);

create index if not exists search_cache_source_workflow_run_id_idx
on public.search_cache (source_workflow_run_id)
where source_workflow_run_id is not null;

alter table public.workflow_runs enable row level security;
alter table public.ranked_candidates enable row level security;
alter table public.top_candidates enable row level security;
alter table public.search_requests enable row level security;
alter table public.search_cache enable row level security;

drop policy if exists "search_requests_select_own_or_admin" on public.search_requests;
drop policy if exists "search_requests_insert_own_or_admin" on public.search_requests;
drop policy if exists "search_requests_update_own_or_admin" on public.search_requests;
drop policy if exists "search_requests_delete_own_or_admin" on public.search_requests;

create policy "search_requests_select_own_or_admin"
on public.search_requests for select to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "search_requests_insert_own_or_admin"
on public.search_requests for insert to authenticated
with check (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "search_requests_update_own_or_admin"
on public.search_requests for update to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()))
with check (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "search_requests_delete_own_or_admin"
on public.search_requests for delete to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

drop policy if exists "search_cache_select_own_or_admin" on public.search_cache;
drop policy if exists "search_cache_insert_own_or_admin" on public.search_cache;
drop policy if exists "search_cache_update_own_or_admin" on public.search_cache;
drop policy if exists "search_cache_delete_own_or_admin" on public.search_cache;

create policy "search_cache_select_own_or_admin"
on public.search_cache for select to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "search_cache_insert_own_or_admin"
on public.search_cache for insert to authenticated
with check (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "search_cache_update_own_or_admin"
on public.search_cache for update to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()))
with check (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "search_cache_delete_own_or_admin"
on public.search_cache for delete to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));
