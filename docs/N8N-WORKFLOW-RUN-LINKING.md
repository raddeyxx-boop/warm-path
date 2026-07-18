# Workflow Run Candidate Linking

Use this patch on the active Warm Path Finder n8n workflow so every execution links its candidate rows to the `workflow_runs` row created for that execution.

## Required Order

1. Build the workflow summary payload.
2. Run `Save Workflow Run`.
3. Capture the inserted row id from `Save Workflow Run`.
4. Add that id to every ranked candidate item before `Save Candidates`.
5. Add that id to every top candidate item before `Save Top Candidates`.

## Save Workflow Run

The Supabase insert node should write to `workflow_runs` first and return the inserted row. The row must include:

```json
{
  "status": "completed",
  "target_person": "={{ $json.target_person }}",
  "target_company": "={{ $json.target_company }}",
  "total_candidates": "={{ $json.total_candidates }}",
  "top_candidates_count": "={{ $json.top_candidates_count }}",
  "average_final_score": "={{ $json.average_final_score }}",
  "completed_at": "={{ $json.completed_at }}"
}
```

## Attach Workflow Run ID

Add a Code node after `Save Workflow Run` and before the candidate insert branches. Merge or reference the ranked/top candidate arrays from the previous ranking output, and attach:

```js
const workflowRunId = $('Save Workflow Run').first().json.id;

return $input.all().map((item) => ({
  json: {
    ...item.json,
    workflow_run_id: workflowRunId,
  },
}));
```

If your workflow branches into separate ranked and top-candidate insert paths, use the same code in both paths, or add the field in the code nodes that build each insert payload.

## Ranked Candidates Insert

In the `Save Candidates` Supabase node for `ranked_candidates`, add this field mapping:

```text
workflow_run_id = {{ $json.workflow_run_id }}
```

Keep the existing candidate fields as-is. Do not duplicate candidate rows just to create the relationship.

## Top Candidates Insert

In the `Save Top Candidates` Supabase node for `top_candidates`, add this field mapping:

```text
workflow_run_id = {{ $json.workflow_run_id }}
```

The top-candidates branch should select the existing ranked output's top three items, keep their candidate fields, attach `workflow_run_id`, then insert those three rows into `top_candidates`.

## Verification

After one workflow execution:

```sql
select id, target_person, target_company, total_candidates, top_candidates_count
from public.workflow_runs
order by created_at desc
limit 1;

select rank, name, workflow_run_id
from public.ranked_candidates
where workflow_run_id = '<workflow_runs.id>'
order by rank asc;

select rank, name, workflow_run_id
from public.top_candidates
where workflow_run_id = '<workflow_runs.id>'
order by rank asc
limit 3;
```
