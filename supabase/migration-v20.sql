-- ============================================================================
--  SAMOT Launcher — Migration v20: warnings (soft warnings before ban)
--  Новая таблица public.warnings: мягкое предупреждение от администрации
--  проекта. Показывает полоску в клиенте с проектом, причиной, сроком.
-- ============================================================================

create table if not exists public.warnings (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  project_id  bigint not null references public.projects(id) on delete cascade,
  reason      text not null,
  warned_by   uuid references auth.users(id) on delete set null,
  warned_until timestamptz not null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);
create index if not exists warnings_user_idx on public.warnings (user_id);
create index if not exists warnings_project_idx on public.warnings (project_id);
create index if not exists warnings_active_idx on public.warnings (warned_until) where revoked_at is null;

alter table public.warnings enable row level security;
drop policy if exists warnings_owner_read on public.warnings;
create policy warnings_owner_read on public.warnings for select
  using (user_id = auth.uid() or public.is_super() or public.is_owner(project_id));
drop policy if exists warnings_owner_insert on public.warnings;
create policy warnings_owner_insert on public.warnings for insert
  with check (public.is_super() or public.is_owner(project_id));
drop policy if exists warnings_owner_update on public.warnings;
create policy warnings_owner_update on public.warnings for update
  using (public.is_super() or public.is_owner(project_id));

-- Аудит-триггер для warnings
create or replace function public.audit_warnings()
returns trigger language plpgsql security definer set search_path = public as
$$
declare _rid text; _pid bigint; _action text;
begin
  if TG_OP = 'INSERT' then
    _rid := NEW.id::text; _pid := NEW.project_id; _action := 'warning_create';
    perform public.audit_log(_action, 'warnings', _rid, _pid,
      jsonb_build_object('user_id', NEW.user_id, 'reason', NEW.reason, 'warned_until', NEW.warned_until));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    _rid := NEW.id::text; _pid := NEW.project_id; _action := 'warning_update';
    perform public.audit_log(_action, 'warnings', _rid, _pid,
      jsonb_build_object('user_id', NEW.user_id, 'before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
    return NEW;
  else
    _rid := OLD.id::text; _pid := OLD.project_id; _action := 'warning_delete';
    perform public.audit_log(_action, 'warnings', _rid, _pid,
      jsonb_build_object('user_id', OLD.user_id, 'reason', OLD.reason));
    return OLD;
  end if;
end $$;

drop trigger if exists warnings_audit on public.warnings;
create trigger warnings_audit
  after insert or update or delete on public.warnings
  for each row execute function public.audit_warnings();

-- RPC: предупредить пользователя (текущий проект)
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
    raise exception 'Only project owner or super admin can warn';
  end if;
  if coalesce(p_reason, '') = '' then raise exception 'reason required'; end if;
  if coalesce(p_days, 0) <= 0 then raise exception 'days must be positive'; end if;

  select id into v_user_id from auth.users where email = lower(p_user_email);
  if not found then raise exception 'User % not found', p_user_email; end if;

  insert into public.warnings (user_id, project_id, reason, warned_by, warned_until)
  values (v_user_id, p_project_id, p_reason, auth.uid(), now() + make_interval(days => p_days))
  returning id into v_id;

  perform public.audit_log('warning_create', 'warnings', v_id::text, p_project_id,
    jsonb_build_object('user_id', v_user_id, 'reason', p_reason, 'days', p_days));

  return jsonb_build_object('id', v_id, 'user_id', v_user_id, 'project_id', p_project_id);
end $$;
revoke all on function public.warn_user(text, bigint, text, int) from public;
grant execute on function public.warn_user(text, bigint, text, int) to authenticated;

-- RPC: активные предупреждения текущего пользователя (для клиента)
create or replace function public.list_my_warnings()
returns table (
  id bigint,
  project_id bigint,
  reason text,
  warned_until timestamptz,
  created_at timestamptz,
  project_name text
) language sql stable security definer set search_path = public as
$$
  select w.id, w.project_id, w.reason, w.warned_until, w.created_at, p.name
  from public.warnings w
  join public.projects p on p.id = w.project_id
  where w.user_id = auth.uid()
    and w.warned_until > now()
    and w.revoked_at is null
  order by w.warned_until asc;
$$;
revoke all on function public.list_my_warnings() from public;
grant execute on function public.list_my_warnings() to authenticated;

-- RPC: список предупреждений проекта (для админки)
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
  select w.id, w.user_id,
         coalesce((select email from auth.users where id = w.user_id), 'unknown'),
         w.reason, w.warned_until, w.revoked_at, w.created_at
  from public.warnings w
  where w.project_id = p_project_id
  order by w.created_at desc;
end $$;
revoke all on function public.list_project_warnings(bigint) from public;
grant execute on function public.list_project_warnings(bigint) to authenticated;

-- RPC: отозвать предупреждение
create or replace function public.revoke_warning(p_id bigint)
returns void language plpgsql security definer set search_path = public as
$$
declare v_pid bigint;
begin
  select project_id into v_pid from public.warnings where id = p_id;
  if v_pid is null then raise exception 'warning not found'; end if;
  if not (public.is_super() or public.is_owner(v_pid)) then
    raise exception 'Only project owner or super admin';
  end if;
  update public.warnings set revoked_at = now() where id = p_id;
  perform public.audit_log('warning_revoke', 'warnings', p_id::text, v_pid,
    jsonb_build_object('id', p_id));
end $$;
revoke all on function public.revoke_warning(bigint) from public;
grant execute on function public.revoke_warning(bigint) to authenticated;
