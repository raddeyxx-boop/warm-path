-- Secure self-registration approval workflow.
-- Existing accounts remain approved; new Auth users default to pending.

alter table public.profiles
add column if not exists contact_number text;

alter table public.profiles
add column if not exists approval_status text;

alter table public.profiles
add column if not exists approved_at timestamptz;

alter table public.profiles
add column if not exists approved_by uuid references auth.users(id) on delete set null;

alter table public.profiles
add column if not exists rejected_at timestamptz;

alter table public.profiles
add column if not exists rejected_by uuid references auth.users(id) on delete set null;

update public.profiles
set
  approval_status = 'approved',
  approved_at = coalesce(approved_at, created_at)
where approval_status is null;

alter table public.profiles
alter column approval_status set default 'pending';

alter table public.profiles
alter column approval_status set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'profiles_approval_status_check'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
    add constraint profiles_approval_status_check
    check (approval_status in ('pending', 'approved', 'rejected'));
  end if;
end $$;

create index if not exists profiles_approval_status_created_idx
on public.profiles (approval_status, created_at desc);

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    email,
    full_name,
    contact_number,
    role,
    is_active,
    approval_status
  )
  values (
    new.id,
    new.email,
    left(trim(coalesce(new.raw_user_meta_data ->> 'full_name', '')), 120),
    left(trim(coalesce(new.raw_user_meta_data ->> 'contact_number', '')), 32),
    'user',
    true,
    'pending'
  )
  on conflict (id) do update
  set
    email = excluded.email,
    full_name = case
      when excluded.full_name <> '' then excluded.full_name
      else public.profiles.full_name
    end,
    contact_number = case
      when excluded.contact_number <> '' then excluded.contact_number
      else public.profiles.contact_number
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
      and approval_status = 'approved'
  );
$$;

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
      and approval_status = 'approved'
  );
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_active_user() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_user() to authenticated;

alter table public.profiles enable row level security;

drop policy if exists "profiles_select_own_or_admin" on public.profiles;
create policy "profiles_select_own_or_admin"
on public.profiles
for select
to authenticated
using (id = (select auth.uid()) or public.is_admin());

-- No self-update policy is added. Role and approval fields remain admin-managed.
drop policy if exists "profiles_admin_update" on public.profiles;
create policy "profiles_admin_update"
on public.profiles
for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

drop policy if exists "profiles_admin_delete" on public.profiles;
create policy "profiles_admin_delete"
on public.profiles
for delete
to authenticated
using (public.is_admin());

-- Approval is enforced at the database boundary for dashboard reads as well as writes.
do $$
declare
  table_name text;
  policy_record record;
begin
  foreach table_name in array array[
    'workflow_runs', 'ranked_candidates', 'top_candidates', 'search_requests',
    'candidate_relationships', 'workflow_summary'
  ] loop
    if to_regclass('public.' || table_name) is null then
      continue;
    end if;

    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and cmd = 'SELECT'
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_active_user() and owner_user_id = (select auth.uid()))',
      table_name || '_select_approved_owner', table_name
    );
  end loop;
end $$;
