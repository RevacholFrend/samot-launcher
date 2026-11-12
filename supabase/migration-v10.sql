-- ============================================================
--  SAMOT Launcher — v10: list_all_bans (история с фильтрами)
-- ============================================================

create or replace function public.list_all_bans(
  p_search text default null,
  p_state text default 'all',         -- 'all' | 'active' | 'expired'
  p_limit int default 200
) returns table (
  user_id uuid,
  email text,
  reason text,
  banned_by uuid,
  banned_until timestamptz,
  created_at timestamptz,
  is_active boolean,
  banned_by_email text
)
language sql security definer stable set search_path = public as
$$
  select
    b.user_id,
    u.email,
    b.reason,
    b.banned_by,
    b.banned_until,
    b.created_at,
    (b.banned_until > now()) as is_active,
    (select email from auth.users where id = b.banned_by) as banned_by_email
  from public.bans b
  join auth.users u on u.id = b.user_id
  where public.is_super()
    and (p_state = 'all'
          or (p_state = 'active'  and b.banned_until > now())
          or (p_state = 'expired' and b.banned_until <= now()))
    and (p_search is null
         or b.reason ilike '%' || p_search || '%'
         or u.email  ilike '%' || p_search || '%'
         or b.user_id::text ilike '%' || p_search || '%')
  order by b.banned_until desc
  limit greatest(p_limit, 1);
$$;
revoke all on function public.list_all_bans(text, text, int) from public;
grant execute on function public.list_all_bans(text, text, int) to authenticated;
