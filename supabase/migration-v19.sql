-- ============================================================================
--  SAMOT Launcher — Migration v19: очистка старых данных
--  - Устаревшие устройства (первые заходы старше 90 дней)
--  - Старые записи админ-лога (старше 180 дней)
--  Что намеренно не трогаем: projects / news / settings / bans / admins / project_members
--  Функция чистит по заданным срокам; вызывает супер-админ из админки; для cron — ручной SQL ниже.
-- ============================================================================

-- 1) RPC очистки (только super-admin)
create or replace function public.cleanup_old_data(
  device_days int default 90,
  audit_days int default 180
) returns jsonb language plpgsql security definer set search_path = public as
$$
declare
  v_devices_deleted int := 0;
  v_audit_deleted int := 0;
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;

  delete from public.user_devices
  where first_seen < now() - make_interval(days => greatest(device_days, 7));
  get diagnostics v_devices_deleted = row_count;

  delete from public.admin_audit_log
  where created_at < now() - make_interval(days => greatest(audit_days, 30));
  get diagnostics v_audit_deleted = row_count;

  return jsonb_build_object(
    'devices_deleted', v_devices_deleted,
    'audit_deleted', v_audit_deleted,
    'device_days', device_days,
    'audit_days', audit_days,
    'performed_at', now()
  );
end $$;
revoke all on function public.cleanup_old_data(int, int) from public;
grant execute on function public.cleanup_old_data(int, int) to authenticated;

-- 2) Опциональный cron (раскомментировать при включённом pg_cron):
-- select cron.schedule('samot-cleanup 2 a.m. daily', '0 2 * * *', $$select public.cleanup_old_data(90, 180)$$);
