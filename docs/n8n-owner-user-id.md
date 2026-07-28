# n8n Owner User ID

Warm Path Finder uses Supabase RLS to isolate dashboard rows by:

```text
owner_user_id = auth.uid()
```

Every workflow launch must preserve the authenticated Supabase user id through n8n and into Supabase inserts.

## Current Request Shape

The existing pipeline sends JSON directly to the n8n webhook from `scripts/send-to-n8n.js`:

```json
{
  "target": {},
  "mutual_connections": [],
  "owner_user_id": "<supabase-user-uuid>"
}
```

The request also includes:

```text
Authorization: Bearer <supabase-access-token>
```

Do not log the access token.

## Dashboard and CLI Runs

In local mode, the normal path initializes the search through Supabase and then
calls the local Playwright server:

```text
POST ${VITE_PLAYWRIGHT_SERVER_URL}/api/searches/start
```

The dashboard reads the current Supabase session and sends:

```text
Authorization = Bearer <session.access_token>
```

The request body preserves the `workflow_run_id` and `search_request_id` created by
the initialization RPC. The worker derives the trusted owner from the validated
access token.

```text
VITE_APP_MODE=local
VITE_PLAYWRIGHT_SERVER_URL=http://localhost:3000
```

The Vercel deployment uses `VITE_APP_MODE=demo`, does not configure this URL,
and never dispatches execution requests.

If you run the sender directly, provide the same auth context either as environment variables:

```powershell
$env:OWNER_USER_ID="your-supabase-auth-user-id"
$env:SUPABASE_ACCESS_TOKEN="your-current-session-access-token"
node scripts/send-to-n8n.js
```

or as one command:

```powershell
node scripts/send-to-n8n.js --owner-user-id "your-supabase-auth-user-id" --access-token "your-current-session-access-token"
```

If either value is missing in an interactive terminal, the script prompts for it before sending.

## Manual Browser Verification

1. Log in.
2. Open DevTools.
3. Open Application > Local Storage.
4. Confirm Supabase created an `sb-<project-ref>-auth-token` key.
5. Refresh the page and confirm the dashboard remains authenticated.
6. Start the workflow from the dashboard.
7. Open DevTools Network and inspect `/api/searches/start`.
8. Confirm the request body has both authoritative workflow identifiers.
9. Confirm the `Authorization` header exists.

Do not copy, publish, or log the full bearer token.

## n8n Webhook Expression

Depending on the n8n Webhook node output mode, read the user id with one of:

```text
{{ $json.owner_user_id }}
```

or:

```text
{{ $json.body.owner_user_id }}
```

For the current direct JSON body shape, code nodes should preserve:

```js
return $input.all().map((item) => {
  const p = item.json ?? {}

  return {
    json: {
      ...p,
      owner_user_id:
        p.owner_user_id ??
        p.body?.owner_user_id ??
        null,
    },
  }
})
```

For nodes that manually return a new object, explicitly include:

```js
owner_user_id:
  p.owner_user_id ??
  p.body?.owner_user_id ??
  null
```

## Required Supabase Mappings

Save Workflow Run:

```text
owner_user_id = {{ $json.owner_user_id }}
```

Save Candidates / `ranked_candidates`:

```text
owner_user_id = {{ $json.owner_user_id }}
```

Save Top Candidates / `top_candidates`:

```text
owner_user_id = {{ $json.owner_user_id }}
```

If candidate rows only contain `workflow_run_id` and the database trigger inherits ownership, still ensure `workflow_runs.owner_user_id` is written correctly.

## Production Security Note

Sending `owner_user_id` to a public n8n webhook is useful for the current pipeline, but a public webhook does not automatically validate the Supabase token.

Recommended production flow:

1. React sends the Supabase JWT in the `Authorization` header.
2. A Supabase Edge Function validates the JWT.
3. The Edge Function derives the trusted user id from the validated token.
4. The Edge Function forwards the trusted `owner_user_id` to n8n.
5. n8n writes that id to Supabase.

Do not trust a client-supplied UUID alone for security.
