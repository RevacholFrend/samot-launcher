-- ============================================================================
--  SAMOT Launcher — Migration v21: invite_member + fix warnings RPC
--  1) invite_member: super-админ ИЛИ владелец проекта может пригласить по email
--  2) list_project_warnings: убираем JOIN с ambiguous "id"
--  3) is_owner: super-админ неявно считается владельцем всех проектов
-- ============================================================================

-- 1) is_owner: super-админа считаем владельцем любого проекта
create or replace function public.is_owner(pid bigint)
returns boolean language sql security definer stable set search_path = public as
$$
  select public.is_super() or exists(
    select 1 from public.project_members
    where project_id = pid and user_id = auth.uid() and role = 'owner'
  );
$$;

-- 2) invite_member (super-админ или владелец)
create or replace function public.invite_member(
  p_project_id bigint,
  p_email text,
  p_role text default 'editor'
) returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user_id uuid;
begin
  if not (public.is_super() or public.is_owner(p_project_id)) then
    raise exception 'Only project owner or super admin can invite';
  end if;
  if p_role not in ('editor', 'owner') then
    raise exception 'Invalid role: %', p_role;
  end if;
  if coalesce(p_email, '') = '' then
    raise exception 'email required';
  end if;
  select id into v_user_id from auth.users where email = lower(p_email);
  if not found then
    raise exception 'User with email % not found', p_email;
  end if;
  insert into public.project_members (project_id, user_id, email, role)
  values (p_project_id, v_user_id, lower(p_email), p_role)
  on conflict (project_id, user_id) do update set role = excluded.role, email = excluded.email;
  perform public.audit_log('member_invite', 'project_members',
    p_project_id::text || ':' || v_user_id::text, p_project_id,
    jsonb_build_object('user_id', v_user_id, 'email', lower(p_email), 'role', p_role));
  return jsonb_build_object('project_id', p_project_id, 'user_id', v_user_id, 'role', p_role);
end $$;
revoke all on function public.invite_member(bigint, text, text) from public;
grant execute on function public.invite_member(bigint, text, text) to authenticated;

-- 3) исправить list_project_warnings: убрал ambiguous id
create or replace function public.list_project_warnings(p_project_id bigint)
returns table (
  id bigint,
  user_id uuid,
  user_email text,
  reason text,
  warned_until timestamptz,
  revoked_at timestamptz,
  created_at timestamptz
) language plpgsql security definer set search_path = public as
$$
begin
  if not (public.is_super() or public.is_owner(p_project_id)) then
    raise exception 'Only project owner or super admin';
  end if;
  return query
  select
    w.id,
    w.user_id,
    coalesce((select email from auth.users u where u.id = w.user_id limit 1), 'unknown')::text,
    w.reason,
    w.warned_until,
    w.revoked_at,
    w.created_at
  from public.warnings w
  where w.project_id = p_project_id
  order by w.created_at desc;
end $$;
revoke all on function public.list_project_warnings(bigint) from public;
grant execute on function public.list_project_warnings(bigint) to authenticated;

-- 4) mail-fallback на случай пустого email
create or replace function public.warn_user(
  p_user_email text,
  p_project_id bigint,
  p_reason text,
  p_days int default 7
) returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_user_id uuid;
  v_id bigint;
begin
  if not (public.is_super() or public.is_owner(p_project_id)) then
    raise exception 'Only project owner or super admin';
  end if;
  if coalesce(p_reason, '') = '' then
    raise exception 'reason required';
  end if;
  if coalesce(p_days, 0) <= 0 then
    raise exception 'days must be positive';
  end if;
  select u.id into v_user_id from auth.users u where u.email = lower(p_user_email) limit 1;
  if v_user_id is null then
    raise exception 'User % not found', p_user_email;
  end if;
  insert into public.warnings (user_id, project_id, reason, warned_by, warned_until)
  values (v_user_id, p_project_id, p_reason, auth.uid(), now() + make_interval(days => p_days))
  returning w.id into v_id;
  perform public.audit_log('warning_create', 'warnings', v_id::text, p_project_id,
    jsonb_build_object('user_id', v_user_id, 'reason', p_reason, 'days', p_days));
  return jsonb_build_object('id', v_id, 'user_id', v_user_id, 'project_id', p_project_id);
end $$;
revoke all on function public.warn_user(text, bigint, text, int) from public;
grant execute on function public.warn_user(text, bigint, text, int) to authenticated;
