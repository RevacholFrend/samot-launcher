-- ============================================================
--  SAMOT Launcher — v4: RPC для банов и проверка бана в клиенте
--  Идемпотентна. Применять после v3.
-- ============================================================

-- 1) Список активных банов для админов
create or replace function public.list_active_bans()
returns table (user_id uuid, reason text, banned_by uuid, banned_until timestamptz, email text)
language sql security definer stable set search_path = public as
$$
  select b.user_id, b.reason, b.banned_by, b.banned_until, u.email
  from public.bans b
  join auth.users u on u.id = b.user_id
  where b.banned_until > now()
  order by b.banned_until desc;
$$;
revoke all on function public.list_active_bans() from public;
grant execute on function public.list_active_bans() to authenticated;

-- 2) Забанить/разбанить (банят только супер-админы; разбанить можно тоже только super)
create or replace function public.ban_user(target uuid, ban_until timestamptz, reason text default '')
returns void
language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_super() then
    raise exception 'Only super admins can ban / unban users';
  end if;
  if ban_until is null then
    delete from public.bans where user_id = target;
  else
    insert into public.bans (user_id, reason, banned_until, banned_by)
    values (target, coalesce(reason, ''), ban_until, auth.uid())
    on conflict (user_id) do update
      set reason = excluded.reason,
          banned_until = excluded.banned_until,
          banned_by = excluded.banned_by;
  end if;
end $$;
revoke all on function public.ban_user(uuid, timestamptz, text) from public;
grant execute on function public.ban_user(uuid, timestamptz, text) to authenticated;

-- 3) Проверка (не нужно вызывать из лаунчера вручную — RLS её не использует; но полезно для дебага)
create or replace function public.am_i_banned() returns boolean
language sql security definer stable set search_path = public as
$$ select exists(select 1 from public.bans where user_id = auth.uid() and banned_until > now()) $$;
revoke all on function public.am_i_banned() from public;
grant execute on function public.am_i_banned() to authenticated;

-- 4) Удалить проект (только владелец или superadmin)
create or replace function public.delete_project_admin(pid bigint) returns void
language plpgsql security definer set search_path = public as
$$
begin
  if not (public.is_owner(pid) or public.is_super()) then
    raise exception 'Only the project owner or super admin can delete';
  end if;
  delete from public.projects where id = pid;
end $$;
revoke all on function public.delete_project_admin(bigint) from public;
grant execute on function public.delete_project_admin(bigint) to authenticated;
