-- Optional one-time backfill for the current/latest workflow run.
-- This updates existing candidate rows in place; it does not create duplicate candidates.
-- Review the preview queries before running the update.

with latest_run as (
  select id
  from public.workflow_runs
  order by created_at desc nulls last
  limit 1
)
select 'latest workflow run' as preview, id
from latest_run;

with latest_run as (
  select id
  from public.workflow_runs
  order by created_at desc nulls last
  limit 1
)
select rank, name, linkedin_url, workflow_run_id
from public.ranked_candidates
where workflow_run_id is null
  and name is not null
  and btrim(name) <> ''
  and linkedin_url is not null
  and btrim(linkedin_url) <> ''
order by rank asc nulls last;

with latest_run as (
  select id
  from public.workflow_runs
  order by created_at desc nulls last
  limit 1
)
select rank, name, linkedin_url, workflow_run_id
from public.top_candidates
where workflow_run_id is null
  and rank is not null
  and rank <= 3
  and name is not null
  and btrim(name) <> ''
  and linkedin_url is not null
  and btrim(linkedin_url) <> ''
order by rank asc;

begin;

with latest_run as (
  select id
  from public.workflow_runs
  order by created_at desc nulls last
  limit 1
)
update public.ranked_candidates
set workflow_run_id = latest_run.id
from latest_run
where public.ranked_candidates.workflow_run_id is null
  and public.ranked_candidates.name is not null
  and btrim(public.ranked_candidates.name) <> ''
  and public.ranked_candidates.linkedin_url is not null
  and btrim(public.ranked_candidates.linkedin_url) <> '';

with latest_run as (
  select id
  from public.workflow_runs
  order by created_at desc nulls last
  limit 1
)
update public.top_candidates
set workflow_run_id = latest_run.id
from latest_run
where public.top_candidates.workflow_run_id is null
  and public.top_candidates.rank is not null
  and public.top_candidates.rank <= 3
  and public.top_candidates.name is not null
  and btrim(public.top_candidates.name) <> ''
  and public.top_candidates.linkedin_url is not null
  and btrim(public.top_candidates.linkedin_url) <> '';

commit;
