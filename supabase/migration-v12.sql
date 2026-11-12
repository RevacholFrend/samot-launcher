-- ============================================================
--  Xuita Launcher — v12: clear_user_devices
-- ============================================================

create or replace function public.clear_user_devices(target_user uuid)
returns void
language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  delete from public.user_devices where user_id = target_user;
end
$$;
revoke all on function public.clear_user_devices(uuid) from public;
grant execute on function public.clear_user_devices(uuid) to authenticated;
