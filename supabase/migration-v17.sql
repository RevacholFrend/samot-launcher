-- ============================================================================
--  SAMOT Launcher — Migration v17: admin_audit_log (журнал действий админов)
--  Триггеры на projects / settings / news / bans / project_members / user_devices / admins
--  Применять через SQL Editor или через CLI --file.
-- ============================================================================

-- 1) Таблица журнала ----------------------------------------------------
create table if not exists public.admin_audit_log (
  id          bigint generated always as identity primary key,
  actor_id    uuid references auth.users(id) on delete set null,
  action      text not null,
  table_name  text not null,
  record_id   text not null,
  project_id  bigint,
  details     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists admin_audit_log_created_idx on public.admin_audit_log (created_at desc);
create index if not exists admin_audit_log_project_idx on public.admin_audit_log (project_id);
create index if not exists admin_audit_log_actor_idx   on public.admin_audit_log (actor_id);

alter table public.admin_audit_log enable row level security;
drop policy if exists audit_log_super_read on public.admin_audit_log;
create policy audit_log_super_read on public.admin_audit_log for select using (public.is_super());
drop policy if exists audit_log_insert_any on public.admin_audit_log;
create policy audit_log_insert_any on public.admin_audit_log for insert
  with check (actor_id = auth.uid());

-- 2) Обобщённая функция логирования ------------------------------------
create or replace function public.audit_log(
  p_action text,
  p_table_name text,
  p_record_id text,
  p_project_id bigint,
  p_details jsonb default '{}'::jsonb
) returns void language plpgsql security definer set search_path = public as
$$
begin
  insert into public.admin_audit_log (actor_id, action, table_name, record_id, project_id, details)
  values (auth.uid(), p_action, p_table_name, p_record_id, p_project_id, coalesce(p_details, '{}'::jsonb));
end $$;
revoke all on function public.audit_log(text, text, text, bigint, jsonb) from public;
grant execute on function public.audit_log(text, text, text, bigint, jsonb) to authenticated;

-- 3) Триггерные функции -----------------------------------------------

-- projects: id bigint
create or replace function public.audit_projects()
returns trigger language plpgsql security definer set search_path = public as
$$
declare _rid text; _pid bigint; _action text;
begin
  if TG_OP = 'INSERT' then
    _rid := NEW.id::text; _pid := NEW.id; _action := 'project_create';
    perform public.audit_log(_action, 'projects', _rid, _pid,
      jsonb_build_object('after', to_jsonb(NEW)));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    _rid := NEW.id::text; _pid := NEW.id; _action := 'project_update';
    perform public.audit_log(_action, 'projects', _rid, _pid,
      jsonb_build_object('before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
    return NEW;
  else
    _rid := OLD.id::text; _pid := OLD.id; _action := 'project_delete';
    perform public.audit_log(_action, 'projects', _rid, _pid,
      jsonb_build_object('before', to_jsonb(OLD)));
    return OLD;
  end if;
end $$;

drop trigger if exists projects_audit on public.projects;
create trigger projects_audit
  after insert or update or delete on public.projects
  for each row execute function public.audit_projects();

-- settings: (project_id, key)
create or replace function public.audit_settings()
returns trigger language plpgsql security definer set search_path = public as
$$
declare _rid text; _pid bigint; _action text;
begin
  if TG_OP = 'INSERT' then
    _rid := NEW.project_id::text || ':' || NEW.key; _pid := NEW.project_id; _action := 'settings_set';
    perform public.audit_log(_action, 'settings', _rid, _pid,
      jsonb_build_object('key', NEW.key, 'value', NEW.value));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    _rid := NEW.project_id::text || ':' || NEW.key; _pid := NEW.project_id; _action := 'settings_set';
    perform public.audit_log(_action, 'settings', _rid, _pid,
      jsonb_build_object('key', NEW.key, 'before', OLD.value, 'after', NEW.value));
    return NEW;
  else
    _rid := OLD.project_id::text || ':' || OLD.key; _pid := OLD.project_id; _action := 'settings_delete';
    perform public.audit_log(_action, 'settings', _rid, _pid,
      jsonb_build_object('key', OLD.key, 'before', OLD.value));
    return OLD;
  end if;
end $$;

drop trigger if exists settings_audit on public.settings;
create trigger settings_audit
  after insert or update or delete on public.settings
  for each row execute function public.audit_settings();

-- news: id bigint
create or replace function public.audit_news()
returns trigger language plpgsql security definer set search_path = public as
$$
declare _rid text; _pid bigint; _action text;
begin
  if TG_OP = 'INSERT' then
    _rid := NEW.id::text; _pid := NEW.project_id; _action := 'news_create';
    perform public.audit_log(_action, 'news', _rid, _pid,
      jsonb_build_object('title', NEW.title, 'tag', NEW.tag));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    _rid := NEW.id::text; _pid := NEW.project_id; _action := 'news_update';
    perform public.audit_log(_action, 'news', _rid, _pid,
      jsonb_build_object('title', NEW.title, 'before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
    return NEW;
  else
    _rid := OLD.id::text; _pid := OLD.project_id; _action := 'news_delete';
    perform public.audit_log(_action, 'news', _rid, _pid,
      jsonb_build_object('title', OLD.title));
    return OLD;
  end if;
end $$;

drop trigger if exists news_audit on public.news;
create trigger news_audit
  after insert or update or delete on public.news
  for each row execute function public.audit_news();

-- bans: user_id uuid
create or replace function public.audit_bans()
returns trigger language plpgsql security definer set search_path = public as
$$
declare _rid text; _action text;
begin
  if TG_OP = 'INSERT' then
    _rid := NEW.user_id::text; _action := 'ban_create';
    perform public.audit_log(_action, 'bans', _rid, null,
      jsonb_build_object('user_id', NEW.user_id, 'reason', NEW.reason, 'banned_until', NEW.banned_until));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    _rid := NEW.user_id::text; _action := 'ban_update';
    perform public.audit_log(_action, 'bans', _rid, null,
      jsonb_build_object('user_id', NEW.user_id, 'before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
    return NEW;
  else
    _rid := OLD.user_id::text; _action := 'ban_delete';
    perform public.audit_log(_action, 'bans', _rid, null,
      jsonb_build_object('user_id', OLD.user_id, 'reason', OLD.reason));
    return OLD;
  end if;
end $$;

drop trigger if exists bans_audit on public.bans;
create trigger bans_audit
  after insert or update or delete on public.bans
  for each row execute function public.audit_bans();

-- project_members: (project_id, user_id)
create or replace function public.audit_members()
returns trigger language plpgsql security definer set search_path = public as
$$
declare _rid text; _pid bigint; _action text;
begin
  if TG_OP = 'INSERT' then
    _rid := NEW.project_id::text || ':' || NEW.user_id::text; _pid := NEW.project_id; _action := 'member_add';
    perform public.audit_log(_action, 'project_members', _rid, _pid,
      jsonb_build_object('user_id', NEW.user_id, 'role', NEW.role, 'email', NEW.email));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    _rid := NEW.project_id::text || ':' || NEW.user_id::text; _pid := NEW.project_id; _action := 'member_update';
    perform public.audit_log(_action, 'project_members', _rid, _pid,
      jsonb_build_object('user_id', NEW.user_id, 'role', NEW.role, 'before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
    return NEW;
  else
    _rid := OLD.project_id::text || ':' || OLD.user_id::text; _pid := OLD.project_id; _action := 'member_remove';
    perform public.audit_log(_action, 'project_members', _rid, _pid,
      jsonb_build_object('user_id', OLD.user_id, 'role', OLD.role));
    return OLD;
  end if;
end $$;

drop trigger if exists members_audit on public.project_members;
create trigger members_audit
  after insert or update or delete on public.project_members
  for each row execute function public.audit_members();

-- user_devices: id uuid
create or replace function public.audit_devices()
returns trigger language plpgsql security definer set search_path = public as
$$
declare _rid text; _action text;
begin
  if TG_OP = 'INSERT' then
    _rid := NEW.id::text; _action := 'device_add';
    perform public.audit_log(_action, 'user_devices', _rid, null,
      jsonb_build_object('user_id', NEW.user_id, 'device_name', NEW.device_name, 'platform', NEW.platform));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    _rid := NEW.id::text; _action := 'device_update';
    perform public.audit_log(_action, 'user_devices', _rid, null,
      jsonb_build_object('user_id', NEW.user_id, 'before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
    return NEW;
  else
    _rid := OLD.id::text; _action := 'device_remove';
    perform public.audit_log(_action, 'user_devices', _rid, null,
      jsonb_build_object('user_id', OLD.user_id, 'device_name', OLD.device_name));
    return OLD;
  end if;
end $$;

drop trigger if exists devices_audit on public.user_devices;
create trigger devices_audit
  after insert or update or delete on public.user_devices
  for each row execute function public.audit_devices();

-- admins: user_id uuid
create or replace function public.audit_admins()
returns trigger language plpgsql security definer set search_path = public as
$$
declare _rid text; _action text;
begin
  if TG_OP = 'INSERT' then
    _rid := NEW.user_id::text; _action := 'admin_grant';
    perform public.audit_log(_action, 'admins', _rid, null,
      jsonb_build_object('user_id', NEW.user_id));
    return NEW;
  elsif TG_OP = 'UPDATE' then
    _rid := NEW.user_id::text; _action := 'admin_update';
    perform public.audit_log(_action, 'admins', _rid, null,
      jsonb_build_object('user_id', NEW.user_id, 'before', to_jsonb(OLD), 'after', to_jsonb(NEW)));
    return NEW;
  else
    _rid := OLD.user_id::text; _action := 'admin_revoke';
    perform public.audit_log(_action, 'admins', _rid, null,
      jsonb_build_object('user_id', OLD.user_id));
    return OLD;
  end if;
end $$;

drop trigger if exists admins_audit on public.admins;
create trigger admins_audit
  after insert or update or delete on public.admins
  for each row execute function public.audit_admins();
