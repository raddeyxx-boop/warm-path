# Target Search Integration Verification

## Canonical request contract

The single shared contract is `types/target-search-request.ts`. The repository has no root
`src/` directory; this location is intentionally importable by both `dashboard/` and the
Node/Playwright services. Do not create a second contract under `src/types/`.

## n8n deployment boundary

The repository-side canonical export is
`n8n_backup/current-warm-path-clean-response.json`. Import and publish that export in n8n
before running production acceptance. A repository export does not prove which revision is
currently deployed.

The webhook must receive:

```json
{
  "owner_user_id": "<authenticated user UUID>",
  "workflow_run_id": "<current workflow UUID>",
  "search_request_id": "<current search request UUID>",
  "target": {
    "name": "Ali Elsheik",
    "current_company": "Anfal",
    "linkedin_url": "https://www.linkedin.com/in/Ali-elsheik",
    "location": "KSA"
  },
  "mutual_connections": []
}
```

Every transform node must preserve `owner_user_id`, `workflow_run_id`, and
`search_request_id`. `Save Candidates` must insert `owner_user_id` and
`workflow_run_id`. The current candidate schema relates candidates to the search request
through the exact workflow relationship:

```text
ranked_candidates.workflow_run_id
  -> workflow_runs.id
  -> search_requests.workflow_run_id
```

Reject workflows containing unscoped queries such as newest/latest workflow, first running
search, target-name-only lookup, static IDs, or delete-all candidate operations. The retained
`Delete Old Candidates` node in the export is disconnected and must remain disconnected or
be removed before publishing.

## Production evidence required

Capture the n8n execution ID and the input/output of `Webhook`, `Split Profiles`,
`Build Final Report`, and `Save Candidates`. Redact credentials. Confirm all three current
identifiers are unchanged at each node.

Verify the resulting rows with exact IDs:

```sql
select id, owner_user_id, status, target_person, target_company
from public.workflow_runs
where id = '<workflow_run_id>';

select id, owner_user_id, workflow_run_id, target_name, current_company,
       linkedin_name, location, status
from public.search_requests
where id = '<search_request_id>'
  and workflow_run_id = '<workflow_run_id>';

select id, owner_user_id, workflow_run_id, rank, name, linkedin_url
from public.ranked_candidates
where owner_user_id = '<owner_user_id>'
  and workflow_run_id = '<workflow_run_id>'
order by rank;
```

Confirm the candidate query contains no previous target name, company, URL, or location.
Also confirm no rows for the current owner and current search target were written under a
different workflow ID.

## Screenshots or execution data

Retain:

1. n8n execution overview with its execution ID.
2. Webhook input with secrets redacted.
3. Split Profiles output showing all three IDs.
4. Build Final Report output showing all three IDs.
5. Save Candidates field mapping and successful output.
6. Exact-ID Supabase query results for the workflow, request, and candidates.
