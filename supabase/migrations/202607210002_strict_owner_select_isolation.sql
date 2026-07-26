-- Enforce per-user reads even for authenticated administrators on user dashboard data.
do $$
declare
  table_name text;
  policy_record record;
begin
  foreach table_name in array array[
    'workflow_runs', 'ranked_candidates', 'top_candidates', 'search_requests',
    'candidate_relationships', 'workflow_summary'
  ] loop
    if to_regclass('public.' || table_name) is null then
      continue;
    end if;

    execute format('alter table public.%I enable row level security', table_name);

    for policy_record in
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = table_name
        and cmd = 'SELECT'
    loop
      execute format('drop policy if exists %I on public.%I', policy_record.policyname, table_name);
    end loop;

    execute format(
      'create policy %I on public.%I for select to authenticated using (owner_user_id = (select auth.uid()))',
      table_name || '_select_own', table_name
    );
  end loop;
end $$;
