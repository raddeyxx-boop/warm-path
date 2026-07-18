alter table public.workflow_runs add column if not exists current_step text;
alter table public.workflow_runs add column if not exists current_message text;
alter table public.workflow_runs add column if not exists progress_percent integer not null default 0;
alter table public.workflow_runs add column if not exists estimated_remaining_seconds integer;
alter table public.workflow_runs add column if not exists profiles_found integer;
alter table public.workflow_runs add column if not exists profiles_processed integer;
alter table public.workflow_runs add column if not exists mutual_connections integer;
alter table public.workflow_runs add column if not exists candidates_ranked integer;
alter table public.workflow_runs add column if not exists ai_analyses_completed integer;
alter table public.workflow_runs add column if not exists cache_hit boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'workflow_runs_progress_percent_check' and conrelid = 'public.workflow_runs'::regclass) then
    alter table public.workflow_runs add constraint workflow_runs_progress_percent_check check (progress_percent between 0 and 100);
  end if;
end $$;
create index if not exists workflow_runs_owner_active_progress_idx on public.workflow_runs (owner_user_id, status, updated_at desc) where status in ('queued', 'running');
alter table public.workflow_runs replica identity full;
