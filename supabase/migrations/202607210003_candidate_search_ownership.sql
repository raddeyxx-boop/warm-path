alter table public.ranked_candidates
  add column if not exists search_request_id uuid references public.search_requests(id) on delete cascade;

alter table public.top_candidates
  add column if not exists search_request_id uuid references public.search_requests(id) on delete cascade;

create index if not exists ranked_candidates_owner_workflow_search_idx
  on public.ranked_candidates (owner_user_id, workflow_run_id, search_request_id);

create index if not exists top_candidates_owner_workflow_search_idx
  on public.top_candidates (owner_user_id, workflow_run_id, search_request_id);
