-- ============================================================
--  Xuita Launcher — миграция v1 → v2 (мультипроектность)
--  Выполните целиком в SQL Editor. Идемпотентно (можно перезапустить).
--  Существующие новости и настройки ТОЛЬКО перекрываются, ничего не удаляется.
-- ============================================================

-- 1) новые таблицы -------------------------------------------
create table if not exists public.projects (
  id           bigint generated always as identity primary key,
  name         text not null,
  slug         text not null unique,
  tagline      text default '',
  logo         text default '🎮',
  color        text default '#7c5cff',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

create table if not exists public.project_members (
  project_id bigint not null references public.projects(id) on delete cascade,
  user_id    uuid   not null references auth.users(id)     on delete cascade,
  role       text   not null default 'owner' check (role in ('owner', 'editor')),
  email      text   not null default '',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- 2) проект «по умолчанию» из текущих настроек ------------------
insert into public.projects (name, slug, tagline, logo, color, created_by)
select
  coalesce((select value from public.settings where key = 'game_name'), 'Xuita game'),
  'xuita-game',
  'Твой мир. Твоя игра.',
  '🎮',
  '#7c5cff',
  (select id from auth.users order by created_at asc limit 1)   -- первый пользователь (вы)
on conflict (slug) do nothing;

-- владелец проекта по умолчанию = тот же, кто создал
insert into public.project_members (project_id, user_id, role)
select p.id, p.created_by, 'owner' from public.projects p
where p.slug = 'xuita-game' and p.created_by is not null
on conflict do nothing;

-- v1-таблица admins → добавляем владельца и в участники (на всякий случай)
insert into public.project_members (project_id, user_id, role)
select p.id, a.user_id, 'owner' from public.projects p join public.admins a on true
where p.slug = 'xuita-game'
on conflict do nothing;

-- backfill emails для участников по умолчанию\nupdate public.project_members pm set email = u.email from auth.users u where pm.user_id = u.id and pm.email = '';\n\n-- 3) колонка project_id (сначала без NOT NULL, заполним потом) --
alter table public.news     add column if not exists project_id bigint references public.projects(id) on delete cascade;
alter table public.settings add column if not exists project_id bigint references public.projects(id) on delete cascade;

update public.news     n set project_id = (select id from public.projects where slug = 'xuita-game') where n.project_id is null;
update public.settings n set project_id = (select id from public.projects where slug = 'xuita-game') where n.project_id is null;

alter table public.news     alter column project_id set not null;
alter table public.settings alter column project_id set not null;

-- settings: PK меняем с key → (project_id, key)
alter table public.settings drop constraint if exists settings_pkey;
create unique index if not exists settings_project_key on public.settings (project_id, key);

-- 4) функции-помощники ------------------------------------------
create or replace function public.is_super()
returns boolean language sql security definer stable set search_path = public as
$$ select exists(select 1 from public.admins where user_id = auth.uid()) $$;

create or replace function public.is_member(pid bigint)
returns boolean language sql security definer stable set search_path = public as
$$ select exists(select 1 from public.project_members where project_id = pid and user_id = auth.uid())
   or public.is_super() $$;

create or replace function public.is_owner(pid bigint)
returns boolean language sql security definer stable set search_path = public as
$$ select exists(select 1 from public.project_members where project_id = pid and user_id = auth.uid() and role = 'owner')
   or public.is_super() $$;

create or replace function public.find_user_by_email(email text)
returns table(user_id uuid, email text)
language sql security definer stable set search_path = public as
$$ select id, email from auth.users where lower(auth.users.email) = lower(find_user_by_email.email) limit 1 $$;
revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

create or replace function public.handle_new_project()
returns trigger language plpgsql security definer set search_path = public as
$$ begin
  insert into public.project_members (project_id, user_id, role, email) select new.id, new.created_by, 'owner', email from auth.users where id = new.created_by
  on conflict do nothing;
  insert into public.settings (project_id, key, value) values
    (new.id, 'game_name', new.name),
    (new.id, 'game_version', '0.1.0'),
    (new.id, 'download_url', ''),
    (new.id, 'update_notes', ''),
    (new.id, 'server_online', 'true'),
    (new.id, 'server_status', 'Все серверы в норме'),
    (new.id, 'maintenance', 'false'),
    (new.id, 'min_launcher_version', '1.0.0')
  on conflict (project_id, key) do nothing;
  return new;
end $$;
drop trigger if exists on_project_created on public.projects;
create trigger on_project_created after insert on public.projects
  for each row execute function public.handle_new_project();

-- 5) RLS ----------------------------------------------------------
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.news            enable row level security;
alter table public.settings        enable row level security;
alter table public.admins          enable row level security;

drop policy if exists projects_read_all on public.projects;
create policy projects_read_all on public.projects for select using (true);
drop policy if exists projects_insert_auth on public.projects;
create policy projects_insert_auth on public.projects for insert with check (auth.uid() = created_by);
drop policy if exists projects_update_owner on public.projects;
create policy projects_update_owner on public.projects for update using (public.is_owner(id)) with check (public.is_owner(id));
drop policy if exists projects_delete_owner on public.projects;
create policy projects_delete_owner on public.projects for delete using (public.is_owner(id));

drop policy if exists members_read_same_project on public.project_members;
create policy members_read_same_project on public.project_members for select
  using (user_id = auth.uid() or public.is_member(project_id));
drop policy if exists members_insert_owner on public.project_members;
create policy members_insert_owner on public.project_members for insert
  with check (public.is_owner(project_id) or user_id = auth.uid());
drop policy if exists members_delete_owner on public.project_members;
create policy members_delete_owner on public.project_members for delete
  using (public.is_owner(project_id));
drop policy if exists members_update_owner on public.project_members;
create policy members_update_owner on public.project_members for update
  using (public.is_owner(project_id));

-- news: старые политики — вон
drop policy if exists news_public_read   on public.news;
drop policy if exists news_admin_insert  on public.news;
drop policy if exists news_admin_update  on public.news;
drop policy if exists news_admin_delete  on public.news;
create policy news_public_read on public.news for select
  using (active = true or public.is_member(project_id));
create policy news_member_insert on public.news for insert
  with check (public.is_member(project_id));
create policy news_member_update on public.news for update
  using (public.is_member(project_id)) with check (public.is_member(project_id));
create policy news_member_delete on public.news for delete
  using (public.is_member(project_id));

-- settings: старые политики — вон
drop policy if exists settings_public_read on public.settings;
drop policy if exists settings_admin_write on public.settings;
create policy settings_public_read on public.settings for select using (true);
create policy settings_member_write on public.settings for insert
  with check (public.is_member(project_id));
create policy settings_member_update on public.settings for update
  using (public.is_member(project_id)) with check (public.is_member(project_id));
create policy settings_member_delete on public.settings for delete
  using (public.is_member(project_id));

drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select using (auth.uid() = user_id);

-- storage: старые политики — вон (v1 имена)
drop policy if exists news_bucket_read         on storage.objects;
drop policy if exists news_bucket_admin_insert on storage.objects;
drop policy if exists news_bucket_admin_update on storage.objects;
drop policy if exists news_bucket_admin_delete on storage.objects;
drop policy if exists bucket_public_read       on storage.objects;
create policy bucket_public_read on storage.objects for select using (bucket_id in ('news','game'));
drop policy if exists bucket_member_insert on storage.objects;
create policy bucket_member_insert on storage.objects for insert
  with check (bucket_id in ('news','game') and (exists (select 1 from public.project_members where user_id = auth.uid()) or public.is_super()));
drop policy if exists bucket_member_update on storage.objects;
create policy bucket_member_update on storage.objects for update
  using (bucket_id in ('news','game') and (exists (select 1 from public.project_members where user_id = auth.uid()) or public.is_super()));
drop policy if exists bucket_member_delete on storage.objects;
create policy bucket_member_delete on storage.objects for delete
  using (bucket_id in ('news','game') and (exists (select 1 from public.project_members where user_id = auth.uid()) or public.is_super()));

-- 6) гранты --------------------------------------------------------
grant usage on schema public to anon, authenticated;
grant select on public.projects, public.project_members, public.news, public.settings to anon, authenticated;
grant insert, update, delete on public.projects to authenticated;
grant insert, update, delete on public.project_members to authenticated;
grant insert, update, delete on public.news to authenticated;
grant insert, update, delete on public.settings to authenticated;
grant select on public.admins to authenticated;
grant usage on all sequences in schema public to authenticated;

-- 7) проверка — выполнить отдельной строкой:
--   select p.id, p.name, p.slug, (select count(*) from public.news n where n.project_id = p.id) as news,
--          (select value from public.settings s where s.project_id = p.id and s.key = 'game_name') as game_name
--   from public.projects p;
