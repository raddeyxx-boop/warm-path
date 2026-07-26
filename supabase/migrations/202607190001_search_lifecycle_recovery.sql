-- Transactional lifecycle recovery for backend restarts and worker failures.

alter table public.workflow_runs add column if not exists finished_at timestamptz;
alter table public.search_requests add column if not exists finished_at timestamptz;

create or replace function public.set_search_lifecycle_finished_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if lower(coalesce(new.status, '')) in ('completed', 'failed', 'cancelled', 'stopped')
    and new.finished_at is null then
    new.finished_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_runs_set_finished_at on public.workflow_runs;
create trigger workflow_runs_set_finished_at
before insert or update of status on public.workflow_runs
for each row execute function public.set_search_lifecycle_finished_at();

drop trigger if exists search_requests_set_finished_at on public.search_requests;
create trigger search_requests_set_finished_at
before insert or update of status on public.search_requests
for each row execute function public.set_search_lifecycle_finished_at();

create or replace function public.recover_abandoned_searches_on_backend_start()
returns table (search_id uuid)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  recovery_time timestamptz := now();
  recovery_message text := 'Search interrupted because the backend was restarted.';
begin
  if auth.role() <> 'service_role' then
    raise exception using errcode = '42501', message = 'Service role is required for backend recovery.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('warm-path-backend-recovery', 0));

  return query
  with abandoned as (
    select sr.id as search_id, sr.workflow_run_id
    from public.search_requests sr
    left join public.workflow_runs wr on wr.id = sr.workflow_run_id
    where lower(coalesce(sr.status, '')) in ('queued', 'running', 'starting', 'processing', 'in_progress')
       or lower(coalesce(wr.status, '')) in ('queued', 'running', 'starting', 'processing', 'in_progress')
       or lower(coalesce(wr.current_step, '')) in ('starting', 'processing', 'in_progress')
  ), failed_searches as (
    update public.search_requests sr
    set status = 'failed', failed_at = recovery_time, finished_at = recovery_time,
        error_message = recovery_message
    from abandoned a
    where sr.id = a.search_id
    returning sr.id, sr.workflow_run_id
  ), failed_workflows as (
    update public.workflow_runs wr
    set status = 'failed', failed_at = recovery_time, finished_at = recovery_time,
        current_step = 'failed', current_message = recovery_message,
        estimated_remaining_seconds = null
    where lower(coalesce(wr.status, '')) in ('queued', 'running', 'starting', 'processing', 'in_progress')
       or lower(coalesce(wr.current_step, '')) in ('starting', 'processing', 'in_progress')
       or wr.id in (select fs.workflow_run_id from failed_searches fs)
    returning wr.id
  )
  select fs.id from failed_searches fs;
end;
$$;

revoke all on function public.recover_abandoned_searches_on_backend_start() from public;
grant execute on function public.recover_abandoned_searches_on_backend_start() to service_role;

create or replace function public.fail_target_search_pair(
  p_workflow_run_id uuid,
  p_search_request_id uuid,
  p_error_message text
)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
  failure_time timestamptz := now();
  safe_message text := left(coalesce(nullif(btrim(p_error_message), ''), 'Search execution failed.'), 500);
begin
  if current_owner is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_owner::text, 0));

  update public.search_requests
  set status = 'failed', failed_at = failure_time, finished_at = failure_time,
      error_message = safe_message
  where id = p_search_request_id and workflow_run_id = p_workflow_run_id
    and owner_user_id = current_owner
    and status in ('queued', 'running', 'starting', 'processing', 'in_progress');

  update public.workflow_runs
  set status = 'failed', failed_at = failure_time, finished_at = failure_time,
      current_step = 'failed', current_message = safe_message,
      estimated_remaining_seconds = null
  where id = p_workflow_run_id and owner_user_id = current_owner
    and status in ('queued', 'running', 'starting', 'processing', 'in_progress');

  return true;
end;
$$;

revoke all on function public.fail_target_search_pair(uuid, uuid, text) from public;
grant execute on function public.fail_target_search_pair(uuid, uuid, text) to authenticated;
