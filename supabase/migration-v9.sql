-- ============================================================
--  Xuita Launcher — v9: передача IP через upsert_my_device
-- ============================================================

drop function if exists public.upsert_my_device(uuid, text, text, text, text);

create or replace function public.upsert_my_device(
  p_device_id uuid,
  p_device_name text,
  p_platform text,
  p_user_agent text,
  p_app_version text,
  p_ip_address text default ''
) returns public.user_devices
language plpgsql security definer set search_path = public as
$$
declare
  u uuid := auth.uid();
  result public.user_devices;
begin
  if u is null then raise exception 'not authenticated'; end if;
  insert into public.user_devices (user_id, device_id, device_name, platform, user_agent, app_version, ip_address, last_seen)
  values (u, p_device_id, coalesce(p_device_name, ''), coalesce(p_platform, ''), coalesce(p_user_agent, ''), coalesce(p_app_version, ''), coalesce(p_ip_address, ''), now())
  on conflict (user_id, device_id) do update
    set device_name = excluded.device_name,
        platform   = excluded.platform,
        user_agent  = excluded.user_agent,
        app_version = excluded.app_version,
        ip_address  = excluded.ip_address,
        last_seen   = now()
  returning * into result;
  return result;
end
$$;
revoke all on function public.upsert_my_device(uuid, text, text, text, text, text) from public;
grant execute on function public.upsert_my_device(uuid, text, text, text, text, text) to authenticated;
