alter table public.ranked_candidates
  add column if not exists relationship_rank_score numeric,
  add column if not exists relationship_evidence_score numeric,
  add column if not exists relationship_label text,
  add column if not exists verified_evidence_count integer;

alter table public.top_candidates
  add column if not exists candidate_id uuid references public.ranked_candidates(id) on delete cascade,
  add column if not exists relationship_rank_score numeric,
  add column if not exists relationship_evidence_score numeric,
  add column if not exists relationship_label text,
  add column if not exists verified_evidence_count integer;

create unique index if not exists top_candidates_owner_workflow_rank_uidx
  on public.top_candidates (owner_user_id, workflow_run_id, rank);

create unique index if not exists top_candidates_owner_workflow_candidate_uidx
  on public.top_candidates (owner_user_id, workflow_run_id, candidate_id)
  where candidate_id is not null;
