-- Stage A foundation for locked architecture decisions 1-35.
-- This additive stage keeps the existing overall_status column and preserves the
-- deployed writer labels 'draft', 'for_approval', 'in_admin_review',
-- 'needs_updates', and 'approved'. It does not rewrite existing rows or require
-- deployed writers to emit canonical labels.
-- Stage B is a later coordinated writer/data cutover. Only Stage B may migrate
-- rows or consider making the legacy labels invalid.
alter type public.kdp_book_status add value if not exists 'EMPLOYEE_INTAKE';
alter type public.kdp_book_status add value if not exists 'AWAITING_REVIEW';
alter type public.kdp_book_status add value if not exists 'IN_REVIEW';
alter type public.kdp_book_status add value if not exists 'EMPLOYEE_UPDATES';
alter type public.kdp_book_status add value if not exists 'KDP_INTAKE_APPROVED';

comment on type public.kdp_book_status is
  'Stage A adds canonical application states EMPLOYEE_INTAKE, AWAITING_REVIEW, IN_REVIEW, EMPLOYEE_UPDATES, and KDP_INTAKE_APPROVED. Legacy writer labels draft, for_approval, in_admin_review, needs_updates, and approved remain valid until the coordinated Stage B writer/data cutover.';

create table public.privileged_users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users (id) on delete restrict,
  display_name text,
  email_snapshot text,
  disabled_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.privileged_capabilities (
  capability_key text primary key,
  description text not null,
  created_at timestamptz not null default now()
);

insert into public.privileged_capabilities (capability_key, description)
values
  ('can_review', 'Review assigned books and rounds.'),
  ('can_claim_review', 'Claim an unassigned active review round.'),
  ('can_assign_reviewer', 'Assign a reviewer where none is assigned.'),
  ('can_reassign_reviewer', 'Replace an existing reviewer assignment.'),
  ('can_create_book', 'Create a canonical book intake record.'),
  ('can_view_all_books', 'View books beyond explicit reviewer assignment.'),
  ('can_finalize_book', 'Finalize an eligible review outcome.'),
  ('can_manage_users', 'Manage privileged users and capability grants.')
on conflict (capability_key) do update
set description = excluded.description;

create table public.privileged_user_capability_grants (
  id uuid primary key default gen_random_uuid(),
  privileged_user_id uuid not null references public.privileged_users (id) on delete restrict,
  capability_key text not null references public.privileged_capabilities (capability_key) on delete restrict,
  granted_by_user_id uuid references public.privileged_users (id) on delete restrict,
  granted_at timestamptz not null default now(),
  revoked_by_user_id uuid references public.privileged_users (id) on delete restrict,
  revoked_at timestamptz,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  constraint privileged_capability_revocation_complete check (
    (revoked_at is null and revoked_by_user_id is null)
    or revoked_at is not null
  )
);

create unique index privileged_user_capability_one_active_grant
  on public.privileged_user_capability_grants (privileged_user_id, capability_key)
  where revoked_at is null;

create table public.review_assignment_defaults (
  scope_key text primary key,
  reviewer_user_id uuid not null references public.privileged_users (id) on delete restrict,
  updated_by_user_id uuid references public.privileged_users (id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.books
  add column if not exists assigned_reviewer_user_id uuid references public.privileged_users (id) on delete restrict,
  add column if not exists reviewer_assignment_source text,
  add column if not exists reviewer_assigned_at timestamptz,
  add column if not exists reviewer_assigned_by_user_id uuid references public.privileged_users (id) on delete restrict;

alter table public.books
  add constraint books_reviewer_assignment_source_allowed check (
    reviewer_assignment_source is null
    or reviewer_assignment_source in ('default', 'override', 'claim', 'reassignment', 'inherited')
  );

alter table public.book_status_history
  add column if not exists actor_privileged_user_id uuid references public.privileged_users (id) on delete restrict,
  add column if not exists subject_privileged_user_id uuid references public.privileged_users (id) on delete restrict;

alter table public.book_review_rounds
  add column if not exists reviewer_user_id uuid references public.privileged_users (id) on delete restrict,
  add column if not exists reviewer_assigned_by_user_id uuid references public.privileged_users (id) on delete restrict,
  add column if not exists reviewer_assignment_source text,
  add column if not exists reviewer_assigned_at timestamptz,
  add column if not exists submission_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists finalized_at timestamptz,
  add column if not exists finalized_by_user_id uuid references public.privileged_users (id) on delete restrict;

alter table public.book_review_rounds
  add constraint book_review_rounds_assignment_source_allowed check (
    reviewer_assignment_source is null
    or reviewer_assignment_source in ('default', 'override', 'claim', 'reassignment', 'inherited')
  );

create unique index book_review_rounds_one_active_per_book
  on public.book_review_rounds (book_id)
  where status in ('submitted', 'in_review');

alter table public.book_review_comments
  add column if not exists parent_comment_id uuid references public.book_review_comments (id) on delete restrict;

alter table public.book_review_comments
  add constraint book_review_comments_not_own_parent check (parent_comment_id is distinct from id);

create or replace function public.validate_review_comment_parent()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.parent_comment_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.book_review_comments parent
    where parent.id = new.parent_comment_id
      and parent.book_id = new.book_id
      and parent.review_round_id = new.review_round_id
      and parent.review_item_id = new.review_item_id
  ) then
    raise exception 'Reply parent must belong to the same book, review round, and review item.';
  end if;

  return new;
end;
$$;

create trigger book_review_comments_validate_parent
before insert or update of parent_comment_id, book_id, review_round_id, review_item_id
on public.book_review_comments
for each row execute function public.validate_review_comment_parent();

create or replace function public.prevent_finalized_review_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_round_id uuid;
  v_finalized_at timestamptz;
begin
  if tg_table_name = 'book_review_rounds' then
    if tg_op = 'INSERT' then
      return new;
    end if;
    v_finalized_at := old.finalized_at;
  else
    v_round_id := case when tg_op = 'DELETE' then old.review_round_id else new.review_round_id end;
    select finalized_at into v_finalized_at
    from public.book_review_rounds
    where id = v_round_id;
  end if;

  if v_finalized_at is not null then
    raise exception 'Finalized review rounds and their history are immutable.';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger book_review_rounds_prevent_finalized_mutation
before update or delete on public.book_review_rounds
for each row execute function public.prevent_finalized_review_mutation();

create trigger book_review_items_prevent_finalized_mutation
before insert or update or delete on public.book_review_items
for each row execute function public.prevent_finalized_review_mutation();

create trigger book_review_comments_prevent_finalized_mutation
before insert or update or delete on public.book_review_comments
for each row execute function public.prevent_finalized_review_mutation();

alter table public.basecamp_references
  add column if not exists reference_kind text not null default 'legacy',
  add column if not exists todo_list_id text,
  add column if not exists idempotency_key text,
  add column if not exists provisioning_status text not null default 'not_started',
  add column if not exists provisioning_attempts integer not null default 0,
  add column if not exists last_provisioning_attempt_at timestamptz,
  add column if not exists last_provisioning_error text;

alter table public.basecamp_references
  add constraint basecamp_reference_kind_allowed check (
    reference_kind in ('legacy', 'book_todo_list', 'review_round')
  ),
  add constraint basecamp_provisioning_status_allowed check (
    provisioning_status in ('not_started', 'pending', 'provisioned', 'failed')
  ),
  add constraint basecamp_provisioning_attempts_nonnegative check (
    provisioning_attempts >= 0
  ),
  add constraint basecamp_provisioned_mapping_requires_external_id check (
    provisioning_status <> 'provisioned' or todo_list_id is not null
  ),
  add constraint basecamp_book_mapping_requires_idempotency_key check (
    reference_kind <> 'book_todo_list' or idempotency_key is not null
  );

create unique index basecamp_references_idempotency_key_unique
  on public.basecamp_references (idempotency_key)
  where idempotency_key is not null;

create unique index basecamp_references_one_book_todo_list
  on public.basecamp_references (book_id)
  where reference_kind = 'book_todo_list';

alter table public.privileged_users enable row level security;
alter table public.privileged_capabilities enable row level security;
alter table public.privileged_user_capability_grants enable row level security;
alter table public.review_assignment_defaults enable row level security;

revoke all on table public.privileged_users from anon, authenticated;
revoke all on table public.privileged_capabilities from anon, authenticated;
revoke all on table public.privileged_user_capability_grants from anon, authenticated;
revoke all on table public.review_assignment_defaults from anon, authenticated;

grant all on table public.privileged_users to service_role;
grant all on table public.privileged_capabilities to service_role;
grant all on table public.privileged_user_capability_grants to service_role;
grant all on table public.review_assignment_defaults to service_role;

revoke all on function public.validate_review_comment_parent() from public, anon, authenticated;
revoke all on function public.prevent_finalized_review_mutation() from public, anon, authenticated;
