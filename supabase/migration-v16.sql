-- v16 — list_admins без дубля (одна ветка LEFT JOIN)
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
  select u.id,
         coalesce(u.email, '')::text,
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
  order by 1;
end $$;
revoke all on function public.list_admins() from public;
grant execute on function public.list_admins() to authenticated;
