-- User-requested workflow cancellation with race-safe paired status updates.

alter table public.workflow_runs drop constraint if exists workflow_runs_find_target_status_check;
alter table public.workflow_runs add constraint workflow_runs_find_target_status_check
check (status in ('queued', 'running', 'starting', 'processing', 'in_progress', 'completed', 'failed', 'stopped', 'cancelled')) not valid;

do $$
declare
  constraint_record record;
begin
  for constraint_record in
    select conname
    from pg_constraint
    where conrelid = 'public.search_requests'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
      and pg_get_constraintdef(oid) ilike '%queued%'
  loop
    execute format('alter table public.search_requests drop constraint %I', constraint_record.conname);
  end loop;
end $$;

alter table public.search_requests add constraint search_requests_status_check
check (status in ('queued', 'running', 'starting', 'processing', 'in_progress', 'completed', 'failed', 'stopped', 'cancelled')) not valid;

create or replace function public.stop_workflow_run(p_workflow_run_id uuid)
returns table (result_code text, workflow_run_id uuid, search_request_id uuid)
language plpgsql
set search_path = public, pg_temp
as $$
declare
  current_owner uuid := auth.uid();
  workflow_record public.workflow_runs%rowtype;
  search_id uuid;
  stopped_at timestamptz := now();
  stop_message text := 'Workflow stopped by user.';
begin
  if current_owner is null then
    raise exception using errcode = '28000', message = 'Authentication is required.';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(current_owner::text, 0));

  select wr.* into workflow_record
  from public.workflow_runs wr
  where wr.id = p_workflow_run_id and wr.owner_user_id = current_owner
  for update;

  if workflow_record.id is null then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  if lower(coalesce(workflow_record.status, '')) in ('completed', 'failed', 'stopped', 'cancelled') then
    return query select 'terminal'::text, workflow_record.id, null::uuid;
    return;
  end if;

  if lower(coalesce(workflow_record.status, '')) not in ('queued', 'running', 'starting', 'processing', 'in_progress')
    and lower(coalesce(workflow_record.current_step, '')) not in ('starting', 'processing', 'in_progress') then
    return query select 'terminal'::text, workflow_record.id, null::uuid;
    return;
  end if;

  select sr.id into search_id
  from public.search_requests sr
  where sr.workflow_run_id = workflow_record.id and sr.owner_user_id = current_owner
    and lower(sr.status) in ('queued', 'running', 'starting', 'processing', 'in_progress')
  order by sr.created_at desc
  limit 1
  for update;

  if search_id is not null then
    update public.search_requests
    set status = 'stopped', failed_at = null, finished_at = stopped_at,
        error_message = stop_message
    where id = search_id and owner_user_id = current_owner
      and lower(status) in ('queued', 'running', 'starting', 'processing', 'in_progress');
  end if;

  update public.workflow_runs
  set status = 'stopped', failed_at = null, finished_at = stopped_at,
      current_step = 'stopped', current_message = stop_message,
      estimated_remaining_seconds = null
  where id = workflow_record.id and owner_user_id = current_owner
    and (
      lower(status) in ('queued', 'running', 'starting', 'processing', 'in_progress')
      or lower(coalesce(current_step, '')) in ('starting', 'processing', 'in_progress')
    );

  if not found then
    return query select 'terminal'::text, workflow_record.id, search_id;
    return;
  end if;

  return query select 'stopped'::text, workflow_record.id, search_id;
end;
$$;

revoke all on function public.stop_workflow_run(uuid) from public;
grant execute on function public.stop_workflow_run(uuid) to authenticated;
