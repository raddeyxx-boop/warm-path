# Supabase Setup

Warm Path Finder now uses Supabase Auth, `public.profiles`, owner-based RLS, and the `admin-users` Edge Function.

Use the secure setup guide instead of public read policies:

```text
dashboard/docs/AUTH-ADMIN-RLS.md
```

Do not create broad always-allow policies for dashboard tables. Normal users should only see rows where `owner_user_id = auth.uid()`, while active admins can see all rows through the RLS policies in the migration.
