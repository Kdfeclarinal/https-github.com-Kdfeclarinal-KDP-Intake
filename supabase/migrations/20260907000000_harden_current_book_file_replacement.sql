-- Local-only migration. Do not apply without reviewing live duplicate/null data.
-- Standardizes current-file semantics on is_latest = true and makes replacement
-- promotion transactional and concurrency-safe for the service-role Edge Function.
-- Deployment gate: pause Content replacement uploads, apply this migration,
-- immediately deploy the RPC-compatible upload function, verify replacement,
-- and only then resume uploads. The legacy insert-current-first function is not
-- compatible with the unique-current-file index created below.

do $$
begin
  if exists (
    select 1
    from public.book_files
    where is_latest is distinct from false
    group by book_id, file_type, section_key
    having count(*) > 1
  ) then
    raise exception 'book_files contains duplicate current rows; resolve them before applying this migration';
  end if;
end;
$$;

update public.book_files
set is_latest = true
where is_latest is null;

alter table public.book_files
  alter column is_latest set default true,
  alter column is_latest set not null;

create unique index if not exists book_files_one_current_per_content_slot
  on public.book_files (
    book_id,
    coalesce(file_type, ''),
    coalesce(section_key, '')
  )
  where is_latest = true;

create or replace function public.promote_replacement_book_file(
  p_book_id uuid,
  p_file_type text,
  p_section_key text,
  p_old_file_id uuid,
  p_new_file_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old_file_id uuid;
  v_new_file_id uuid;
begin
  select id
  into v_old_file_id
  from public.book_files
  where id = p_old_file_id
    and book_id = p_book_id
    and file_type = p_file_type
    and section_key = p_section_key
    and is_latest = true
  for update;

  if v_old_file_id is null then
    return false;
  end if;

  select id
  into v_new_file_id
  from public.book_files
  where id = p_new_file_id
    and book_id = p_book_id
    and file_type = p_file_type
    and section_key = p_section_key
    and is_latest = false
  for update;

  if v_new_file_id is null then
    return false;
  end if;

  update public.book_files
  set is_latest = false,
      replaced_by_file_id = p_new_file_id
  where id = p_old_file_id;

  update public.book_files
  set is_latest = true
  where id = p_new_file_id;

  return true;
end;
$$;

revoke all on function public.promote_replacement_book_file(uuid, text, text, uuid, uuid) from public;
revoke all on function public.promote_replacement_book_file(uuid, text, text, uuid, uuid) from anon;
revoke all on function public.promote_replacement_book_file(uuid, text, text, uuid, uuid) from authenticated;
grant execute on function public.promote_replacement_book_file(uuid, text, text, uuid, uuid) to service_role;
