-- Repair cache round-trips and recover abandoned target-search pairs.

alter table public.ranked_candidates add column if not exists relationship_evidence jsonb;
alter table public.ranked_candidates add column if not exists top_candidate_reason jsonb;
alter table public.top_candidates add column if not exists relationship_evidence jsonb;
alter table public.top_candidates add column if not exists top_candidate_reason jsonb;

create or replace function public.recover_abandoned_target_searches(
  p_queued_timeout interval default interval '5 minutes',
  p_running_timeout interval default interval '2 hours'
)
returns integer
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
  recovered_count integer := 0;
  recovered_at timestamptz := now();
begin
  if current_owner is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;
  if p_queued_timeout < interval '1 minute' or p_running_timeout < interval '5 minutes' then
    raise exception using errcode = '22023', message = 'Recovery timeouts are too short.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_owner::text, 0));

  with stale as (
    select sr.id, sr.workflow_run_id
    from public.search_requests sr
    join public.workflow_runs wr on wr.id = sr.workflow_run_id and wr.owner_user_id = current_owner
    where sr.owner_user_id = current_owner
      and sr.status in ('queued', 'running')
      and wr.status in ('queued', 'running')
      and (
        (sr.status = 'queued' and wr.status = 'queued'
          and greatest(sr.updated_at, wr.updated_at) < recovered_at - p_queued_timeout)
        or
        ((sr.status = 'running' or wr.status = 'running')
          and greatest(coalesce(sr.started_at, sr.updated_at), coalesce(wr.started_at, wr.updated_at))
              < recovered_at - p_running_timeout)
      )
    for update of sr, wr
  ), failed_searches as (
    update public.search_requests sr
    set status = 'failed', failed_at = recovered_at,
        error_message = 'Search execution was abandoned before completion.'
    from stale s
    where sr.id = s.id and sr.owner_user_id = current_owner
    returning sr.workflow_run_id
  ), failed_workflows as (
    update public.workflow_runs wr
    set status = 'failed', failed_at = recovered_at, current_step = 'failed',
        current_message = 'Search execution was abandoned before completion.',
        estimated_remaining_seconds = null
    from failed_searches f
    where wr.id = f.workflow_run_id and wr.owner_user_id = current_owner
    returning wr.id
  )
  select count(*)::integer into recovered_count from failed_workflows;

  return recovered_count;
end;
$$;

revoke all on function public.recover_abandoned_target_searches(interval, interval) from public;
grant execute on function public.recover_abandoned_target_searches(interval, interval) to authenticated;

-- Patch the already-installed RPC body without duplicating its large return signature.
-- The replacement is guarded so a schema drift fails migration loudly instead of silently.
do $migration$
declare
  definition text;
  patched text;
begin
  select pg_get_functiondef('public.prepare_target_search_with_cache(uuid,uuid)'::regprocedure)
  into definition;
  patched := replace(
    definition,
    'recommendation, explanation, personalized_introduction, profile, analysis, ai_analysis',
    'recommendation, explanation, personalized_introduction, profile, analysis, ai_analysis, relationship_evidence, top_candidate_reason'
  );
  patched := replace(
    patched,
    '  for snapshot_item in select value from jsonb_array_elements(cache_record.candidate_snapshot)' || chr(10) || '  loop',
    '  begin' || chr(10) || '    for snapshot_item in select value from jsonb_array_elements(cache_record.candidate_snapshot)' || chr(10) || '    loop'
  );
  patched := replace(
    patched,
    '  end loop;' || chr(10) || chr(10) || '  update public.search_requests',
    '    end loop;' || chr(10) || '  exception when others then' || chr(10) ||
    '    raise warning ''Invalid cached candidate for cache %, table %, rank %: [%] %'', cache_record.id, snapshot_item ->> ''table'', candidate_data ->> ''rank'', sqlstate, sqlerrm;' || chr(10) ||
    '    return query select ''cache_invalid'', current_owner, workflow_record.id, search_record.id, ''running'', search_record.target_name, search_record.current_company, search_record.linkedin_name, search_record.location, search_record.keywords, search_record.company_filter, search_record.school_filter, search_record.normalized_search_key, cache_record.id, cache_record.source_workflow_run_id, 0, 0;' || chr(10) ||
    '    return;' || chr(10) || '  end;' || chr(10) || chr(10) || '  update public.search_requests'
  );
  patched := replace(
    patched,
    'candidate_data -> ''profile'', candidate_data -> ''analysis'', candidate_data -> ''ai_analysis''',
    'candidate_data -> ''profile'', candidate_data -> ''analysis'', candidate_data -> ''ai_analysis'', coalesce(candidate_data -> ''relationship_evidence'', ''{}''::jsonb), coalesce(candidate_data -> ''top_candidate_reason'', ''{}''::jsonb)'
  );

  patched := replace(
    patched,
    'where id = workflow_record.id and owner_user_id = current_owner and status = ''queued''',
    'where id = workflow_record.id and workflow_runs.owner_user_id = current_owner and status = ''queued'''
  );

  patched := replace(
    patched,
    'where id = search_record.id and owner_user_id = current_owner',
    'where id = search_record.id and search_requests.owner_user_id = current_owner'
  );

  patched := replace(
    patched,
    'where id = search_record.id and owner_user_id = current_owner and status = ''running''',
    'where id = search_record.id and search_requests.owner_user_id = current_owner and status = ''running'''
  );

  patched := replace(
    patched,
    'where id = workflow_record.id and owner_user_id = current_owner and status = ''running''',
    'where id = workflow_record.id and workflow_runs.owner_user_id = current_owner and status = ''running'''
  );



  patched := replace(
    patched,
    'where workflow_run_id = workflow_record.id',
    'where search_requests.workflow_run_id = workflow_record.id'
  );

  patched := replace(
    patched,
    'and workflow_run_id = workflow_record.id',
    'and search_requests.workflow_run_id = workflow_record.id'
  );

  patched := replace(
    patched,
    'where workflow_run_id = search_record.workflow_run_id',
    'where search_requests.workflow_run_id = search_record.workflow_run_id'
  );

  patched := replace(
    patched,
    'and workflow_run_id = search_record.workflow_run_id',
    'and search_requests.workflow_run_id = search_record.workflow_run_id'
  );

  if patched = definition
    or length(patched) - length(replace(patched, 'top_candidate_reason', '')) < 40
  then
    raise exception 'prepare_target_search_with_cache cache-copy patch did not match both destination inserts';
  end if;
  execute patched;
end;
$migration$;
