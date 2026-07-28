-- Only authorized admins may delete unprocessed registration requests.
drop policy if exists "profiles_admin_delete" on public.profiles;

create policy "profiles_admin_delete_pending"
on public.profiles
for delete
to authenticated
using (
  public.is_admin()
  and approval_status = 'pending'
  and id <> (select auth.uid())
);
