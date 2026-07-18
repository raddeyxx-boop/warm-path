-- One-time cleanup for empty Warm Path Finder candidate placeholders.
-- Run this in the Supabase SQL editor after reviewing the preview queries.

-- Preview invalid ranked_candidates rows.
select
  id,
  rank,
  name,
  linkedin_url,
  current_company,
  created_at
from public.ranked_candidates
where
  name is null
  or btrim(name) = ''
  or lower(btrim(name)) = 'not available'
  or linkedin_url is null
  or btrim(linkedin_url) = ''
  or lower(btrim(linkedin_url)) = 'not available'
order by created_at desc nulls last;

-- Preview invalid top_candidates rows.
select
  id,
  rank,
  name,
  linkedin_url,
  current_company,
  created_at
from public.top_candidates
where
  name is null
  or btrim(name) = ''
  or lower(btrim(name)) = 'not available'
  or linkedin_url is null
  or btrim(linkedin_url) = ''
  or lower(btrim(linkedin_url)) = 'not available'
  or rank is null
  or rank > 3
order by created_at desc nulls last;

begin;

delete from public.ranked_candidates
where
  name is null
  or btrim(name) = ''
  or lower(btrim(name)) = 'not available'
  or linkedin_url is null
  or btrim(linkedin_url) = ''
  or lower(btrim(linkedin_url)) = 'not available';

delete from public.top_candidates
where
  name is null
  or btrim(name) = ''
  or lower(btrim(name)) = 'not available'
  or linkedin_url is null
  or btrim(linkedin_url) = ''
  or lower(btrim(linkedin_url)) = 'not available'
  or rank is null
  or rank > 3;

commit;

-- Verification after cleanup.
select count(*) as valid_ranked_candidates
from public.ranked_candidates
where
  id is not null
  and name is not null
  and btrim(name) <> ''
  and lower(btrim(name)) <> 'not available'
  and linkedin_url is not null
  and btrim(linkedin_url) <> ''
  and lower(btrim(linkedin_url)) <> 'not available';

select count(*) as valid_top_candidates
from public.top_candidates
where
  id is not null
  and name is not null
  and btrim(name) <> ''
  and lower(btrim(name)) <> 'not available'
  and linkedin_url is not null
  and btrim(linkedin_url) <> ''
  and lower(btrim(linkedin_url)) <> 'not available'
  and rank is not null
  and rank <= 3;
