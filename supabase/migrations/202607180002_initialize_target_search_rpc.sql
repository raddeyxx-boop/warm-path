-- Step 4: atomically initialize a workflow run and its target search request.

create or replace function public.initialize_target_search(
  p_target_name text,
  p_current_company text,
  p_linkedin_name text,
  p_location text,
  p_keywords text,
  p_company_filter text,
  p_school_filter text,
  p_normalized_search_key text
)
returns table (
  result_code text,
  workflow_run_id uuid,
  search_request_id uuid
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
  existing_workflow_run_id uuid;
  new_workflow_run_id uuid;
  new_search_request_id uuid;
  violation_constraint text;
begin
  if current_owner is null then
    raise exception using
      errcode = '28000',
      message = 'Authentication is required to initialize a target search.';
  end if;

  if nullif(btrim(p_target_name), '') is null
    or nullif(btrim(p_current_company), '') is null
    or nullif(btrim(p_linkedin_name), '') is null
    or nullif(btrim(p_location), '') is null
    or nullif(btrim(p_normalized_search_key), '') is null
  then
    raise exception using
      errcode = '22023',
      message = 'Required target-search values are missing.';
  end if;

  -- Serialize initialization attempts for this user. The partial unique index on
  -- search_requests remains the final invariant.
  perform pg_advisory_xact_lock(hashtextextended(current_owner::text, 0));

  select sr.workflow_run_id
  into existing_workflow_run_id
  from public.search_requests sr
  where sr.owner_user_id = current_owner
    and sr.status in ('queued', 'running')
  order by sr.created_at desc
  limit 1;

  if found then
    return query
    select 'active_search'::text, existing_workflow_run_id, null::uuid;
    return;
  end if;

  insert into public.workflow_runs (
    owner_user_id,
    status,
    target_person,
    target_company
  )
  values (
    current_owner,
    'queued',
    btrim(p_target_name),
    btrim(p_current_company)
  )
  returning id into new_workflow_run_id;

  insert into public.search_requests (
    owner_user_id,
    workflow_run_id,
    target_name,
    current_company,
    linkedin_name,
    location,
    keywords,
    company_filter,
    school_filter,
    normalized_search_key,
    status,
    cache_hit
  )
  values (
    current_owner,
    new_workflow_run_id,
    btrim(p_target_name),
    btrim(p_current_company),
    btrim(p_linkedin_name),
    btrim(p_location),
    nullif(btrim(p_keywords), ''),
    nullif(btrim(p_company_filter), ''),
    nullif(btrim(p_school_filter), ''),
    btrim(p_normalized_search_key),
    'queued',
    false
  )
  returning id into new_search_request_id;

  return query
  select 'initialized'::text, new_workflow_run_id, new_search_request_id;
exception
  when unique_violation then
    get stacked diagnostics violation_constraint = constraint_name;
    if violation_constraint = 'search_requests_one_active_per_owner_idx' then
      select sr.workflow_run_id
      into existing_workflow_run_id
      from public.search_requests sr
      where sr.owner_user_id = current_owner
        and sr.status in ('queued', 'running')
      order by sr.created_at desc
      limit 1;

      return query
      select 'active_search'::text, existing_workflow_run_id, null::uuid;
      return;
    end if;
    raise;
end;
$$;

revoke all on function public.initialize_target_search(text, text, text, text, text, text, text, text) from public;
grant execute on function public.initialize_target_search(text, text, text, text, text, text, text, text) to authenticated;
