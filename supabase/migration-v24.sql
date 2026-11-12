-- ============================================================================
--  SAMOT Launcher — Migration v24: featured_slides (официальные постеры в карусели)
--  Используется, чтобы вперемешку с обложками игр показывали постеры-события
--  («Запуск v1.0.0», «SAMOT Summer Sale» и т.п.). content = рекламный слайд.
-- ============================================================================

create table if not exists public.featured_slides (
  id          bigint generated always as identity primary key,
  title       text not null,
  tagline     text default '',
  image_url   text not null,
  cta_label   text default 'Смотреть',
  cta_url     text default '',
  sort        int  not null default 0,
  published   boolean not null default true,
  expires_at  timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists featured_slides_pub_idx on public.featured_slides (published, sort) where published = true;

alter table public.featured_slides enable row level security;
drop policy if exists fslide_read on public.featured_slides;
create policy fslide_read on public.featured_slides for select using (published = true);
drop policy if exists fslide_super_all on public.featured_slides;
create policy fslide_super_all on public.featured_slides for all
  using (public.is_super()) with check (public.is_super());

grant select on public.featured_slides to anon, authenticated;

create or replace function public.list_featured_slides()
returns setof public.featured_slides language sql stable
security definer set search_path = public as
$$
  select *
  from public.featured_slides
  where published = true and (expires_at is null or expires_at > now())
  order by sort asc, id asc
  limit 20;
$$;
revoke all on function public.list_featured_slides() from public;
grant execute on function public.list_featured_slides() to anon, authenticated;

create or replace function public.list_featured_admin()
returns setof public.featured_slides language plpgsql stable
security definer set search_path = public as
$$
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  return query
  select * from public.featured_slides order by sort asc, id desc;
end $$;
revoke all on function public.list_featured_admin() from public;
grant execute on function public.list_featured_admin() to authenticated;

create or replace function public.upsert_featured(
  p_id bigint,
  p_title text,
  p_tagline text,
  p_image_url text,
  p_cta_label text,
  p_cta_url text,
  p_sort int,
  p_published boolean,
  p_expires_at timestamptz
) returns bigint language plpgsql security definer set search_path = public as
$$
declare v_id bigint;
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  insert into public.featured_slides (id, title, tagline, image_url, cta_label, cta_url, sort, published, expires_at, created_by)
  values (p_id, p_title, coalesce(p_tagline, ''), coalesce(p_image_url, ''), coalesce(p_cta_label, 'Смотреть'),
          coalesce(p_cta_url, ''), coalesce(p_sort, 0), coalesce(p_published, true), p_expires_at, auth.uid())
  on conflict (id) do update set
    title = excluded.title, tagline = excluded.tagline, image_url = excluded.image_url,
    cta_label = excluded.cta_label, cta_url = excluded.cta_url,
    sort = excluded.sort, published = excluded.published, expires_at = excluded.expires_at
  returning id into v_id;
  perform public.audit_log('featured_upsert', 'featured_slides', v_id::text, null,
    jsonb_build_object('title', p_title, 'published', p_published));
  return v_id;
end $$;
revoke all on function public.upsert_featured(bigint, text, text, text, text, text, int, boolean, timestamptz) from public;
grant execute on function public.upsert_featured(bigint, text, text, text, text, text, int, boolean, timestamptz) to authenticated;

create or replace function public.delete_featured(p_id bigint)
returns void language plpgsql security definer set search_path = public as
$$
begin
  if not public.is_super() then raise exception 'Only super admin'; end if;
  delete from public.featured_slides where id = p_id;
  perform public.audit_log('featured_delete', 'featured_slides', p_id::text, null, jsonb_build_object('id', p_id));
end $$;
revoke all on function public.delete_featured(bigint) from public;
grant execute on function public.delete_featured(bigint) to authenticated;
