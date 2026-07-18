# n8n User Ownership

Warm Path Finder dashboard data is isolated by `owner_user_id`.

The authenticated Supabase user id must flow through the workflow and be written to every user-owned row. The relationship is:

```text
auth.users.id
profiles.id
workflow_runs.owner_user_id
ranked_candidates.owner_user_id
top_candidates.owner_user_id
```

## Required mappings

Preserve `owner_user_id` from the webhook payload through all transform/code nodes that build Supabase insert rows.

```text
workflow_runs:
owner_user_id = {{ $json.owner_user_id }}

ranked_candidates:
owner_user_id = {{ $json.owner_user_id }}

top_candidates:
owner_user_id = {{ $json.owner_user_id }}
```

If a node nests the webhook body under another object, use the actual preserved path for that workflow, for example:

```text
owner_user_id = {{ $json.body.owner_user_id }}
```

or:

```text
owner_user_id = {{ $json.target.owner_user_id }}
```

## Frontend launch contract

When a logged-in user starts a workflow, the frontend must send the current Supabase session token and the current user id:

```js
const {
  data: { session },
} = await supabase.auth.getSession()

if (!session?.user) {
  throw new Error('You must be signed in.')
}

const payload = {
  ...existingPayload,
  owner_user_id: session.user.id,
}

await fetch(existingWebhookUrl, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${session.access_token}`,
  },
  body: JSON.stringify(payload),
})
```

Do not hard-code user ids.

## Security warning

Blindly trusting `owner_user_id` from a public webhook is not secure. A caller can spoof another user id unless the JWT is validated server-side.

Recommended production architecture:

1. Frontend sends the Supabase JWT.
2. Edge Function validates the JWT with Supabase.
3. Edge Function derives the trusted user id from the validated JWT.
4. Edge Function forwards the trusted `owner_user_id` to n8n.
5. n8n writes that id to Supabase.

RLS then enforces:

- Normal users only see rows where `owner_user_id = auth.uid()`.
- Active admins can see all rows through `public.profiles.role = 'admin'`.
- Inactive users cannot access workflow data.
