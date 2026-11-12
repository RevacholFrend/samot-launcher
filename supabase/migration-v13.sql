-- ============================================================
--  SAMOT Launcher — v13: аналитика (без новых таблиц)
--  1) analytics_overview() — возвращает JSON со сводкой
--  2) analytics_launch_log() — суточные запуски за 30 дней
-- ============================================================

create or replace function public.analytics_overview()
returns jsonb
language plpgsql security definer stable set search_path = public as
$$
declare result jsonb;
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  select jsonb_build_object(
    'total_users', (select count(*) from auth.users),
    'total_devices', (select count(*) from public.user_devices),
    'total_bans', (select count(*) from public.bans),
    'active_bans', (select count(*) from public.bans where banned_until > now()),
    'new_users_7d', (select count(*) from auth.users where created_at >= now() - interval '7 days'),
    'new_users_30d', (select count(*) from auth.users where created_at >= now() - interval '30 days'),
    'active_devices_7d', (select count(*) from public.user_devices where last_seen >= now() - interval '7 days'),
    'active_devices_30d', (select count(*) from public.user_devices where last_seen >= now() - interval '30 days'),
    'projects', (select count(*) from public.projects),
    'projects_approved', (select count(*) from public.projects where approved = true),
    'news_total', (select count(*) from public.news)
  ) into result;
  return result;
end
$$;
revoke all on function public.analytics_overview() from public;
grant execute on function public.analytics_overview() to authenticated;

create or replace function public.analytics_launch_log()
returns table (day date, devices bigint)
language sql security definer stable set search_path = public as
$$
  select (now()::date - d.i) as day,
         (select count(distinct device_id)
            from public.user_devices
            where last_seen::date >= (now()::date - d.i)
              and last_seen::date <= (now()::date - d.i)) as devices
  from generate_series(0, 13) as d(i)
  order by day asc;
$$;
revoke all on function public.analytics_launch_log() from public;
grant execute on function public.analytics_launch_log() to authenticated;
