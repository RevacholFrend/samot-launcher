-- v23 — find_user_by_email (для выдачи super и приглашения)
create or replace function public.find_user_by_email(email text)
returns table (user_id uuid, email text) language sql security definer
set search_path = public as
$$
  select id, coalesce(u.email, '')::text
  from auth.users u
  where lower(u.email) = lower(email)
  limit 1;
$$;
revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;
