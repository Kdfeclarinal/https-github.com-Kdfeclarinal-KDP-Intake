-- Server-only Basecamp credential vault, reviewer identity mapping, and the
-- transactional employee submission cutover. This remains a Stage A migration:
-- legacy status labels stay valid for writers not involved in submission.

create or replace function public.store_basecamp_token_bundle(
  p_access_token text,
  p_refresh_token text,
  p_expires_at timestamptz,
  p_credential_reference text default null
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_secret text;
begin
  if coalesce(p_access_token, '') = '' or coalesce(p_refresh_token, '') = '' or p_expires_at is null then
    raise exception 'A complete Basecamp token bundle is required.';
  end if;
  v_secret := jsonb_build_object(
    'access_token', p_access_token,
    'refresh_token', p_refresh_token,
    'expires_at', p_expires_at
  )::text;

  if nullif(btrim(p_credential_reference), '') is null then
    v_id := vault.create_secret(v_secret, 'kdp-basecamp-' || gen_random_uuid()::text, 'KDP Intake Basecamp OAuth credential');
  else
    begin
      v_id := p_credential_reference::uuid;
    exception when invalid_text_representation then
      raise exception 'Basecamp credential reference is invalid.';
    end;
    if not exists (select 1 from vault.secrets where id = v_id) then
      raise exception 'Basecamp credential reference does not exist.';
    end if;
    perform vault.update_secret(v_id, v_secret, null, null);
  end if;
  return v_id::text;
end;
$$;

create or replace function public.read_basecamp_token_bundle(p_credential_reference text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_value text;
begin
  select decrypted_secret into v_value
  from vault.decrypted_secrets
  where id = p_credential_reference::uuid;
  if v_value is null then raise exception 'Basecamp credential is unavailable.'; end if;
  return v_value::jsonb;
exception when invalid_text_representation then
  raise exception 'Basecamp credential is unavailable.';
end;
$$;

create or replace function public.delete_basecamp_token_bundle(p_credential_reference text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from vault.secrets where id = p_credential_reference::uuid;
  get diagnostics v_count = row_count;
  return v_count = 1;
exception when invalid_text_representation then
  return false;
end;
$$;

revoke all on function public.store_basecamp_token_bundle(text, text, timestamptz, text) from public, anon, authenticated;
revoke all on function public.read_basecamp_token_bundle(text) from public, anon, authenticated;
revoke all on function public.delete_basecamp_token_bundle(text) from public, anon, authenticated;
grant execute on function public.store_basecamp_token_bundle(text, text, timestamptz, text) to service_role;
grant execute on function public.read_basecamp_token_bundle(text) to service_role;
grant execute on function public.delete_basecamp_token_bundle(text) to service_role;

create table public.privileged_user_basecamp_mappings (
  privileged_user_id uuid primary key references public.privileged_users(id) on delete restrict,
  connection_id uuid not null references public.basecamp_connections(id) on delete restrict,
  account_id text not null,
  project_id text not null,
  basecamp_person_id text not null,
  display_name_snapshot text,
  email_snapshot text,
  mapped_by_privileged_user_id uuid not null references public.privileged_users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (connection_id, basecamp_person_id)
);
alter table public.privileged_user_basecamp_mappings enable row level security;
revoke all on table public.privileged_user_basecamp_mappings from public, anon, authenticated;
grant all on table public.privileged_user_basecamp_mappings to service_role;

alter table public.basecamp_references
  add column if not exists source_todo_completed_at timestamptz;
create unique index if not exists basecamp_references_one_review_round
  on public.basecamp_references(review_round_id)
  where reference_kind = 'review_round';

create or replace function public.prevent_submitted_review_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_table_name = 'book_review_rounds' and (
    new.submission_snapshot is distinct from old.submission_snapshot
    or new.submitted_at is distinct from old.submitted_at
    or new.submitted_by_actor_type is distinct from old.submitted_by_actor_type
    or new.submitted_by_email is distinct from old.submitted_by_email
    or new.submitted_by_name is distinct from old.submitted_by_name
  ) then raise exception 'Submitted review snapshots are immutable.'; end if;
  if tg_table_name = 'book_review_items' and (
    new.section_snapshot is distinct from old.section_snapshot
    or new.section_key is distinct from old.section_key
    or new.step_name is distinct from old.step_name
    or new.review_round_id is distinct from old.review_round_id
    or new.book_id is distinct from old.book_id
  ) then raise exception 'Submitted review item snapshots are immutable.'; end if;
  return new;
end;
$$;

create trigger book_review_rounds_prevent_snapshot_mutation
before update on public.book_review_rounds
for each row execute function public.prevent_submitted_review_snapshot_mutation();
create trigger book_review_items_prevent_snapshot_mutation
before update on public.book_review_items
for each row execute function public.prevent_submitted_review_snapshot_mutation();

drop function if exists public.submit_kdp_book_for_approval(uuid, jsonb, text, text, text);
create or replace function public.submit_kdp_book_for_approval(
  p_book_id uuid,
  p_token_hash text,
  p_source text default 'employee_pricing_submit'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_book public.books%rowtype;
  v_token public.book_access_tokens%rowtype;
  v_round public.book_review_rounds%rowtype;
  v_reviewer_id uuid;
  v_assignment_source text;
  v_snapshot jsonb;
  v_round_number integer;
  v_item_count integer;
  v_book_ref public.basecamp_references%rowtype;
begin
  select * into v_book from public.books where id = p_book_id for update;
  if v_book.id is null or v_book.deleted_at is not null then raise exception 'Book not found.'; end if;

  select * into v_token from public.book_access_tokens
  where token_hash = p_token_hash
    and role::text = 'employee'
    and book_id = p_book_id
    and review_round_id is null
    and revoked_at is null
    and (expires_at is null or expires_at > now())
    and metadata->>'token_kind' = 'book_specific'
    and 'submit_for_approval' = any(allowed_actions)
    and 'pricing' = any(allowed_pages)
  for update;
  if v_token.id is null then raise exception 'Submission is not authorized.'; end if;

  if v_book.overall_status::text in ('for_approval', 'AWAITING_REVIEW') then
    select * into v_round from public.book_review_rounds
    where id = v_book.latest_review_round_id and book_id = p_book_id and status in ('submitted', 'in_review');
    if v_round.id is null then raise exception 'Submitted book has no active review round.'; end if;
    return jsonb_build_object('already_submitted', true, 'book_id', p_book_id,
      'review_round_id', v_round.id, 'round_number', v_round.round_number,
      'overall_status', v_book.overall_status, 'submitted_at', v_round.submitted_at,
      'review_item_count', (select count(*) from public.book_review_items where review_round_id = v_round.id));
  end if;

  if v_book.book_format::text <> 'kindle_ebook'
     or v_book.archived_at is not null
     or v_book.overall_status::text not in ('draft', 'EMPLOYEE_INTAKE') then
    raise exception 'This book is not currently available for submission.';
  end if;

  if exists (
    select 1 from unnest(array['details','content','pricing']) required(step_name)
    left join public.book_step_data step on step.book_id = p_book_id and step.step_name::text = required.step_name
    where step.id is null or step.is_complete is not true or step.validation_errors is distinct from '{}'::jsonb
  ) then raise exception 'Complete all required employee steps without validation errors.'; end if;

  if not exists (select 1 from public.book_files where book_id = p_book_id and file_type = 'manuscript' and is_latest = true)
     or (exists (select 1 from public.book_step_data where book_id = p_book_id and step_name::text = 'content'
          and extracted_fields->>'cover_option' = 'upload_cover_file')
       and not exists (select 1 from public.book_files where book_id = p_book_id and file_type = 'cover' and is_latest = true)) then
    raise exception 'Required current Content files are missing.';
  end if;

  if v_book.assigned_reviewer_user_id is not null and exists (
    select 1 from public.privileged_users u join public.privileged_user_capability_grants g
      on g.privileged_user_id = u.id and g.capability_key = 'can_review' and g.revoked_at is null
    where u.id = v_book.assigned_reviewer_user_id and u.disabled_at is null
  ) then v_reviewer_id := v_book.assigned_reviewer_user_id; v_assignment_source := 'override';
  else
    select d.reviewer_user_id into v_reviewer_id
    from public.review_assignment_defaults d
    join public.privileged_users u on u.id = d.reviewer_user_id and u.disabled_at is null
    join public.privileged_user_capability_grants g on g.privileged_user_id = u.id
      and g.capability_key = 'can_review' and g.revoked_at is null
    where d.scope_key = 'kindle_ebook';
    if v_reviewer_id is not null then v_assignment_source := 'default'; end if;
  end if;

  select jsonb_build_object(
    'schema_version', 1,
    'book', to_jsonb(v_book) - 'metadata',
    'steps', coalesce(jsonb_object_agg(s.step_name::text, jsonb_build_object(
      'state_json', s.state_json, 'extracted_fields', s.extracted_fields,
      'validation_required_keys', s.validation_required_keys, 'validation_errors', s.validation_errors,
      'saved_at', s.saved_at)), '{}'::jsonb),
    'files', coalesce((select jsonb_agg(jsonb_build_object(
      'id', f.id, 'file_type', f.file_type, 'section_key', f.section_key,
      'version_number', f.version_number, 'file_name', f.file_name, 'file_size_bytes', f.file_size_bytes,
      'mime_type', f.mime_type, 'reviewstudio_project_id', f.reviewstudio_project_id,
      'reviewstudio_review_id', f.reviewstudio_review_id, 'reviewstudio_file_id', f.reviewstudio_file_id
    ) order by f.file_type, f.id) from public.book_files f where f.book_id = p_book_id and f.is_latest = true), '[]'::jsonb)
  ) into v_snapshot
  from public.book_step_data s where s.book_id = p_book_id;

  select coalesce(max(round_number), 0) + 1 into v_round_number from public.book_review_rounds where book_id = p_book_id;
  insert into public.book_review_rounds (
    book_id, round_number, status, submitted_at, submitted_by_actor_type,
    submitted_by_email, submitted_by_name, reviewer_user_id, reviewer_assignment_source,
    reviewer_assigned_at, submission_snapshot, metadata
  ) values (
    p_book_id, v_round_number, 'submitted', now(), 'employee', v_token.employee_email,
    v_token.employee_name, v_reviewer_id, v_assignment_source,
    case when v_reviewer_id is null then null else now() end, v_snapshot,
    jsonb_build_object('source', p_source)
  ) returning * into v_round;

  insert into public.book_review_items (
    book_id, review_round_id, step_name, section_key, section_label, sort_order,
    is_file_section, is_reviewable, section_snapshot, metadata
  )
  select p_book_id, v_round.id, d.step_name, d.section_key, d.section_label, d.sort_order,
    d.is_file_section, d.is_reviewable,
    jsonb_build_object('submitted_step', s.state_json, 'submitted_extracted_fields', s.extracted_fields,
      'value', coalesce(s.state_json->'sections'->d.section_key, s.state_json->'sections'->split_part(d.section_key, '.', 2)),
      'file_references', coalesce((select jsonb_agg(jsonb_build_object('id', f.id, 'version_number', f.version_number,
        'reviewstudio_file_id', f.reviewstudio_file_id, 'reviewstudio_review_id', f.reviewstudio_review_id))
        from public.book_files f where f.book_id = p_book_id and f.is_latest = true and f.section_key = d.section_key), '[]'::jsonb)),
    jsonb_build_object('snapshot_schema_version', 1)
  from public.book_section_definitions d
  join public.book_step_data s on s.book_id = p_book_id and s.step_name = d.step_name
  where d.is_reviewable = true;
  get diagnostics v_item_count = row_count;
  if v_item_count = 0 then raise exception 'No reviewable section definitions are configured.'; end if;

  update public.books set overall_status = 'AWAITING_REVIEW', latest_review_round_id = v_round.id,
    assigned_reviewer_user_id = v_reviewer_id, reviewer_assignment_source = v_assignment_source,
    reviewer_assigned_at = case when v_reviewer_id is null then null else now() end,
    submitted_at = v_round.submitted_at, updated_at = now(), last_modified_at = now()
  where id = p_book_id;

  insert into public.book_status_history (book_id, review_round_id, action, actor_type, actor_name,
    actor_email, from_status, to_status, step_name, subject_privileged_user_id, note, metadata)
  values (p_book_id, v_round.id, 'submitted_for_approval', 'employee', v_token.employee_name,
    v_token.employee_email, v_book.overall_status, 'AWAITING_REVIEW', 'pricing', v_reviewer_id,
    'Employee intake submitted for approval.', jsonb_build_object('source', p_source, 'reviewer_assignment_source', v_assignment_source));

  select * into v_book_ref from public.basecamp_references
  where book_id = p_book_id and reference_kind = 'book_todo_list';
  if v_book_ref.id is not null then
    insert into public.basecamp_references (book_id, review_round_id, account_id, project_id, bucket_id,
      assigned_admin_person_id, reference_kind, todo_list_id, idempotency_key, provisioning_status, metadata)
    values (p_book_id, v_round.id, v_book_ref.account_id, v_book_ref.project_id, v_book_ref.bucket_id,
      null, 'review_round', v_book_ref.todo_list_id, 'basecamp:review-round:' || v_round.id::text, 'pending',
      jsonb_build_object('source_reference_id', v_book_ref.id, 'reviewer_user_id', v_reviewer_id));
    insert into public.integration_events (provider, event_type, book_id, review_round_id, status, payload_json, metadata)
    values ('basecamp', 'review_round_provisioning_requested', p_book_id, v_round.id, 'pending',
      jsonb_build_object('review_round_id', v_round.id), jsonb_build_object('source', p_source));
  end if;

  update public.book_access_tokens set last_used_at = now() where id = v_token.id;
  return jsonb_build_object('already_submitted', false, 'book_id', p_book_id,
    'review_round_id', v_round.id, 'round_number', v_round.round_number,
    'overall_status', 'AWAITING_REVIEW', 'submitted_at', v_round.submitted_at,
    'review_item_count', v_item_count, 'reviewer_user_id', v_reviewer_id);
end;
$$;

revoke all on function public.submit_kdp_book_for_approval(uuid, text, text) from public, anon, authenticated;
grant execute on function public.submit_kdp_book_for_approval(uuid, text, text) to service_role;
revoke all on function public.prevent_submitted_review_snapshot_mutation() from public, anon, authenticated;
