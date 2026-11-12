-- v22 — исправляем warn_user: alias w не существует в INSERT ... RETURNING
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
  returning id into v_id;
  perform public.audit_log('warning_create', 'warnings', v_id::text, p_project_id,
    jsonb_build_object('user_id', v_user_id, 'reason', p_reason, 'days', p_days));
  return jsonb_build_object('id', v_id, 'user_id', v_user_id, 'project_id', p_project_id);
end $$;
revoke all on function public.warn_user(text, bigint, text, int) from public;
grant execute on function public.warn_user(text, bigint, text, int) to authenticated;
