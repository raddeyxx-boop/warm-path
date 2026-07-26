alter table public.workflow_runs
  add column if not exists n8n_dispatch_status text not null default 'pending'
    check (n8n_dispatch_status in ('pending', 'dispatching', 'succeeded', 'failed')),
  add column if not exists n8n_dispatch_attempts integer not null default 0,
  add column if not exists n8n_dispatch_started_at timestamptz,
  add column if not exists n8n_dispatch_completed_at timestamptz,
  add column if not exists n8n_dispatch_error text,
  add column if not exists n8n_dispatched_at timestamptz,
  add column if not exists n8n_response_status integer,
  add column if not exists n8n_execution_id text,
  add column if not exists n8n_last_error text;

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'workflow_runs_n8n_dispatch_attempts_check'
      and conrelid = 'public.workflow_runs'::regclass
  ) then
    alter table public.workflow_runs
      add constraint workflow_runs_n8n_dispatch_attempts_check
      check (n8n_dispatch_attempts >= 0);
  end if;
end $$;
