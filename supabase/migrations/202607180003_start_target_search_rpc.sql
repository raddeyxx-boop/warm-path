-- Step 5: atomically validate and transition an initialized search to running.

create or replace function public.start_target_search(
  p_workflow_run_id uuid,
  p_search_request_id uuid
)
returns table (
  result_code text,
  owner_user_id uuid,
  workflow_run_id uuid,
  search_request_id uuid,
  workflow_status text,
  target_name text,
  current_company text,
  linkedin_name text,
  location text,
  keywords text,
  company_filter text,
  school_filter text,
  normalized_search_key text,
  cache_hit boolean
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
  workflow_record public.workflow_runs%rowtype;
  search_record public.search_requests%rowtype;
  transition_time timestamptz := now();
begin
  if current_owner is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_owner::text, 0));

  select wr.* into workflow_record
  from public.workflow_runs wr
  where wr.id = p_workflow_run_id
    and wr.owner_user_id = current_owner;

  if not found then
    return query select 'not_found', null::uuid, null::uuid, null::uuid, null::text,
      null::text, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::boolean;
    return;
  end if;

  select sr.* into search_record
  from public.search_requests sr
  where sr.id = p_search_request_id
    and sr.owner_user_id = current_owner
    and sr.workflow_run_id = p_workflow_run_id;

  if not found then
    return query select 'not_found', null::uuid, null::uuid, null::uuid, null::text,
      null::text, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::boolean;
    return;
  end if;

  if nullif(btrim(search_record.target_name), '') is null
    or nullif(btrim(search_record.current_company), '') is null
    or nullif(btrim(search_record.linkedin_name), '') is null
    or nullif(btrim(search_record.location), '') is null
    or nullif(btrim(search_record.normalized_search_key), '') is null
  then
    return query select 'invalid_data', null::uuid, null::uuid, null::uuid, null::text,
      null::text, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::boolean;
    return;
  end if;

  if workflow_record.status = 'running' and search_record.status = 'running' then
    return query select
      'already_started', current_owner, workflow_record.id, search_record.id, 'running',
      search_record.target_name, search_record.current_company, search_record.linkedin_name,
      search_record.location, search_record.keywords, search_record.company_filter,
      search_record.school_filter, search_record.normalized_search_key, search_record.cache_hit;
    return;
  end if;

  if workflow_record.status <> 'queued' or search_record.status <> 'queued' then
    return query select 'invalid_state', null::uuid, null::uuid, null::uuid, null::text,
      null::text, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::boolean;
    return;
  end if;

  if exists (
    select 1 from public.search_requests active_search
    where active_search.owner_user_id = current_owner
      and active_search.status in ('queued', 'running')
      and active_search.id <> search_record.id
  ) then
    return query select 'active_search', null::uuid, null::uuid, null::uuid, null::text,
      null::text, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::boolean;
    return;
  end if;

  update public.workflow_runs wr
  set status = 'running', started_at = transition_time
  where wr.id = workflow_record.id
    and wr.owner_user_id = current_owner
    and wr.status = 'queued';

  if not found then
    return query select 'conflict', null::uuid, null::uuid, null::uuid, null::text,
      null::text, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::boolean;
    return;
  end if;

  update public.search_requests sr
  set status = 'running', started_at = transition_time
  where sr.id = search_record.id
    and sr.owner_user_id = current_owner
    and sr.workflow_run_id = workflow_record.id
    and sr.status = 'queued';

  if not found then
    raise exception using errcode = '40001', message = 'Search status transition conflict.';
  end if;

  return query select
    'started', current_owner, workflow_record.id, search_record.id, 'running',
    search_record.target_name, search_record.current_company, search_record.linkedin_name,
    search_record.location, search_record.keywords, search_record.company_filter,
    search_record.school_filter, search_record.normalized_search_key, search_record.cache_hit;
end;
$$;

revoke all on function public.start_target_search(uuid, uuid) from public;
grant execute on function public.start_target_search(uuid, uuid) to authenticated;
