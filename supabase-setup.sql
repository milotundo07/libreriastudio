-- Biblioteca dello Studio 1.1.0
-- Eseguire una sola volta nel Supabase SQL Editor.

create extension if not exists pgcrypto;

create table if not exists public.library_books (
  id uuid not null default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  internal_code text not null,
  cover_path text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (user_id, id)
);

alter table public.library_books
  add column if not exists internal_code text;

update public.library_books
set internal_code = coalesce(
  nullif(data ->> 'internal_code', ''),
  'BIB-' || upper(substr(replace(id::text, '-', ''), 1, 12))
)
where internal_code is null or internal_code = '';

alter table public.library_books
  alter column internal_code set not null;

create unique index if not exists library_books_user_id_idx
  on public.library_books (user_id, id);

create index if not exists library_books_user_updated_idx
  on public.library_books (user_id, updated_at desc);
create index if not exists library_books_user_deleted_idx
  on public.library_books (user_id, deleted_at)
  where deleted_at is not null;
create unique index if not exists library_books_user_code_active_idx
  on public.library_books (user_id, internal_code)
  where deleted_at is null;

alter table public.library_books enable row level security;

drop policy if exists "library_books_select_own" on public.library_books;
create policy "library_books_select_own"
  on public.library_books for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "library_books_insert_own" on public.library_books;
create policy "library_books_insert_own"
  on public.library_books for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "library_books_update_own" on public.library_books;
create policy "library_books_update_own"
  on public.library_books for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "library_books_delete_own" on public.library_books;
create policy "library_books_delete_own"
  on public.library_books for delete
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.library_books from anon;
grant select, insert, update, delete on public.library_books to authenticated;
grant all on public.library_books to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'library-covers',
  'library-covers',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "library_covers_select_own" on storage.objects;
create policy "library_covers_select_own"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'library-covers'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "library_covers_insert_own" on storage.objects;
create policy "library_covers_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'library-covers'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "library_covers_update_own" on storage.objects;
create policy "library_covers_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'library-covers'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  )
  with check (
    bucket_id = 'library-covers'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

drop policy if exists "library_covers_delete_own" on storage.objects;
create policy "library_covers_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'library-covers'
    and (storage.foldername(name))[1] = (select auth.uid()::text)
  );

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'library_books'
  ) then
    alter publication supabase_realtime add table public.library_books;
  end if;
end $$;
