# n8n extraction-completed webhook

The backend sends one `warm_path.extraction_completed` request after target, connection, candidate, relationship, and classification artifacts have been finalized. Failed or partial Playwright runs do not dispatch this event.

Required request headers:

- `Content-Type: application/json`
- `Accept: application/json`
- `X-Idempotency-Key: <workflow_run_id>:<search_request_id>:extraction_completed`
- `X-Warm-Path-Webhook-Secret` when `N8N_WEBHOOK_SECRET` is configured

The existing user bearer authorization header is retained for compatibility with the current workflow.

The JSON body contains trace identifiers, target data, `extraction.target_profile`, `extraction.connections`, `extraction.candidates`, `extraction.relationship_evidence`, summary and execution metadata. The previous final report is preserved at `extraction.final_report` and its legacy top-level fields remain available during migration.

The n8n workflow must validate the optional secret, reject missing identifiers, deduplicate the idempotency key, and respond with JSON:

```json
{
  "accepted": true,
  "execution_id": "n8n execution identifier"
}
```

Only a 2xx response with `accepted: true` is successful. Retried requests reuse the same idempotency key.
