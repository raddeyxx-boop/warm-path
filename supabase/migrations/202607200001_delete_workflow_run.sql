-- Permanently delete one authorized workflow run and every run-linked record atomically.

create or replace function public.delete_workflow_run(p_workflow_run_id uuid)
returns table (
  result_code text,
  workflow_run_id uuid,
  ranked_candidates_deleted bigint,
  top_candidates_deleted bigint,
  search_requests_deleted bigint,
  search_cache_deleted bigint
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
  workflow_owner uuid;
  workflow_found boolean := false;
  ranked_count bigint := 0;
  legacy_ranked_count bigint := 0;
  top_count bigint := 0;
  request_count bigint := 0;
  cache_count bigint := 0;
begin
  if current_owner is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  if not public.is_active_user() then
    return query select 'not_found'::text, null::uuid, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_workflow_run_id::text, 0));

  if p_workflow_run_id is null then
    return query select 'not_found'::text, null::uuid, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  select wr.owner_user_id into workflow_owner
  from public.workflow_runs wr
  where wr.id = p_workflow_run_id
  for update;
  workflow_found := found;

  if not workflow_found or (workflow_owner is distinct from current_owner and not public.is_admin()) then
    return query select 'not_found'::text, null::uuid, 0::bigint, 0::bigint, 0::bigint, 0::bigint;
    return;
  end if;

  delete from public.search_cache sc
  where sc.source_workflow_run_id = p_workflow_run_id;
  get diagnostics cache_count = row_count;

  delete from public.search_requests sr
  where sr.workflow_run_id = p_workflow_run_id;
  get diagnostics request_count = row_count;

  delete from public.top_candidates tc
  where tc.workflow_run_id = p_workflow_run_id;
  get diagnostics top_count = row_count;

  delete from public.ranked_candidates rc
  where rc.workflow_run_id = p_workflow_run_id;
  get diagnostics ranked_count = row_count;

  -- Older dashboard deployments may also link ranked candidates through run_id.
  -- Only reference it when PostgreSQL confirms the column actually exists.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ranked_candidates'
      and column_name = 'run_id'
  ) then
    execute 'delete from public.ranked_candidates rc where rc.run_id::text = $1'
    using p_workflow_run_id::text;
    get diagnostics legacy_ranked_count = row_count;
    ranked_count := ranked_count + legacy_ranked_count;
  end if;

  delete from public.workflow_runs wr
  where wr.id = p_workflow_run_id;

  if not found then
    raise exception 'Workflow run disappeared during deletion.';
  end if;

  return query select
    'deleted'::text,
    p_workflow_run_id,
    ranked_count,
    top_count,
    request_count,
    cache_count;
end;
$$;

revoke all on function public.delete_workflow_run(uuid) from public;
grant execute on function public.delete_workflow_run(uuid) to authenticated;
