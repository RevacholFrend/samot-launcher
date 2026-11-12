-- ============================================================
--  SAMOT Launcher — v8: user_devices (список устройств)
--  Считает все устройства, с которых пользователь входил.
--  1) upsert_my_device — регистрация/обновление текущего устройства
--  2) list_my_devices — список для самого пользователя
--  3) remove_my_device — удалить своё устройство (ревокации сессии нет, но скрыть)
--  4) list_user_devices — супер-админ смотрит чужие
--  5) remove_user_device — супер-админ удаляет чужое устройство
-- ============================================================

create table if not exists public.user_devices (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null,
  device_id  uuid not null,
  device_name text not null default '',
  platform   text not null default '',
  user_agent text not null default '',
  ip_address text not null default '',
  app_version text not null default '',
  last_seen  timestamptz not null default now(),
  first_seen  timestamptz not null default now(),
  unique(user_id, device_id)
);

alter table public.user_devices enable row level security;

drop policy if exists devices_select_own on public.user_devices;
create policy devices_select_own on public.user_devices for select
  using (user_id = auth.uid() or public.is_super());

drop policy if exists devices_upsert_own on public.user_devices;
create policy devices_upsert_own on public.user_devices for insert
  with check (user_id = auth.uid());

drop policy if exists devices_update_own on public.user_devices;
create policy devices_update_own on public.user_devices for update
  using (user_id = auth.uid() or public.is_super())
  with check (user_id = auth.uid() or public.is_super());

drop policy if exists devices_delete_super on public.user_devices;
create policy devices_delete_super on public.user_devices for delete
  using (public.is_super());

grant select, insert, update on public.user_devices to authenticated;
grant delete on public.user_devices to authenticated;

-- upsert: вызывается на каждом запуске клиентом
create or replace function public.upsert_my_device(
  p_device_id uuid,
  p_device_name text,
  p_platform text,
  p_user_agent text,
  p_app_version text
) returns public.user_devices
language plpgsql security definer set search_path = public as
$$
declare
  u uuid := auth.uid();
  result public.user_devices;
begin
  if u is null then raise exception 'not authenticated'; end if;
  insert into public.user_devices (user_id, device_id, device_name, platform, user_agent, app_version, last_seen)
  values (u, p_device_id, coalesce(p_device_name, ''), coalesce(p_platform, ''), coalesce(p_user_agent, ''), coalesce(p_app_version, ''), now())
  on conflict (user_id, device_id) do update
    set device_name = excluded.device_name,
        platform   = excluded.platform,
        user_agent = excluded.user_agent,
        app_version = excluded.app_version,
        last_seen  = now()
  returning * into result;
  return result;
end
$$;
revoke all on function public.upsert_my_device(uuid, text, text, text, text) from public;
grant execute on function public.upsert_my_device(uuid, text, text, text, text) to authenticated;

create or replace function public.list_my_devices()
returns setof public.user_devices
language sql security definer stable set search_path = public as
$$ select * from public.user_devices where user_id = auth.uid() order by last_seen desc $$;
revoke all on function public.list_my_devices() from public;
grant execute on function public.list_my_devices() to authenticated;

create or replace function public.remove_my_device(target uuid)
returns void language sql security definer set search_path = public as
$$ delete from public.user_devices where user_id = auth.uid() and device_id = target $$;
revoke all on function public.remove_my_device(uuid) from public;
grant execute on function public.remove_my_device(uuid) to authenticated;

-- чужие устройства: только супер-админ
create or replace function public.list_user_devices(target_user uuid)
returns setof public.user_devices
language plpgsql security definer stable set search_path = public as
$$
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  return query select * from public.user_devices where user_id = target_user order by last_seen desc;
end
$$;
revoke all on function public.list_user_devices(uuid) from public;
grant execute on function public.list_user_devices(uuid) to authenticated;

create or replace function public.remove_user_device(target_device uuid)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  delete from public.user_devices where id = target_device;
end
$$;
revoke all on function public.remove_user_device(uuid) from public;
grant execute on function public.remove_user_device(uuid) to authenticated;
