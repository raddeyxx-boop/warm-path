-- Step 6: per-user cache lookup, validation, atomic candidate copy, and cache refresh RPC.

create or replace function public.is_valid_candidate_snapshot(p_snapshot jsonb)
returns boolean
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  snapshot_item jsonb;
  candidate_data jsonb;
begin
  if p_snapshot is null or jsonb_typeof(p_snapshot) <> 'array' then
    return false;
  end if;

  for snapshot_item in select value from jsonb_array_elements(p_snapshot)
  loop
    if jsonb_typeof(snapshot_item) <> 'object'
      or snapshot_item ->> 'table' not in ('ranked_candidates', 'top_candidates')
      or jsonb_typeof(snapshot_item -> 'candidate') <> 'object'
    then
      return false;
    end if;

    candidate_data := snapshot_item -> 'candidate'; 
    if nullif(btrim(candidate_data ->> 'name'), '') is null
      or nullif(btrim(candidate_data ->> 'linkedin_url'), '') is null
      or jsonb_typeof(candidate_data -> 'rank') <> 'number'
    then
      return false;
    end if;

    -- Validate casts used by the copy operation without trusting stored JSON types.
    perform (candidate_data ->> 'rank')::integer;
    if candidate_data ? 'final_score' and jsonb_typeof(candidate_data -> 'final_score') <> 'null' then
      perform (candidate_data ->> 'final_score')::numeric;
    end if;
    if candidate_data ? 'warm_score' and jsonb_typeof(candidate_data -> 'warm_score') <> 'null' then
      perform (candidate_data ->> 'warm_score')::numeric;
    end if;
  end loop;

  return true;
exception when others then
  return false;
end;
$$;

revoke all on function public.is_valid_candidate_snapshot(jsonb) from public;
grant execute on function public.is_valid_candidate_snapshot(jsonb) to authenticated;

create or replace function public.prepare_target_search_with_cache(
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
  cache_id uuid,
  source_workflow_run_id uuid,
  copied_candidate_count integer,
  copied_top_candidate_count integer
)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
  workflow_record public.workflow_runs%rowtype;
  search_record public.search_requests%rowtype;
  cache_record public.search_cache%rowtype;
  snapshot_item jsonb;
  candidate_data jsonb;
  transition_time timestamptz := now();
  ranked_count integer := 0;
  top_count integer := 0;
begin
  if current_owner is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_owner::text, 0));

  select wr.* into workflow_record
  from public.workflow_runs wr
  where wr.id = p_workflow_run_id and wr.owner_user_id = current_owner
  for update;

  select sr.* into search_record
  from public.search_requests sr
  where sr.id = p_search_request_id
    and sr.owner_user_id = current_owner
    and sr.workflow_run_id = p_workflow_run_id
  for update;

  if workflow_record.id is null or search_record.id is null then
    return query select 'not_found', null::uuid, null::uuid, null::uuid, null::text,
      null::text, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::uuid, null::uuid, 0, 0;
    return;
  end if;

  if nullif(btrim(search_record.target_name), '') is null
    or nullif(btrim(search_record.current_company), '') is null
    or nullif(btrim(search_record.linkedin_name), '') is null
    or nullif(btrim(search_record.location), '') is null
    or nullif(btrim(search_record.normalized_search_key), '') is null
  then
    return query select 'invalid_state', null::uuid, null::uuid, null::uuid, null::text,
      null::text, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::uuid, null::uuid, 0, 0;
    return;
  end if;

  if workflow_record.status = 'completed'
    and search_record.status = 'completed'
    and search_record.cache_hit = true
  then
    select count(*)::integer into ranked_count
    from public.ranked_candidates rc
    where rc.owner_user_id = current_owner and rc.workflow_run_id = workflow_record.id;

    select count(*)::integer into top_count
    from public.top_candidates tc
    where tc.owner_user_id = current_owner and tc.workflow_run_id = workflow_record.id;

    return query select 'cache_hit', current_owner, workflow_record.id, search_record.id, 'completed',
      search_record.target_name, search_record.current_company, search_record.linkedin_name,
      search_record.location, search_record.keywords, search_record.company_filter,
      search_record.school_filter, search_record.normalized_search_key, null::uuid, null::uuid,
      ranked_count, top_count;
    return;
  end if;

  if workflow_record.status = 'queued' and search_record.status = 'queued' then
    update public.workflow_runs
    set status = 'running', started_at = transition_time
    where id = workflow_record.id and owner_user_id = current_owner and status = 'queued';

    if not found then
      raise exception using errcode = '40001', message = 'Workflow status transition conflict.';
    end if;

    update public.search_requests
    set status = 'running', started_at = transition_time, cache_hit = false
    where id = search_record.id and owner_user_id = current_owner
      and workflow_run_id = workflow_record.id and status = 'queued';

    if not found then
      raise exception using errcode = '40001', message = 'Search status transition conflict.';
    end if;
  elsif workflow_record.status <> 'running' or search_record.status <> 'running' then
    return query select 'invalid_state', null::uuid, null::uuid, null::uuid, null::text,
      null::text, null::text, null::text, null::text, null::text, null::text,
      null::text, null::text, null::uuid, null::uuid, 0, 0;
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
      null::text, null::text, null::uuid, null::uuid, 0, 0;
    return;
  end if;

  select sc.* into cache_record
  from public.search_cache sc
  join public.workflow_runs source_run
    on source_run.id = sc.source_workflow_run_id
   and source_run.owner_user_id = current_owner
   and source_run.status = 'completed'
  where sc.owner_user_id = current_owner
    and sc.normalized_search_key = search_record.normalized_search_key
    and sc.expires_at > now()
  order by sc.updated_at desc
  limit 1
  for update of sc;

  if cache_record.id is null then
    return query select 'cache_miss', current_owner, workflow_record.id, search_record.id, 'running',
      search_record.target_name, search_record.current_company, search_record.linkedin_name,
      search_record.location, search_record.keywords, search_record.company_filter,
      search_record.school_filter, search_record.normalized_search_key, null::uuid, null::uuid, 0, 0;
    return;
  end if;

  if not public.is_valid_candidate_snapshot(cache_record.candidate_snapshot) then
    return query select 'cache_invalid', current_owner, workflow_record.id, search_record.id, 'running',
      search_record.target_name, search_record.current_company, search_record.linkedin_name,
      search_record.location, search_record.keywords, search_record.company_filter,
      search_record.school_filter, search_record.normalized_search_key, cache_record.id,
      cache_record.source_workflow_run_id, 0, 0;
    return;
  end if;

  begin
    for snapshot_item in select value from jsonb_array_elements(cache_record.candidate_snapshot)
    loop
    candidate_data := snapshot_item -> 'candidate';

    if snapshot_item ->> 'table' = 'ranked_candidates' then
      insert into public.ranked_candidates (
        owner_user_id, workflow_run_id, rank, final_score, final_grade, name, linkedin_url,
        current_company, position, location, role, seniority, decision_power, warm_score,
        recommendation, explanation, personalized_introduction, profile, analysis, ai_analysis,
        relationship_evidence, top_candidate_reason
      ) values (
        current_owner, workflow_record.id, (candidate_data ->> 'rank')::integer,
        nullif(candidate_data ->> 'final_score', '')::numeric, candidate_data ->> 'final_grade',
        candidate_data ->> 'name', candidate_data ->> 'linkedin_url', candidate_data ->> 'current_company',
        candidate_data ->> 'position', candidate_data ->> 'location', candidate_data ->> 'role',
        candidate_data ->> 'seniority', candidate_data ->> 'decision_power',
        nullif(candidate_data ->> 'warm_score', '')::numeric, candidate_data ->> 'recommendation',
        candidate_data ->> 'explanation', candidate_data ->> 'personalized_introduction',
        candidate_data -> 'profile', candidate_data -> 'analysis', candidate_data -> 'ai_analysis',
        coalesce(candidate_data -> 'relationship_evidence', '{}'::jsonb),
        coalesce(candidate_data -> 'top_candidate_reason', '{}'::jsonb)
      );
      ranked_count := ranked_count + 1;
    else
      insert into public.top_candidates (
        owner_user_id, workflow_run_id, rank, final_score, final_grade, name, linkedin_url,
        current_company, position, location, role, seniority, decision_power, warm_score,
        recommendation, explanation, personalized_introduction, profile, analysis, ai_analysis,
        relationship_evidence, top_candidate_reason
      ) values (
        current_owner, workflow_record.id, (candidate_data ->> 'rank')::integer,
        nullif(candidate_data ->> 'final_score', '')::numeric, candidate_data ->> 'final_grade',
        candidate_data ->> 'name', candidate_data ->> 'linkedin_url', candidate_data ->> 'current_company',
        candidate_data ->> 'position', candidate_data ->> 'location', candidate_data ->> 'role',
        candidate_data ->> 'seniority', candidate_data ->> 'decision_power',
        nullif(candidate_data ->> 'warm_score', '')::numeric, candidate_data ->> 'recommendation',
        candidate_data ->> 'explanation', candidate_data ->> 'personalized_introduction',
        candidate_data -> 'profile', candidate_data -> 'analysis', candidate_data -> 'ai_analysis',
        coalesce(candidate_data -> 'relationship_evidence', '{}'::jsonb),
        coalesce(candidate_data -> 'top_candidate_reason', '{}'::jsonb)
      );
      top_count := top_count + 1;
    end if;
    end loop;
  exception when others then
    raise warning 'Invalid cached candidate for cache %, table %, rank %: [%] %',
      cache_record.id, snapshot_item ->> 'table', candidate_data ->> 'rank', sqlstate, sqlerrm;
    return query select 'cache_invalid', current_owner, workflow_record.id, search_record.id, 'running',
      search_record.target_name, search_record.current_company, search_record.linkedin_name,
      search_record.location, search_record.keywords, search_record.company_filter,
      search_record.school_filter, search_record.normalized_search_key, cache_record.id,
      cache_record.source_workflow_run_id, 0, 0;
    return;
  end;

  update public.search_requests
  set status = 'completed', cache_hit = true, completed_at = transition_time
  where id = search_record.id and owner_user_id = current_owner and status = 'running';

  if not found then
    raise exception using errcode = '40001', message = 'Search completion conflict.';
  end if;

  update public.workflow_runs
  set status = 'completed',
      completed_at = transition_time,
      total_candidates = ranked_count,
      top_candidates_count = top_count,
      average_final_score = (
        select avg(rc.final_score)
        from public.ranked_candidates rc
        where rc.owner_user_id = current_owner and rc.workflow_run_id = workflow_record.id
      )
  where id = workflow_record.id and owner_user_id = current_owner and status = 'running';

  if not found then
    raise exception using errcode = '40001', message = 'Workflow completion conflict.';
  end if;

  return query select 'cache_hit', current_owner, workflow_record.id, search_record.id, 'completed',
    search_record.target_name, search_record.current_company, search_record.linkedin_name,
    search_record.location, search_record.keywords, search_record.company_filter,
    search_record.school_filter, search_record.normalized_search_key, cache_record.id,
    cache_record.source_workflow_run_id, ranked_count, top_count;
end;
$$;

revoke all on function public.prepare_target_search_with_cache(uuid, uuid) from public;
grant execute on function public.prepare_target_search_with_cache(uuid, uuid) to authenticated;

create or replace function public.upsert_completed_search_cache(
  p_normalized_search_key text,
  p_source_workflow_run_id uuid,
  p_candidate_snapshot jsonb
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
  cache_row_id uuid;
begin
  if current_owner is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  if nullif(btrim(p_normalized_search_key), '') is null
    or not public.is_valid_candidate_snapshot(p_candidate_snapshot)
  then
    raise exception using errcode = '22023', message = 'The cache snapshot is invalid.';
  end if;

  if not exists (
    select 1 from public.workflow_runs wr
    where wr.id = p_source_workflow_run_id
      and wr.owner_user_id = current_owner
      and wr.status = 'completed'
  ) then
    raise exception using errcode = '42501', message = 'The source workflow is unavailable.';
  end if;

  insert into public.search_cache (
    owner_user_id, normalized_search_key, source_workflow_run_id,
    candidate_snapshot, created_at, updated_at, expires_at
  ) values (
    current_owner, btrim(p_normalized_search_key), p_source_workflow_run_id,
    p_candidate_snapshot, now(), now(), now() + interval '30 days'
  )
  on conflict on constraint search_cache_owner_key_unique do update
  set source_workflow_run_id = excluded.source_workflow_run_id,
      candidate_snapshot = excluded.candidate_snapshot,
      updated_at = now(),
      expires_at = now() + interval '30 days'
  returning id into cache_row_id;

  return cache_row_id;
end;
$$;

revoke all on function public.upsert_completed_search_cache(text, uuid, jsonb) from public;
grant execute on function public.upsert_completed_search_cache(text, uuid, jsonb) to authenticated;
