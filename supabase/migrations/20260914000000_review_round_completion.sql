-- Stage A workflow completion. Canonical labels are used by these new writers,
-- while all legacy labels/readers remain supported until a coordinated Stage B.

alter table public.book_review_rounds
  add column if not exists outcome text,
  add column if not exists previous_round_id uuid references public.book_review_rounds(id) on delete restrict,
  add column if not exists reached_steps text[] not null default array['details']::text[],
  add column if not exists employee_updates_started_at timestamptz;

alter table public.book_review_rounds
  add constraint book_review_round_outcome_allowed check (
    outcome is null or outcome in ('request_updates', 'approved')
  );

drop index if exists public.book_review_rounds_one_active_per_book;
create unique index book_review_rounds_one_active_per_book
  on public.book_review_rounds(book_id)
  where finalized_at is null and status in ('submitted', 'in_review');

alter table public.book_review_items
  add column if not exists decision text not null default 'pending',
  add column if not exists decision_at timestamptz,
  add column if not exists decision_by_user_id uuid references public.privileged_users(id) on delete restrict,
  add column if not exists decision_source text,
  add column if not exists carried_from_review_item_id uuid references public.book_review_items(id) on delete restrict,
  add column if not exists reopened_at timestamptz,
  add column if not exists reopened_by_user_id uuid references public.privileged_users(id) on delete restrict,
  add column if not exists update_baseline_hash text;

alter table public.book_review_items
  add constraint book_review_item_decision_allowed check (decision in ('pending', 'approved', 'needs_updates'));

alter table public.book_review_comments
  add column if not exists body text not null default '',
  add column if not exists comment_text text not null default '',
  add column if not exists admin_name text,
  add column if not exists admin_email text,
  add column if not exists round_comment_number integer,
  add column if not exists author_actor_type text not null default 'privileged',
  add column if not exists author_privileged_user_id uuid references public.privileged_users(id) on delete restrict,
  add column if not exists author_employee_token_id uuid references public.book_access_tokens(id) on delete restrict,
  add column if not exists actionable boolean not null default true,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by_privileged_user_id uuid references public.privileged_users(id) on delete restrict,
  add column if not exists edited_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_privileged_user_id uuid references public.privileged_users(id) on delete restrict;

alter table public.book_review_comments
  add constraint book_review_comment_actor_allowed check (author_actor_type in ('privileged', 'employee')),
  add constraint book_review_comment_number_positive check (round_comment_number is null or round_comment_number > 0);

create unique index book_review_comments_round_number_unique
  on public.book_review_comments(review_round_id, round_comment_number)
  where round_comment_number is not null and parent_comment_id is null and deleted_at is null;

create table public.book_review_audit_events (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete restrict,
  review_round_id uuid not null references public.book_review_rounds(id) on delete restrict,
  review_item_id uuid references public.book_review_items(id) on delete restrict,
  comment_id uuid references public.book_review_comments(id) on delete restrict,
  action text not null,
  actor_type text not null,
  actor_privileged_user_id uuid references public.privileged_users(id) on delete restrict,
  actor_employee_token_id uuid references public.book_access_tokens(id) on delete restrict,
  from_state jsonb not null default '{}'::jsonb,
  to_state jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.book_review_audit_events enable row level security;
revoke all on table public.book_review_audit_events from public, anon, authenticated;
grant all on table public.book_review_audit_events to service_role;

-- Finalized decisions/snapshots remain immutable. The only append permitted on
-- a finalized Request Updates round is an employee reply to an existing thread.
create or replace function public.prevent_finalized_review_mutation()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_round_id uuid; v_finalized_at timestamptz; v_outcome text;
begin
  if tg_table_name='book_review_rounds' then
    if tg_op='INSERT' then return new; end if;
    v_finalized_at:=old.finalized_at;
  else
    v_round_id:=case when tg_op='DELETE' then old.review_round_id else new.review_round_id end;
    select finalized_at,outcome into v_finalized_at,v_outcome from public.book_review_rounds where id=v_round_id;
  end if;
  if v_finalized_at is not null then
    if tg_table_name='book_review_comments' and tg_op='INSERT' and new.author_actor_type='employee' and new.parent_comment_id is not null and v_outcome='request_updates' then return new; end if;
    raise exception 'Finalized review rounds and their history are immutable.';
  end if;
  return case when tg_op='DELETE' then old else new end;
end; $$;

alter table public.basecamp_references drop constraint if exists basecamp_reference_kind_allowed;
alter table public.basecamp_references add constraint basecamp_reference_kind_allowed check (
  reference_kind in ('legacy', 'book_todo_list', 'review_round', 'employee_update')
);
create unique index basecamp_references_one_employee_update_round
  on public.basecamp_references(review_round_id)
  where reference_kind = 'employee_update';

-- The Edge retry path must acquire this durable pending-event claim before it
-- makes an external Basecamp request. This closes concurrent list-then-create
-- retries without holding a database transaction open across the network.
create unique index basecamp_one_pending_review_outcome_sync
  on public.integration_events(review_round_id)
  where provider = 'basecamp'
    and event_type in ('review_outcome_sync_requested', 'review_outcome_retry_requested')
    and status = 'pending'
    and review_round_id is not null;

create or replace function public.apply_admin_review_action(
  p_book_id uuid,
  p_review_round_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_book public.books%rowtype;
  v_round public.book_review_rounds%rowtype;
  v_item public.book_review_items%rowtype;
  v_comment public.book_review_comments%rowtype;
  v_item_id uuid;
  v_comment_id uuid;
  v_body text;
  v_number integer;
  v_name text;
  v_email text;
  v_previous text;
  v_count integer;
  v_step text;
begin
  select * into v_book from public.books where id = p_book_id and deleted_at is null for update;
  select * into v_round from public.book_review_rounds where id = p_review_round_id and book_id = p_book_id for update;
  if v_book.id is null or v_round.id is null or v_book.latest_review_round_id is distinct from v_round.id then raise exception 'Review is not authorized.'; end if;
  if v_round.finalized_at is not null or v_round.status not in ('submitted', 'in_review') then raise exception 'Review round is immutable.'; end if;
  if v_round.reviewer_user_id is distinct from p_actor_user_id then raise exception 'Review is not assigned to this reviewer.'; end if;
  if not exists (select 1 from public.privileged_users u join public.privileged_user_capability_grants g on g.privileged_user_id = u.id where u.id = p_actor_user_id and u.disabled_at is null and g.capability_key = 'can_review' and g.revoked_at is null) then raise exception 'Review action is not authorized.'; end if;
  select display_name, email_snapshot into v_name, v_email from public.privileged_users where id = p_actor_user_id;

  if nullif(p_payload->>'item_id', '') is not null then
    v_item_id := (p_payload->>'item_id')::uuid;
    select * into v_item from public.book_review_items where id = v_item_id and book_id = p_book_id and review_round_id = p_review_round_id for update;
    if v_item.id is null then raise exception 'Review item is not authorized.'; end if;
  end if;
  if nullif(p_payload->>'comment_id', '') is not null then
    v_comment_id := (p_payload->>'comment_id')::uuid;
    select * into v_comment from public.book_review_comments where id = v_comment_id and book_id = p_book_id and review_round_id = p_review_round_id for update;
    if v_comment.id is null or v_comment.deleted_at is not null then raise exception 'Comment is not authorized.'; end if;
  end if;

  v_step := coalesce(
    v_item.step_name::text,
    (select i.step_name::text from public.book_review_items i where i.id = v_comment.review_item_id),
    nullif(p_payload->>'step_name', '')
  );
  if v_step not in ('details', 'content', 'pricing') then raise exception 'Review page is not accessible.'; end if;
  if v_step <> 'details' and not (v_step = any(v_round.reached_steps)) and (
    not exists (select 1 from public.book_review_items i where i.review_round_id=p_review_round_id and i.is_reviewable=true and i.step_name::text='details')
    or exists (select 1 from public.book_review_items i where i.review_round_id=p_review_round_id and i.is_reviewable=true and i.step_name::text='details' and i.decision='pending')
    or (v_step='pricing' and (
      not exists (select 1 from public.book_review_items i where i.review_round_id=p_review_round_id and i.is_reviewable=true and i.step_name::text='content')
      or exists (select 1 from public.book_review_items i where i.review_round_id=p_review_round_id and i.is_reviewable=true and i.step_name::text='content' and i.decision='pending')
    ))
  ) then raise exception 'Review page is not accessible.'; end if;

  if p_action = 'reach_step' then
    v_count := 0;
  elsif p_action = 'approve' then
    v_previous := v_item.decision;
    if exists (select 1 from public.book_review_comments c where c.review_item_id = v_item.id and c.actionable and c.parent_comment_id is null and c.resolved_at is null and c.deleted_at is null) then raise exception 'Resolve actionable threads before approving.'; end if;
    update public.book_review_items set decision = 'approved', decision_at = now(), decision_by_user_id = p_actor_user_id, decision_source = 'explicit' where id = v_item.id;
  elsif p_action = 'reopen' then
    if v_item.decision <> 'approved' then
      raise exception 'Only an approved section may be reopened.';
    end if;

    v_previous := v_item.decision;

    update public.book_review_items
    set
      decision = 'pending',
      decision_at = now(),
      decision_by_user_id = p_actor_user_id,
      decision_source = 'reopened',
      reopened_at = now(),
      reopened_by_user_id = p_actor_user_id
    where id = v_item.id;
  elsif p_action in ('comment', 'reply') then
    v_body := nullif(btrim(p_payload->>'body'), '');
    if v_body is null or length(v_body) > 2000 then raise exception 'Comment body is invalid.'; end if;
    if p_action = 'reply' and v_comment.parent_comment_id is not null then raise exception 'Replies cannot be nested.'; end if;
    if p_action = 'comment' and coalesce((p_payload->>'actionable')::boolean, false) and v_item.id is null then raise exception 'Actionable comments require a review item.'; end if;
    if p_action = 'comment' and coalesce((p_payload->>'actionable')::boolean, false) then
      perform pg_advisory_xact_lock(hashtext(p_review_round_id::text));
      select coalesce(max(round_comment_number), 0) + 1 into v_number from public.book_review_comments where review_round_id = p_review_round_id;
    end if;
    insert into public.book_review_comments(book_id, review_round_id, review_item_id, parent_comment_id, body, comment_text, admin_name, admin_email, round_comment_number, author_actor_type, author_privileged_user_id, actionable)
    values (p_book_id, p_review_round_id, case when p_action = 'reply' then v_comment.review_item_id else v_item_id end, case when p_action = 'reply' then v_comment.id else null end, v_body, v_body, v_name, v_email, v_number, 'privileged', p_actor_user_id, case when p_action = 'reply' then false else coalesce((p_payload->>'actionable')::boolean, false) end)
    returning * into v_comment;
    v_comment_id := v_comment.id;
    if p_action = 'comment' and v_comment.actionable then
      v_previous := v_item.decision;
      update public.book_review_items set decision = 'needs_updates', decision_at = now(), decision_by_user_id = p_actor_user_id, decision_source = 'actionable_comment', update_baseline_hash = md5(jsonb_build_object('value',coalesce(section_snapshot->'submitted_step'->'sections'->section_key, section_snapshot->'submitted_step'->'sections'->split_part(section_key, '.', 2)),'file_references',coalesce(section_snapshot->'file_references','[]'::jsonb))::text) where id = v_item.id;
    end if;
  elsif p_action = 'edit_comment' then
    v_body := nullif(btrim(p_payload->>'body'), '');
    if v_body is null or length(v_body) > 2000 or v_comment.author_privileged_user_id is distinct from p_actor_user_id then raise exception 'Comment edit is not authorized.'; end if;
    update public.book_review_comments set body = v_body, comment_text = v_body, edited_at = now() where id = v_comment.id;
  elsif p_action = 'resolve_comment' then
    if not v_comment.actionable or v_comment.parent_comment_id is not null then raise exception 'Only actionable threads may be resolved.'; end if;
    update public.book_review_comments set resolved_at = now(), resolved_by_privileged_user_id = p_actor_user_id where id = v_comment.id;
    if not exists (select 1 from public.book_review_comments c where c.review_item_id = v_comment.review_item_id and c.actionable and c.parent_comment_id is null and c.resolved_at is null and c.deleted_at is null and c.id <> v_comment.id) then
      update public.book_review_items set decision = 'pending', decision_at = now(), decision_by_user_id = p_actor_user_id, decision_source = 'issues_resolved' where id = v_comment.review_item_id and decision = 'needs_updates';
    end if;
  elsif p_action = 'delete_comment' then
    if v_comment.author_privileged_user_id is distinct from p_actor_user_id then raise exception 'Comment deletion is not authorized.'; end if;
    update public.book_review_comments set deleted_at = now(), deleted_by_privileged_user_id = p_actor_user_id where id = v_comment.id;
    if v_comment.actionable and v_comment.parent_comment_id is null and not exists (select 1 from public.book_review_comments c where c.review_item_id = v_comment.review_item_id and c.actionable and c.parent_comment_id is null and c.resolved_at is null and c.deleted_at is null and c.id <> v_comment.id) then
      update public.book_review_items set decision = 'pending', decision_at = now(), decision_by_user_id = p_actor_user_id, decision_source = 'issue_deleted' where id = v_comment.review_item_id and decision = 'needs_updates';
    end if;
  elsif p_action = 'approve_all' then
    update public.book_review_items i set decision = 'approved', decision_at = now(), decision_by_user_id = p_actor_user_id, decision_source = 'approve_all'
    where i.review_round_id = p_review_round_id and i.step_name::text = p_payload->>'step_name' and i.is_reviewable = true and i.decision = 'pending'
      and not exists (select 1 from public.book_review_comments c where c.review_item_id = i.id and c.actionable and c.parent_comment_id is null and c.resolved_at is null and c.deleted_at is null);
    get diagnostics v_count = row_count;
  else raise exception 'Review action is invalid.';
  end if;

  update public.book_review_rounds set status = 'in_review', reached_steps = case when v_step = any(reached_steps) then reached_steps else array_append(reached_steps, v_step) end where id = p_review_round_id;
  insert into public.book_review_audit_events(book_id, review_round_id, review_item_id, comment_id, action, actor_type, actor_privileged_user_id, from_state, to_state)
  values (p_book_id, p_review_round_id, v_item_id, v_comment_id, p_action, 'privileged', p_actor_user_id, jsonb_build_object('decision', v_previous), jsonb_build_object('affected_count', coalesce(v_count, 1)));
  return jsonb_build_object('ok', true, 'action', p_action, 'comment_id', v_comment_id, 'affected_count', coalesce(v_count, 1));
end;
$$;

create or replace function public.finalize_kdp_review_round(p_book_id uuid, p_review_round_id uuid, p_actor_user_id uuid, p_outcome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_book public.books%rowtype; v_round public.book_review_rounds%rowtype; v_target text; v_ref public.basecamp_references%rowtype;
begin
  select * into v_book from public.books where id = p_book_id and deleted_at is null for update;
  select * into v_round from public.book_review_rounds where id = p_review_round_id and book_id = p_book_id for update;
  if v_book.latest_review_round_id is distinct from v_round.id or v_round.finalized_at is not null then raise exception 'Active review round is unavailable.'; end if;
  if v_round.reviewer_user_id is distinct from p_actor_user_id and not exists (select 1 from public.privileged_user_capability_grants g where g.privileged_user_id=p_actor_user_id and g.capability_key in ('can_reassign_reviewer','can_manage_users') and g.revoked_at is null) then raise exception 'Review finalization is not assigned or authorized.'; end if;
  if not exists (select 1 from public.privileged_users u join public.privileged_user_capability_grants g on g.privileged_user_id=u.id where u.id=p_actor_user_id and u.disabled_at is null and g.capability_key='can_finalize_book' and g.revoked_at is null) then raise exception 'Book finalization is not authorized.'; end if;
  if exists (select 1 from public.book_review_items where review_round_id=p_review_round_id and is_reviewable=true and decision='pending') then raise exception 'Required review sections are still pending.'; end if;
  if p_outcome='request_updates' then
    if not exists (select 1 from public.book_review_items where review_round_id=p_review_round_id and is_reviewable=true and decision='needs_updates') then raise exception 'Request Updates requires at least one requested change.'; end if;
    v_target := 'EMPLOYEE_UPDATES';
    update public.book_access_tokens set allowed_actions=(select array_agg(distinct action_name) from unnest(allowed_actions || array['reply_to_review','resubmit_for_review']) action_name), updated_at=now() where book_id=p_book_id and role::text='employee' and revoked_at is null and metadata->>'token_kind'='book_specific';
  elsif p_outcome='approve_book' then
    if exists (select 1 from public.book_review_items i where i.review_round_id=p_review_round_id and i.is_reviewable=true and (i.decision<>'approved' or exists (select 1 from public.book_review_comments c where c.review_item_id=i.id and c.actionable and c.parent_comment_id is null and c.resolved_at is null and c.deleted_at is null))) then raise exception 'All required sections must be approved.'; end if;
    v_target := 'KDP_INTAKE_APPROVED';
  else raise exception 'Review outcome is invalid.'; end if;
  update public.book_review_rounds set outcome=case when p_outcome='approve_book' then 'approved' else p_outcome end, finalized_at=now(), finalized_by_user_id=p_actor_user_id, employee_updates_started_at=case when p_outcome='request_updates' then now() else null end where id=p_review_round_id;
  update public.books set overall_status=v_target::public.kdp_book_status, current_employee_step=case when p_outcome='request_updates' then 'details' else current_employee_step end, updated_at=now(), last_modified_at=now() where id=p_book_id;
  insert into public.book_status_history(book_id,review_round_id,action,actor_type,actor_privileged_user_id,from_status,to_status,note,metadata) values(p_book_id,p_review_round_id,p_outcome,'admin',p_actor_user_id,v_book.overall_status,v_target,case when p_outcome='approve_book' then 'KDP Intake approved; not an Amazon publication event.' else 'Updates requested from employee.' end,'{}');
  insert into public.book_review_audit_events(book_id,review_round_id,action,actor_type,actor_privileged_user_id,from_state,to_state) values(p_book_id,p_review_round_id,p_outcome,'privileged',p_actor_user_id,jsonb_build_object('book_status',v_book.overall_status),jsonb_build_object('book_status',v_target));
  select * into v_ref from public.basecamp_references where book_id=p_book_id and review_round_id=p_review_round_id and reference_kind='review_round';
  if p_outcome='request_updates' and v_ref.id is not null then
    insert into public.basecamp_references(book_id,review_round_id,account_id,project_id,bucket_id,reference_kind,todo_list_id,idempotency_key,provisioning_status,metadata) values(p_book_id,p_review_round_id,v_ref.account_id,v_ref.project_id,v_ref.bucket_id,'employee_update',v_ref.todo_list_id,'basecamp:employee-update:'||p_review_round_id::text,'pending',jsonb_build_object('round_number',v_round.round_number)) on conflict(idempotency_key) do nothing;
  end if;
  if p_outcome='approve_book' and v_ref.id is not null then
    update public.basecamp_references set provisioning_status='pending', last_provisioning_error=null where id=v_ref.id;
  end if;
  insert into public.integration_events(provider,event_type,book_id,review_round_id,status,payload_json,metadata) values('basecamp','review_outcome_sync_requested',p_book_id,p_review_round_id,'pending',jsonb_build_object('outcome',p_outcome),'{}');
  return jsonb_build_object('ok',true,'outcome',p_outcome,'overall_status',v_target,'review_round_id',p_review_round_id);
end; $$;

create or replace function public.add_employee_review_reply(p_book_id uuid,p_token_hash text,p_comment_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_token public.book_access_tokens%rowtype; v_book public.books%rowtype; v_comment public.book_review_comments%rowtype; v_reply public.book_review_comments%rowtype;
begin
  select * into v_book from public.books where id=p_book_id and overall_status::text in ('needs_updates','EMPLOYEE_UPDATES') and deleted_at is null for update;
  select * into v_token from public.book_access_tokens where token_hash=p_token_hash and book_id=p_book_id and role::text='employee' and revoked_at is null and (expires_at is null or expires_at>now()) and metadata->>'token_kind'='book_specific' and 'reply_to_review'=any(allowed_actions) for update;
  if v_book.id is null or v_token.id is null then raise exception 'Employee reply is not authorized.'; end if;
  select c.* into v_comment from public.book_review_comments c join public.book_review_rounds r on r.id=c.review_round_id where c.id=p_comment_id and c.book_id=p_book_id and r.id=v_book.latest_review_round_id and r.outcome='request_updates' and c.actionable and c.parent_comment_id is null and c.deleted_at is null;
  if v_comment.id is null or nullif(btrim(p_body),'') is null or length(p_body)>2000 then raise exception 'Employee reply is invalid.'; end if;
  insert into public.book_review_comments(book_id,review_round_id,review_item_id,parent_comment_id,body,comment_text,admin_name,admin_email,author_actor_type,author_employee_token_id,actionable) values(p_book_id,v_comment.review_round_id,v_comment.review_item_id,v_comment.id,btrim(p_body),btrim(p_body),v_token.employee_name,v_token.employee_email,'employee',v_token.id,false) returning * into v_reply;
  insert into public.book_review_audit_events(book_id,review_round_id,review_item_id,comment_id,action,actor_type,actor_employee_token_id) values(p_book_id,v_comment.review_round_id,v_comment.review_item_id,v_reply.id,'employee_reply','employee',v_token.id);
  return jsonb_build_object('ok',true,'comment_id',v_reply.id);
end; $$;

create or replace function public.resubmit_kdp_book_for_review(p_book_id uuid,p_token_hash text,p_source text default 'employee_resubmit')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_book public.books%rowtype; v_token public.book_access_tokens%rowtype; v_old public.book_review_rounds%rowtype; v_new public.book_review_rounds%rowtype; v_snapshot jsonb; v_count int; v_book_ref public.basecamp_references%rowtype;
begin
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_token from public.book_access_tokens where token_hash=p_token_hash and book_id=p_book_id and role::text='employee' and revoked_at is null and (expires_at is null or expires_at>now()) and metadata->>'token_kind'='book_specific' and 'resubmit_for_review'=any(allowed_actions) for update;
  if v_book.id is null or v_book.overall_status::text not in ('needs_updates','EMPLOYEE_UPDATES') or v_token.id is null then raise exception 'Resubmission is not authorized.'; end if;
  select * into v_old from public.book_review_rounds where id=v_book.latest_review_round_id and book_id=p_book_id and outcome='request_updates' and finalized_at is not null;
  if v_old.id is null then raise exception 'Employee update round is unavailable.'; end if;
  if exists (
    select 1 from public.book_review_comments c
    join public.book_review_items i on i.id=c.review_item_id
    where c.review_round_id=v_old.id and c.actionable and c.parent_comment_id is null and c.deleted_at is null
      and not (
        exists(select 1 from public.book_review_comments reply where reply.parent_comment_id=c.id and reply.author_actor_type='employee' and reply.created_at>c.created_at and reply.deleted_at is null)
        or md5(jsonb_build_object(
          'value',(select coalesce(s.state_json->'sections'->i.section_key, s.state_json->'sections'->split_part(i.section_key, '.', 2)) from public.book_step_data s where s.book_id=p_book_id and s.step_name=i.step_name),
          'file_references',coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'version_number',f.version_number,'reviewstudio_file_id',f.reviewstudio_file_id,'reviewstudio_review_id',f.reviewstudio_review_id) order by f.id) from public.book_files f where f.book_id=p_book_id and f.is_latest=true and f.section_key=i.section_key),'[]'::jsonb)
        )::text) is distinct from i.update_baseline_hash
      )
  ) then raise exception 'All requested updates require a meaningful change or employee reply.'; end if;
  if exists(select 1 from public.book_step_data where book_id=p_book_id and (is_complete is not true or validation_errors is distinct from '{}'::jsonb)) then raise exception 'Complete all employee steps before resubmitting.'; end if;
  select jsonb_build_object('schema_version',1,'book',to_jsonb(v_book)-'metadata','steps',coalesce(jsonb_object_agg(s.step_name::text,jsonb_build_object('state_json',s.state_json,'extracted_fields',s.extracted_fields,'validation_errors',s.validation_errors,'saved_at',s.saved_at)),'{}'::jsonb),'files',coalesce((select jsonb_agg(to_jsonb(f)-'metadata') from public.book_files f where f.book_id=p_book_id and f.is_latest=true),'[]'::jsonb)) into v_snapshot from public.book_step_data s where s.book_id=p_book_id;
  insert into public.book_review_rounds(book_id,round_number,status,submitted_at,submitted_by_actor_type,submitted_by_email,submitted_by_name,reviewer_user_id,reviewer_assignment_source,reviewer_assigned_at,submission_snapshot,previous_round_id,metadata) values(p_book_id,v_old.round_number+1,'submitted',now(),'employee',v_token.employee_email,v_token.employee_name,case when exists(select 1 from public.privileged_users u join public.privileged_user_capability_grants g on g.privileged_user_id=u.id where u.id=v_old.reviewer_user_id and u.disabled_at is null and g.capability_key='can_review' and g.revoked_at is null) then v_old.reviewer_user_id else null end,'inherited',now(),v_snapshot,v_old.id,jsonb_build_object('source',p_source)) returning * into v_new;
  insert into public.book_review_items(book_id,review_round_id,step_name,section_key,section_label,sort_order,is_file_section,is_reviewable,section_snapshot,decision,decision_at,decision_source,carried_from_review_item_id,metadata)
  select p_book_id,v_new.id,d.step_name,d.section_key,d.section_label,d.sort_order,d.is_file_section,d.is_reviewable,jsonb_build_object('submitted_step',s.state_json,'submitted_extracted_fields',s.extracted_fields,'value',current_value.value,'file_references',current_files.value),case when carry.carries then 'approved' else 'pending' end,case when carry.carries then now() else null end,case when carry.carries then 'carried_forward' else null end,case when carry.carries then old.id else null end,jsonb_build_object('snapshot_schema_version',1)
  from public.book_section_definitions d
  join public.book_step_data s on s.book_id=p_book_id and s.step_name=d.step_name
  left join public.book_review_items old on old.review_round_id=v_old.id and old.section_key=d.section_key
  cross join lateral (select coalesce(s.state_json->'sections'->d.section_key, s.state_json->'sections'->split_part(d.section_key, '.', 2)) as value) current_value
  cross join lateral (select coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'version_number',f.version_number,'reviewstudio_file_id',f.reviewstudio_file_id,'reviewstudio_review_id',f.reviewstudio_review_id) order by f.id) from public.book_files f where f.book_id=p_book_id and f.is_latest=true and f.section_key=d.section_key),'[]'::jsonb) as value) current_files
  cross join lateral (select old.decision='approved' and old.reopened_at is null and md5(coalesce(coalesce(old.section_snapshot->'submitted_step'->'sections'->d.section_key, old.section_snapshot->'submitted_step'->'sections'->split_part(d.section_key, '.', 2))::text,'null'))=md5(coalesce(current_value.value::text,'null')) and (not d.is_file_section or old.section_snapshot->'file_references'=current_files.value) and (d.step_name::text <> 'pricing' or not exists (select 1 from public.book_review_items dep where dep.review_round_id=v_old.id and dep.decision<>'approved' and (dep.is_file_section=true or split_part(dep.section_key,'.',2)='primary_marketplace'))) as carries) carry
  where d.is_reviewable=true;
  get diagnostics v_count=row_count;
  update public.books set latest_review_round_id=v_new.id,overall_status='AWAITING_REVIEW',assigned_reviewer_user_id=v_new.reviewer_user_id,updated_at=now(),last_modified_at=now() where id=p_book_id;
  insert into public.book_status_history(book_id,review_round_id,action,actor_type,actor_name,actor_email,from_status,to_status,note,metadata) values(p_book_id,v_new.id,'resubmitted_for_approval','employee',v_token.employee_name,v_token.employee_email,v_book.overall_status,'AWAITING_REVIEW','Employee updates resubmitted.',jsonb_build_object('previous_round_id',v_old.id));
  select * into v_book_ref from public.basecamp_references where book_id=p_book_id and reference_kind='book_todo_list';
  if v_book_ref.id is not null then insert into public.basecamp_references(book_id,review_round_id,account_id,project_id,bucket_id,reference_kind,todo_list_id,idempotency_key,provisioning_status,metadata) values(p_book_id,v_new.id,v_book_ref.account_id,v_book_ref.project_id,v_book_ref.bucket_id,'review_round',v_book_ref.todo_list_id,'basecamp:review-round:'||v_new.id::text,'pending',jsonb_build_object('round_number',v_new.round_number)) on conflict(idempotency_key) do nothing; end if;
  insert into public.integration_events(provider,event_type,book_id,review_round_id,status,payload_json,metadata) values('basecamp','review_round_provisioning_requested',p_book_id,v_new.id,'pending',jsonb_build_object('previous_round_id',v_old.id),'{}');
  return jsonb_build_object('ok',true,'review_round_id',v_new.id,'round_number',v_new.round_number,'review_item_count',v_count,'overall_status','AWAITING_REVIEW');
end; $$;

revoke all on function public.apply_admin_review_action(uuid,uuid,uuid,text,jsonb) from public, anon, authenticated;
revoke all on function public.finalize_kdp_review_round(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.add_employee_review_reply(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.resubmit_kdp_book_for_review(uuid,text,text) from public, anon, authenticated;
grant execute on function public.apply_admin_review_action(uuid,uuid,uuid,text,jsonb) to service_role;
grant execute on function public.finalize_kdp_review_round(uuid,uuid,uuid,text) to service_role;
grant execute on function public.add_employee_review_reply(uuid,text,uuid,text) to service_role;
grant execute on function public.resubmit_kdp_book_for_review(uuid,text,text) to service_role;
