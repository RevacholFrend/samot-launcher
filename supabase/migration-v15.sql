-- ============================================================================
--  SAMOT Launcher — Migration v15: Доступ super-админа, список пользователей,
--  список разработчиков, аналитика за период
--  Применять через Supabase Dashboard → SQL Editor, либо через CLI --file.
-- ============================================================================

-- 1) super может удалять любой проект
drop policy if exists projects_delete_super on public.projects;
create policy projects_delete_super on public.projects for delete using (public.is_super());

-- 2) Список всех пользователей (super-only)
create or replace function public.list_all_users(max_rows int default 2000)
returns table (
  id uuid,
  email text,
  nickname text,
  created_at timestamptz,
  devices bigint,
  active_ban boolean,
  ban_reason text,
  ban_until timestamptz,
  project_count int,
  project_names text[]
)
language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  return query
  select
    u.id,
    coalesce(u.email, '')::text,
    coalesce(u.raw_user_meta_data->>'nickname', '')::text,
    u.created_at,
    count(distinct d.device_id),
    coalesce(bool_or(b.banned_until > now()), false),
    max(b.reason) filter (where b.banned_until > now()),
    max(b.banned_until) filter (where b.banned_until > now()),
    count(distinct pm.project_id)::int,
    array_agg(distinct p.name) filter (where p.name is not null)
  from auth.users u
  left join public.user_devices d on d.user_id = u.id
  left join public.bans b on b.user_id = u.id
  left join public.project_members pm on pm.user_id = u.id
  left join public.projects p on p.id = pm.project_id
  group by u.id, u.email, u.raw_user_meta_data, u.created_at
  order by u.created_at desc
  limit max_rows;
end $$;
revoke all on function public.list_all_users(int) from public;
grant execute on function public.list_all_users(int) to authenticated;

-- 3) Список всех, у кого есть доступ к админке: super-админы + участники проектов
create or replace function public.list_admins()
returns table (
  id uuid,
  email text,
  nickname text,
  project_count int,
  project_names text[],
  is_super boolean
)
language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  return query
  select u.id, coalesce(u.email, '')::text,
         coalesce(u.raw_user_meta_data->>'nickname', '')::text,
         count(distinct pm.project_id)::int,
         array_agg(distinct p.name order by p.name) filter (where p.name is not null),
         exists(select 1 from public.admins a where a.user_id = u.id)
  from auth.users u
  left join public.project_members pm on pm.user_id = u.id
  left join public.projects p on p.id = pm.project_id
  where exists(select 1 from public.admins a where a.user_id = u.id)
     or pm.user_id is not null
  group by u.id, u.email, u.raw_user_meta_data
  union
  select u.id, coalesce(u.email, '')::text,
         coalesce(u.raw_user_meta_data->>'nickname', '')::text,
         0::int, '{}'::text[], true
  from auth.users u
  where exists(select 1 from public.admins a where a.user_id = u.id)
  order by 1;
end $$;
revoke all on function public.list_admins() from public;
grant execute on function public.list_admins() to authenticated;

-- 4) Выдать/снять super-доступ (только для super)
create or replace function public.set_super(target uuid, make boolean)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  if make then
    insert into public.admins (user_id) values (target) on conflict do nothing;
  else
    delete from public.admins where user_id = target;
  end if;
end $$;
revoke all on function public.set_super(uuid, boolean) from public;
grant execute on function public.set_super(uuid, boolean) to authenticated;

-- 5) Аналитика за произвольный период (дней назад; 0 = всё время)
create or replace function public.analytics_overview_range(period_days int default 30)
returns jsonb language plpgsql security definer stable set search_path = public as
$$
declare result jsonb; d interval;
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  d := make_interval(days => greatest(period_days, 1));
  select jsonb_build_object(
    'period_days', period_days,
    'new_users', (select count(*) from auth.users where created_at >= now() - d),
    'active_devices', (select count(*) from public.user_devices where last_seen >= now() - d),
    'new_bans', (select count(*) from public.bans where created_at >= now() - d),
    'news_published', (select count(*) from public.news where published_at >= now() - d),
    'launches', (select coalesce(sum(cnt), 0) from (
      select count(*) as cnt from public.user_devices where last_seen >= now() - d group by user_id
    ) t),
    'total_users', (select count(*) from auth.users),
    'total_devices', (select count(*) from public.user_devices),
    'total_bans', (select count(*) from public.bans),
    'active_bans', (select count(*) from public.bans where banned_until > now()),
    'projects', (select count(*) from public.projects),
    'projects_approved', (select count(*) from public.projects where approved = true),
    'news_total', (select count(*) from public.news)
  ) into result;
  return result;
end $$;
revoke all on function public.analytics_overview_range(int) from public;
grant execute on function public.analytics_overview_range(int) to authenticated;
