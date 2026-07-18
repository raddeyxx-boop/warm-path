-- Workflow Run -> Candidate linking support.
-- Run in the Supabase SQL editor before publishing the linked n8n workflow.

alter table public.ranked_candidates
add column if not exists workflow_run_id uuid references public.workflow_runs(id) on delete set null;

alter table public.top_candidates
add column if not exists workflow_run_id uuid references public.workflow_runs(id) on delete set null;

create index if not exists ranked_candidates_workflow_run_id_idx
on public.ranked_candidates (workflow_run_id);

create index if not exists top_candidates_workflow_run_id_rank_idx
on public.top_candidates (workflow_run_id, rank);

-- Verification for a specific run:
-- select id, rank, name, workflow_run_id
-- from public.top_candidates
-- where workflow_run_id = '<workflow_run_id>'
-- order by rank asc
-- limit 3;
