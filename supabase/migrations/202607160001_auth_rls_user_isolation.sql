create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  full_name text,
  role text not null default 'user' check (role in ('admin', 'user')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists profiles_email_lower_unique
on public.profiles (lower(email))
where email is not null;

create index if not exists profiles_role_idx on public.profiles(role);

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

drop trigger if exists profiles_set_updated_at on public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row
execute function public.set_updated_at();

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, is_active)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    'user',
    true
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = case
      when excluded.full_name <> '' then excluded.full_name
      else public.profiles.full_name
    end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert or update of email, raw_user_meta_data
on auth.users
for each row
execute function public.handle_new_auth_user();

insert into public.profiles (id, email, full_name, role, is_active)
select
  u.id,
  u.email,
  coalesce(u.raw_user_meta_data ->> 'full_name', ''),
  'user',
  true
from auth.users u
on conflict (id) do update
set email = excluded.email;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and is_active = true
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to authenticated;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and is_active = true
  );
$$;

revoke all on function public.is_active_user() from public;
grant execute on function public.is_active_user() to authenticated;

alter table public.workflow_runs
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.ranked_candidates
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

alter table public.top_candidates
add column if not exists owner_user_id uuid references auth.users(id) on delete cascade;

create index if not exists workflow_runs_owner_user_id_idx on public.workflow_runs(owner_user_id);
create index if not exists ranked_candidates_owner_user_id_idx on public.ranked_candidates(owner_user_id);
create index if not exists top_candidates_owner_user_id_idx on public.top_candidates(owner_user_id);

create or replace function public.inherit_workflow_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.owner_user_id is null and new.workflow_run_id is not null then
    select owner_user_id
    into new.owner_user_id
    from public.workflow_runs
    where id = new.workflow_run_id;
  end if;

  return new;
end;
$$;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ranked_candidates'
      and column_name = 'workflow_run_id'
      and udt_name = 'uuid'
  ) then
    drop trigger if exists ranked_candidates_inherit_workflow_owner on public.ranked_candidates;
    create trigger ranked_candidates_inherit_workflow_owner
    before insert or update of workflow_run_id, owner_user_id
    on public.ranked_candidates
    for each row
    execute function public.inherit_workflow_owner();
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'top_candidates'
      and column_name = 'workflow_run_id'
      and udt_name = 'uuid'
  ) then
    drop trigger if exists top_candidates_inherit_workflow_owner on public.top_candidates;
    create trigger top_candidates_inherit_workflow_owner
    before insert or update of workflow_run_id, owner_user_id
    on public.top_candidates
    for each row
    execute function public.inherit_workflow_owner();
  end if;
end $$;

alter table public.profiles enable row level security;
alter table public.workflow_runs enable row level security;
alter table public.ranked_candidates enable row level security;
alter table public.top_candidates enable row level security;

do $$
declare
  policy_record record;
begin
  for policy_record in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public'
      and tablename in ('profiles', 'workflow_runs', 'ranked_candidates', 'top_candidates')
      and (
        coalesce(qual, '') in ('true', '(true)')
        or coalesce(with_check, '') in ('true', '(true)')
      )
  loop
    execute format('drop policy if exists %I on %I.%I', policy_record.policyname, policy_record.schemaname, policy_record.tablename);
  end loop;
end $$;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
drop policy if exists "profiles_admin_update" on public.profiles;
drop policy if exists "profiles_admin_delete" on public.profiles;

create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (((id = (select auth.uid())) and is_active = true) or public.is_admin());

create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

create policy "profiles_admin_delete"
on public.profiles
for delete
to authenticated
using (public.is_admin());

drop policy if exists "workflow_runs_select_own_or_admin" on public.workflow_runs;
drop policy if exists "workflow_runs_insert_own_or_admin" on public.workflow_runs;
drop policy if exists "workflow_runs_update_own_or_admin" on public.workflow_runs;
drop policy if exists "workflow_runs_delete_admin" on public.workflow_runs;

create policy "workflow_runs_select_own_or_admin"
on public.workflow_runs
for select
to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "workflow_runs_insert_own_or_admin"
on public.workflow_runs
for insert
to authenticated
with check (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "workflow_runs_update_own_or_admin"
on public.workflow_runs
for update
to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()))
with check (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "workflow_runs_delete_admin"
on public.workflow_runs
for delete
to authenticated
using (public.is_admin());

drop policy if exists "ranked_candidates_select_own_or_admin" on public.ranked_candidates;
drop policy if exists "ranked_candidates_insert_own_or_admin" on public.ranked_candidates;
drop policy if exists "ranked_candidates_update_own_or_admin" on public.ranked_candidates;
drop policy if exists "ranked_candidates_delete_admin" on public.ranked_candidates;

create policy "ranked_candidates_select_own_or_admin"
on public.ranked_candidates
for select
to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "ranked_candidates_insert_own_or_admin"
on public.ranked_candidates
for insert
to authenticated
with check (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "ranked_candidates_update_own_or_admin"
on public.ranked_candidates
for update
to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()))
with check (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "ranked_candidates_delete_admin"
on public.ranked_candidates
for delete
to authenticated
using (public.is_admin());

drop policy if exists "top_candidates_select_own_or_admin" on public.top_candidates;
drop policy if exists "top_candidates_insert_own_or_admin" on public.top_candidates;
drop policy if exists "top_candidates_update_own_or_admin" on public.top_candidates;
drop policy if exists "top_candidates_delete_admin" on public.top_candidates;

create policy "top_candidates_select_own_or_admin"
on public.top_candidates
for select
to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "top_candidates_insert_own_or_admin"
on public.top_candidates
for insert
to authenticated
with check (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "top_candidates_update_own_or_admin"
on public.top_candidates
for update
to authenticated
using (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()))
with check (public.is_active_user() and (owner_user_id = (select auth.uid()) or public.is_admin()));

create policy "top_candidates_delete_admin"
on public.top_candidates
for delete
to authenticated
using (public.is_admin());
