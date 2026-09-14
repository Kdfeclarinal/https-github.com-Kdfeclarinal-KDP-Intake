-- Server-only Basecamp connection metadata and privileged Create Book transaction.
-- OAuth access/refresh token values are deliberately not stored here. The
-- credential_reference must point to an approved server-only token vault.

insert into public.privileged_capabilities (capability_key, description)
values ('can_manage_integrations', 'Configure and disconnect server-side external integrations.')
on conflict (capability_key) do update set description = excluded.description;

create table public.basecamp_connections (
  id uuid primary key default gen_random_uuid(),
  connection_key text not null unique default 'company',
  account_id text not null,
  account_href text not null,
  project_id text not null,
  todoset_id text not null,
  credential_reference text not null,
  connection_status text not null default 'connected',
  token_expires_at timestamptz,
  connected_by_user_id uuid not null references public.privileged_users (id) on delete restrict,
  disabled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint basecamp_connections_status_allowed check (
    connection_status in ('connected', 'refresh_required', 'disabled')
  ),
  constraint basecamp_connections_https_href check (account_href like 'https://%')
);

create table public.basecamp_oauth_states (
  state_hash text primary key,
  initiated_by_user_id uuid not null references public.privileged_users (id) on delete restrict,
  account_id text not null,
  project_id text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint basecamp_oauth_state_hash_shape check (state_hash ~ '^[0-9a-f]{64}$'),
  constraint basecamp_oauth_state_expiry_after_creation check (expires_at > created_at)
);

alter table public.basecamp_connections enable row level security;
alter table public.basecamp_oauth_states enable row level security;
revoke all on table public.basecamp_connections from public, anon, authenticated;
revoke all on table public.basecamp_oauth_states from public, anon, authenticated;
grant all on table public.basecamp_connections to service_role;
grant all on table public.basecamp_oauth_states to service_role;

alter table public.basecamp_references
  add constraint basecamp_provisioned_mapping_requires_employee_todo check (
    provisioning_status <> 'provisioned' or todo_id is not null
  );

create or replace function public.consume_basecamp_oauth_state(p_state_hash text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_state public.basecamp_oauth_states%rowtype;
begin
  update public.basecamp_oauth_states
  set consumed_at = now()
  where state_hash = p_state_hash
    and consumed_at is null
    and expires_at > now()
  returning * into v_state;

  if v_state.state_hash is null then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object(
    'ok', true,
    'initiatorId', v_state.initiated_by_user_id,
    'accountId', v_state.account_id,
    'projectId', v_state.project_id
  );
end;
$$;

create or replace function public.create_privileged_kdp_book(
  p_actor_user_id uuid,
  p_connection_id uuid,
  p_employee_basecamp_person_id text,
  p_employee_name text,
  p_reviewer_user_id uuid,
  p_token_hash text,
  p_token_prefix text,
  p_source text default 'privileged_create_book'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.privileged_users%rowtype;
  v_reviewer public.privileged_users%rowtype;
  v_connection public.basecamp_connections%rowtype;
  v_book_id uuid := gen_random_uuid();
  v_reference_id uuid := gen_random_uuid();
  v_progress jsonb := jsonb_build_object(
    'steps', jsonb_build_object(
      'details', jsonb_build_object('isComplete', false, 'isUnlocked', true, 'status', 'in_progress'),
      'content', jsonb_build_object('isComplete', false, 'isUnlocked', false, 'status', 'locked'),
      'pricing', jsonb_build_object('isComplete', false, 'isUnlocked', false, 'status', 'locked')
    ),
    'activeStep', 'details'
  );
begin
  select * into v_actor from public.privileged_users
  where id = p_actor_user_id and disabled_at is null;
  if v_actor.id is null or not exists (
    select 1 from public.privileged_user_capability_grants grant_row
    where grant_row.privileged_user_id = v_actor.id
      and grant_row.capability_key = 'can_create_book'
      and grant_row.revoked_at is null
  ) then
    raise exception 'Book creation is not authorized.';
  end if;

  select * into v_reviewer from public.privileged_users
  where id = p_reviewer_user_id and disabled_at is null;
  if v_reviewer.id is null or not exists (
    select 1 from public.privileged_user_capability_grants grant_row
    where grant_row.privileged_user_id = v_reviewer.id
      and grant_row.capability_key = 'can_review'
      and grant_row.revoked_at is null
  ) then
    raise exception 'Selected reviewer is not eligible.';
  end if;

  select * into v_connection from public.basecamp_connections
  where id = p_connection_id
    and connection_status = 'connected'
    and disabled_at is null;
  if v_connection.id is null then
    raise exception 'Basecamp Pre-Press is not configured.';
  end if;

  if coalesce(btrim(p_employee_basecamp_person_id), '') = ''
     or coalesce(btrim(p_employee_name), '') = ''
     or coalesce(btrim(p_token_hash), '') = '' then
    raise exception 'Employee and access-token data are required.';
  end if;

  insert into public.books (
    id, book_format, overall_status, current_employee_step, progress_state,
    employee_basecamp_person_id, employee_name, assigned_reviewer_user_id,
    reviewer_assignment_source, reviewer_assigned_at, reviewer_assigned_by_user_id,
    created_by_email, created_by_name, metadata
  ) values (
    v_book_id, 'kindle_ebook', 'draft', 'details', v_progress,
    p_employee_basecamp_person_id, p_employee_name, p_reviewer_user_id,
    'override', now(), p_actor_user_id,
    v_actor.email_snapshot, v_actor.display_name,
    jsonb_build_object('created_from', 'createPrivilegedBook', 'source', p_source)
  );

  insert into public.book_step_data (
    book_id, step_name, step_label, step_status, is_unlocked, is_complete,
    save_type, state_json, extracted_fields, validation_errors,
    validation_required_keys, metadata
  ) values
    (v_book_id, 'details', 'Kindle eBook Details', 'in_progress', true, false, 'draft', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::text[], jsonb_build_object('source', p_source)),
    (v_book_id, 'content', 'Kindle eBook Content', 'locked', false, false, 'draft', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::text[], jsonb_build_object('source', p_source)),
    (v_book_id, 'pricing', 'Kindle eBook Pricing', 'locked', false, false, 'draft', '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::text[], jsonb_build_object('source', p_source));

  insert into public.book_access_tokens (
    role, book_id, token_hash, token_prefix, employee_name, basecamp_person_id,
    created_by_email, created_by_name, allowed_pages, allowed_actions, metadata
  ) values (
    'employee', v_book_id, p_token_hash, p_token_prefix, p_employee_name,
    p_employee_basecamp_person_id, v_actor.email_snapshot, v_actor.display_name,
    array['details', 'content', 'pricing'],
    array['load_employee_page', 'save_employee_step', 'complete_employee_step',
      'upload_content_file_to_reviewstudio', 'submit_for_approval'],
    jsonb_build_object('token_kind', 'book_specific', 'purpose', 'employee Kindle eBook intake', 'source', p_source)
  );

  insert into public.book_status_history (
    book_id, action, actor_type, actor_name, actor_email, actor_privileged_user_id,
    subject_privileged_user_id, to_status, step_name, note, metadata
  ) values (
    v_book_id, 'book_created', 'admin', v_actor.display_name, v_actor.email_snapshot,
    p_actor_user_id, p_reviewer_user_id, 'draft', 'details',
    'Kindle eBook intake created from the privileged Create New page.',
    jsonb_build_object('source', p_source, 'employee_basecamp_person_id', p_employee_basecamp_person_id)
  );

  insert into public.basecamp_references (
    id, book_id, account_id, project_id, bucket_id, assigned_employee_person_id,
    assigned_admin_person_id, reference_kind, idempotency_key,
    provisioning_status, provisioning_attempts, metadata
  ) values (
    v_reference_id, v_book_id, v_connection.account_id, v_connection.project_id,
    v_connection.project_id, p_employee_basecamp_person_id, null,
    'book_todo_list', 'basecamp:book:' || v_book_id::text, 'pending', 0,
    jsonb_build_object('todoset_id', v_connection.todoset_id, 'reviewer_user_id', p_reviewer_user_id)
  );

  insert into public.integration_events (
    provider, event_type, book_id, status, payload_json, metadata
  ) values (
    'basecamp', 'book_provisioning_requested', v_book_id, 'pending',
    jsonb_build_object('reference_id', v_reference_id),
    jsonb_build_object('source', p_source, 'actor_privileged_user_id', p_actor_user_id)
  );

  return jsonb_build_object(
    'book', jsonb_build_object('id', v_book_id, 'title', 'Untitled', 'status', 'draft'),
    'referenceId', v_reference_id
  );
end;
$$;

create or replace function public.rotate_employee_book_token(
  p_actor_user_id uuid,
  p_book_id uuid,
  p_token_hash text,
  p_token_prefix text,
  p_source text default 'basecamp_provisioning_retry'
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor public.privileged_users%rowtype;
  v_book public.books%rowtype;
begin
  select * into v_actor from public.privileged_users
  where id = p_actor_user_id and disabled_at is null;
  if v_actor.id is null or not exists (
    select 1 from public.privileged_user_capability_grants grant_row
    where grant_row.privileged_user_id = v_actor.id
      and grant_row.capability_key = 'can_create_book'
      and grant_row.revoked_at is null
  ) then
    raise exception 'Book credential rotation is not authorized.';
  end if;

  select * into v_book from public.books
  where id = p_book_id and deleted_at is null
    and overall_status::text in ('draft', 'needs_updates', 'EMPLOYEE_INTAKE', 'EMPLOYEE_UPDATES')
  for update;
  if v_book.id is null then
    raise exception 'Book is not employee-editable.';
  end if;

  update public.book_access_tokens
  set revoked_at = now(), updated_at = now()
  where book_id = p_book_id and role = 'employee' and revoked_at is null;

  insert into public.book_access_tokens (
    role, book_id, token_hash, token_prefix, employee_name, employee_email,
    basecamp_person_id, created_by_email, created_by_name,
    allowed_pages, allowed_actions, metadata
  ) values (
    'employee', p_book_id, p_token_hash, p_token_prefix, v_book.employee_name,
    v_book.employee_email, v_book.employee_basecamp_person_id,
    v_actor.email_snapshot, v_actor.display_name,
    array['details', 'content', 'pricing'],
    array['load_employee_page', 'save_employee_step', 'complete_employee_step',
      'upload_content_file_to_reviewstudio', 'submit_for_approval'],
    jsonb_build_object('token_kind', 'book_specific', 'purpose', 'employee Kindle eBook intake', 'source', p_source)
  );

  insert into public.integration_events (
    provider, event_type, book_id, status, payload_json, metadata
  ) values (
    'basecamp', 'employee_link_reissued', p_book_id, 'processed', '{}'::jsonb,
    jsonb_build_object('source', p_source, 'actor_privileged_user_id', p_actor_user_id)
  );
  return true;
end;
$$;

revoke all on function public.consume_basecamp_oauth_state(text) from public, anon, authenticated;
revoke all on function public.create_privileged_kdp_book(uuid, uuid, text, text, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.rotate_employee_book_token(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.consume_basecamp_oauth_state(text) to service_role;
grant execute on function public.create_privileged_kdp_book(uuid, uuid, text, text, uuid, text, text, text) to service_role;
grant execute on function public.rotate_employee_book_token(uuid, uuid, text, text, text) to service_role;
