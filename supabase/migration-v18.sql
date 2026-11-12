-- v18 — GRANT SELECT/INSERT на admin_audit_log для authenticated
grant select, insert on public.admin_audit_log to authenticated;
grant select on public.admin_audit_log to authenticated;
