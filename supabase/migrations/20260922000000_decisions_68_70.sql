-- Decisions 68-70: human-readable pre-press identity, employee submitted
-- read-only state support, and non-retroactive configurable intake due dates.
--
-- Existing books are deliberately NOT backfilled. Their new operational fields
-- remain null so changing the default never mutates historical due dates.

alter table public.books
  add column if not exists book_author_name text,
  add column if not exists employee_intake_due_date date,
  add column if not exists employee_intake_due_date_source text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'books_employee_intake_due_date_source_allowed'
      and conrelid = 'public.books'::regclass
  ) then
    alter table public.books
      add constraint books_employee_intake_due_date_source_allowed
      check (
        employee_intake_due_date_source is null
        or employee_intake_due_date_source in ('default', 'override')
      );
  end if;
end
$$;

comment on column public.books.book_author_name is
  'Decision 68 operational Book Author entered by the privileged creator; distinct from authoritative KDP primary_author_name.';
comment on column public.books.employee_intake_due_date is
  'Decision 70 resolved Stage 1 due date. Stored per book and never recalculated retroactively.';
comment on column public.books.employee_intake_due_date_source is
  'Whether the resolved Stage 1 due date came from the configured default or a per-book override.';

update public.workflow_settings
set setting_value = jsonb_set(
      coalesce(setting_value, '{}'::jsonb),
      '{employee_intake_turnaround}',
      coalesce(
        setting_value->'employee_intake_turnaround',
        '{"value":7,"unit":"calendar_days"}'::jsonb
      ),
      true
    ),
    updated_at = now()
where setting_key = 'kdp_workflow_defaults'
  and is_active = true;

create or replace function public.create_privileged_kdp_book(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_employee_basecamp_person_id text,
  p_employee_name text,
  p_reviewer_user_id uuid,
  p_token_hash text,
  p_token_prefix text,
  p_book_author_name text,
  p_employee_intake_due_date date,
  p_employee_intake_due_date_source text,
  p_source text default 'privileged_create_book'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_book_id uuid;
  v_author text := btrim(coalesce(p_book_author_name, ''));
begin
  if v_author = '' or length(v_author) > 300 then
    raise exception 'Book Author is required and must be 300 characters or fewer.';
  end if;

  if p_employee_intake_due_date is null then
    raise exception 'Employee intake due date is required.';
  end if;

  if p_employee_intake_due_date < current_date then
    raise exception 'Employee intake due date cannot be in the past.';
  end if;

  if p_employee_intake_due_date_source not in ('default', 'override') then
    raise exception 'Employee intake due date source is invalid.';
  end if;

  v_result := public.create_privileged_kdp_book(
    p_actor_user_id,
    p_connection_id,
    p_employee_basecamp_person_id,
    p_employee_name,
    p_reviewer_user_id,
    p_token_hash,
    p_token_prefix,
    p_source
  );

  v_book_id := nullif(v_result->'book'->>'id', '')::uuid;
  if v_book_id is null then
    raise exception 'Canonical book creation did not return a book.';
  end if;

  update public.books
  set book_author_name = v_author,
      employee_intake_due_date = p_employee_intake_due_date,
      employee_intake_due_date_source = p_employee_intake_due_date_source,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'book_author_source', 'privileged_create_book',
        'employee_intake_due_date_source', p_employee_intake_due_date_source
      ),
      updated_at = now()
  where id = v_book_id;

  update public.book_status_history
  set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'book_author_name', v_author,
        'employee_intake_due_date', p_employee_intake_due_date,
        'employee_intake_due_date_source', p_employee_intake_due_date_source
      )
  where book_id = v_book_id
    and action = 'book_created';

  return jsonb_set(
    jsonb_set(
      jsonb_set(v_result, '{book,author}', to_jsonb(v_author), true),
      '{book,dueDate}', to_jsonb(p_employee_intake_due_date::text), true
    ),
    '{book,dueDateSource}', to_jsonb(p_employee_intake_due_date_source), true
  );
end;
$$;

revoke all on function public.create_privileged_kdp_book(
  uuid,uuid,text,text,uuid,text,text,text,date,text,text
) from public,anon,authenticated;
grant execute on function public.create_privileged_kdp_book(
  uuid,uuid,text,text,uuid,text,text,text,date,text,text
) to service_role;
