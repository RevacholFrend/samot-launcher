-- ============================================================
--  SAMOT Game Launcher — схема БД v2 (мультипроектность)
--  Вставьте ТОЛЬКО в SQL Editor свежего проекта.
--  Для существующей (v1) используйте migration-v2.sql.
-- ============================================================

-- 1) ПРОЕКТЫ ---------------------------------------------------
create table if not exists public.projects (
  id           bigint generated always as identity primary key,
  name         text not null,
  slug         text not null unique,
  tagline      text default '',
  logo         text default '🎮',        -- эмодзи или URL картинки (если с http)
  color        text default '#7c5cff',   -- акцент проекта для кнопок / баннеров
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);

-- Участники проекта (разработчики): owner / editor
create table if not exists public.project_members (
  project_id bigint not null references public.projects(id) on delete cascade,
  user_id    uuid   not null references auth.users(id)     on delete cascade,
  role       text   not null default 'owner' check (role in ('owner', 'editor')),
  email      text   not null default '',
  created_at timestamptz not null default now(),
  primary key (project_id, user_id)
);

-- 2) ТАБЛИЦЫ КОНТЕНТА ------------------------------------------
create table if not exists public.news (
  id           bigint generated always as identity primary key,
  project_id   bigint not null references public.projects(id) on delete cascade,
  title        text not null,
  tag          text not null default 'Анонс',
  excerpt      text default '',
  body         text default '',
  image_url    text default '',
  active       boolean not null default true,
  published_at timestamptz not null default now()
);

create table if not exists public.settings (
  project_id bigint not null references public.projects(id) on delete cascade,
  key        text not null,
  value      text default '',
  updated_at timestamptz not null default now(),
  primary key (project_id, key)
);

-- Глобальные супер-админы (управляют всеми проектами)
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- 3) ПОМОЩНИКИ -------------------------------------------------
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

-- Поиск пользователя по email для приглашения в проект (только авторизованные, id+email)
create or replace function public.find_user_by_email(email text)
returns table(user_id uuid, email text)
language sql security definer stable set search_path = public as
$$ select id, email from auth.users where lower(auth.users.email) = lower(find_user_by_email.email) limit 1 $$;
revoke all on function public.find_user_by_email(text) from public;
grant execute on function public.find_user_by_email(text) to authenticated;

-- 4) RLS ---------------------------------------------------------
alter table public.projects        enable row level security;
alter table public.project_members enable row level security;
alter table public.news            enable row level security;
alter table public.settings        enable row level security;
alter table public.admins          enable row level security;

-- projects: видят все; создать может любой авторизованный (становится владельцем-участником через триггер)
drop policy if exists projects_read_all on public.projects;
create policy projects_read_all on public.projects for select using (true);
drop policy if exists projects_insert_auth on public.projects;
create policy projects_insert_auth on public.projects for insert with check (auth.uid() = created_by);
drop policy if exists projects_update_owner on public.projects;
create policy projects_update_owner on public.projects for update using (public.is_owner(id)) with check (public.is_owner(id));
drop policy if exists projects_delete_owner on public.projects;
create policy projects_delete_owner on public.projects for delete using (public.is_owner(id));

-- при создании проекта автор автоматически становится его owner'ом-участником
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

-- project_members: участник читает участников своего проекта; управляет владелец
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

-- news: видят все активные свои (любой активный); полный доступ — участники/супер
drop policy if exists news_public_read on public.news;
create policy news_public_read on public.news for select
  using (active = true or public.is_member(project_id));
drop policy if exists news_member_insert on public.news;
create policy news_member_insert on public.news for insert
  with check (public.is_member(project_id));
drop policy if exists news_member_update on public.news;
create policy news_member_update on public.news for update
  using (public.is_member(project_id)) with check (public.is_member(project_id));
drop policy if exists news_member_delete on public.news;
create policy news_member_delete on public.news for delete
  using (public.is_member(project_id));

-- settings: читают все; пишут участники/супер
drop policy if exists settings_public_read on public.settings;
create policy settings_public_read on public.settings for select using (true);
drop policy if exists settings_member_write on public.settings;
create policy settings_member_write on public.settings for insert
  with check (public.is_member(project_id));
create policy settings_member_update on public.settings for update
  using (public.is_member(project_id)) with check (public.is_member(project_id));
create policy settings_member_delete on public.settings for delete
  using (public.is_member(project_id));

-- admins: само-чтение
drop policy if exists admins_self_read on public.admins;
create policy admins_self_read on public.admins for select using (auth.uid() = user_id);

-- 5) STORAGE -----------------------------------------------------
insert into storage.buckets (id, name, public) values ('news', 'news', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('game', 'game', true) on conflict (id) do nothing;

drop policy if exists bucket_public_read on storage.objects;
create policy bucket_public_read on storage.objects for select using (bucket_id in ('news','game'));
drop policy if exists bucket_member_insert on storage.objects;
create policy bucket_member_insert on storage.objects for insert
  with check (bucket_id in ('news','game') and exists (select 1 from public.project_members where user_id = auth.uid()) or public.is_super());
drop policy if exists bucket_member_update on storage.objects;
create policy bucket_member_update on storage.objects for update
  using (bucket_id in ('news','game') and exists (select 1 from public.project_members where user_id = auth.uid()) or public.is_super());
drop policy if exists bucket_member_delete on storage.objects;
create policy bucket_member_delete on storage.objects for delete
  using (bucket_id in ('news','game') and exists (select 1 from public.project_members where user_id = auth.uid()) or public.is_super());

-- 6) ПРАВА РОЛЕЙ (новые проекты требуют явных грантов) -----------
grant usage on schema public to anon, authenticated;
grant select on public.projects, public.project_members, public.news, public.settings to anon, authenticated;
grant insert, update, delete on public.projects to authenticated;
grant insert, update, delete on public.project_members to authenticated;
grant insert, update, delete on public.news to authenticated;
grant insert, update, delete on public.settings to authenticated;
grant select on public.admins to authenticated;
grant usage on all sequences in schema public to authenticated;

-- 7) ДЕМО-ДАННЫЕ (удалите из админки) ------------------------------
insert into public.projects (name, slug, tagline, logo, color, created_by)
  select 'SAMOT Game', 'samot-game', 'Твой мир. Твоя игра.', '🎮', '#7c5cff', id from auth.users limit 1
  on conflict (slug) do nothing;

insert into public.news (project_id, title, tag, excerpt, body, image_url)
  select p.id, t.title, t.tag, t.excerpt, t.body, t.image_url
  from public.projects p cross join (values
    ('Запуск закрытой беты', 'Анонс', 'Первым игрокам откроется доступ к бете 15 ноября.',
     'Друзья! Мы рады сообщить, что закрытая бета начнётся 15 ноября. Успейте освободить вечер и расслабиться в мире игры.',
     'https://images.unsplash.com/photo-1542751371-adc38448a05e?w=1600&q=80'),
    ('Патч 0.9.4', 'Патчнот', 'Исправили краш при заходе в рейд и ускорили загрузку.',
     'Изменения: исправлен краш клиента; ускорена загрузка локаций на ~30%; таблицы лидеров обновляются мгновенно.',
     'https://images.unsplash.com/photo-1552820728-8b83bb6b773f?w=1600&q=80'),
    ('Турнир к запуску', 'Турнир', 'Призовой фонд 50 000 ₽. Регистрация открыта.',
     'Еженедельный турнир начнётся 22 ноября. Формат: 5×5, single elimination. Приз — 50 000 ₽ и эксклюзивный скин.',
     'https://images.unsplash.com/photo-1538481199705-c710c4e965fc?w=1600&q=80')
  ) as t(title, tag, excerpt, body, image_url)
  where p.slug = 'samot-game'
    and not exists (select 1 from public.news n where n.project_id = p.id);
