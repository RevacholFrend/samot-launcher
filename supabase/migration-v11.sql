-- ============================================================
--  Xuita Launcher — v11: admin_user_overview (super-admin)
--  Возвращает JSON-сводку по пользователю: email, проекты, статус бана.
-- ============================================================

create or replace function public.admin_user_overview(target uuid)
returns jsonb
language plpgsql security definer stable set search_path = public as
$$
declare
  result jsonb;
  email_txt text;
  created timestamptz;
  projects_json jsonb;
  banned_flag boolean;
  ban_reason text;
  ban_until timestamptz;
  ban_started timestamptz;
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;

  select u.email, u.created_at into email_txt, created from auth.users u where u.id = target;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'project_id', p.id,
      'name', p.name,
      'slug', p.slug,
      'role', mp.role,
      'approved', p.approved,
      'is_hidden', p.is_hidden
    ) order by mp.created_at
  ), '[]'::jsonb) into projects_json
  from public.project_members mp
  join public.projects p on p.id = mp.project_id
  where mp.user_id = target;

  select banned_until > now(), reason, banned_until, created_at
    into banned_flag, ban_reason, ban_until, ban_started
  from public.bans
  where user_id = target and banned_until > now()
  limit 1;

  result := jsonb_build_object(
    'id', target,
    'email', email_txt,
    'created_at', created,
    'projects', projects_json,
    'banned', coalesce(banned_flag, false),
    'ban_reason', ban_reason,
    'ban_until', ban_until
  );
  return result;
end
$$;
revoke all on function public.admin_user_overview(uuid) from public;
grant execute on function public.admin_user_overview(uuid) to authenticated;

create or replace function public.find_user_any(p_search text)
returns table (user_id uuid, email text, created_at timestamptz)
language plpgsql security definer stable set search_path = public as
$$
declare
  s text := lower(trim(p_search));
  uid uuid;
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;

  if s ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    begin
      uid := s::uuid;
    exception when others then
      uid := null;
    end;
    if uid is not null then
      return query select u.id, u.email, u.created_at from auth.users u where u.id = uid;
      return;
    end if;
  end if;

  return query select u.id, u.email, u.created_at
  from auth.users u
  where u.email ilike '%' || s || '%'
  order by u.last_sign_in_at desc nulls last
  limit 10;
end
$$;
revoke all on function public.find_user_any(text) from public;
grant execute on function public.find_user_any(text) to authenticated;
