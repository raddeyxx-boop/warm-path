# Warm Path Finder Auth, Admin, and RLS Setup

## Frontend Environment

Only these Vite variables belong in `dashboard/.env`:

```bash
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Never add a service-role key to any `VITE_` variable or frontend file.

## SQL Migration

Run the migration in Supabase SQL editor or with the Supabase CLI:

```bash
supabase db push
```

Migration path:

```text
supabase/migrations/202607160001_auth_rls_user_isolation.sql
```

The migration creates `public.profiles`, adds `owner_user_id` to `workflow_runs`, `ranked_candidates`, and `top_candidates`, enables RLS, and creates own-or-admin policies.

## First Admin

Create the Auth user first through Supabase Dashboard or secure server-side tooling. Then promote it:

```sql
update public.profiles
set
  role = 'admin',
  is_active = true,
  updated_at = now()
where lower(email) = lower('admin@indpro.com');
```

## Edge Function

Function path:

```text
supabase/functions/admin-users/index.ts
```

Deploy:

```bash
supabase functions deploy admin-users
```

Set server-side secrets:

```bash
supabase secrets set \
  SUPABASE_URL=your_supabase_project_url \
  SUPABASE_ANON_KEY=your_supabase_anon_key \
  SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

The service-role key is used only by the Edge Function.

## Data Isolation

Normal dashboard queries continue to use the browser Supabase client and anon key. RLS enforces:

- Normal users can read/write rows where `owner_user_id = auth.uid()`.
- Admin users can read all rows.
- Disabled users cannot read application data.
- Only admins can delete workflow/candidate rows.

Do not rely on frontend filters for security.

## n8n Owner Mapping

The workflow must preserve the authenticated user ID on every generated row:

```text
workflow_runs:
owner_user_id = {{ $json.owner_user_id }}

ranked_candidates:
owner_user_id = {{ $json.owner_user_id }}

top_candidates:
owner_user_id = {{ $json.owner_user_id }}
```

The existing Node sender accepts optional:

```bash
OWNER_USER_ID=<auth-user-uuid>
SUPABASE_ACCESS_TOKEN=<access-token>
```

Recommended production flow:

1. Frontend sends the Supabase access token.
2. A secure server or Edge Function validates the token.
3. The validated user ID is forwarded to n8n.
4. n8n writes the validated `owner_user_id`.

Do not trust arbitrary public webhook `owner_user_id` values in production.

## Run The Project

```bash
cd dashboard
npm install
npm run dev
```

Routes:

- `/login`
- `/admin/login`
- `/dashboard`
- `/admin`
- `/unauthorized`

## Manual Test Checklist

1. Admin logs in and reaches `/admin`.
2. Normal user logs in and reaches `/dashboard`.
3. Normal user cannot reach `/admin`.
4. Logged-out user cannot reach `/dashboard`.
5. Admin creates a user.
6. Created user can log in.
7. Created user has role `user`.
8. Created user initially sees no other users' data.
9. User-owned rows appear only for that user.
10. Admin sees all rows.
11. Deactivated user is rejected.
12. Reactivated user can log in.
13. Admin cannot delete themselves.
14. Admin can delete another user.
15. `top_candidate_reason` still renders.
16. `relationship_evidence` still renders.
17. Existing flip cards still work.
18. Existing dashboard layout remains unchanged.
19. Existing ranking calculations remain unchanged.
20. Existing n8n workflow still completes.
