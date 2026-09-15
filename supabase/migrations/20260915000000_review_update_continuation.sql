-- Decisions 58, 63, and 67: finalized review history is immutable. Employee
-- update activity lives in a separate continuation cycle and is linked into
-- the next active review round only when the employee resubmits.

alter table public.book_review_rounds
  add column if not exists reviewer_name_snapshot text,
  add column if not exists finalized_by_name text;

create table public.book_review_update_cycles (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books(id) on delete restrict,
  source_review_round_id uuid not null unique references public.book_review_rounds(id) on delete restrict,
  target_review_round_id uuid unique references public.book_review_rounds(id) on delete restrict,
  status text not null default 'active' check (status in ('active', 'consumed')),
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  unique (id, book_id),
  constraint book_review_update_cycle_consumption_complete check (
    (status = 'active' and target_review_round_id is null and consumed_at is null)
    or (status = 'consumed' and target_review_round_id is not null and consumed_at is not null)
  )
);

create table public.book_review_update_threads (
  id uuid primary key default gen_random_uuid(),
  update_cycle_id uuid not null references public.book_review_update_cycles(id) on delete restrict,
  book_id uuid not null references public.books(id) on delete restrict,
  source_review_round_id uuid not null references public.book_review_rounds(id) on delete restrict,
  source_round_number integer not null,
  source_review_item_id uuid not null references public.book_review_items(id) on delete restrict,
  source_comment_id uuid not null unique references public.book_review_comments(id) on delete restrict,
  step_name text not null check (step_name in ('details', 'content', 'pricing')),
  section_key text not null,
  request_body_snapshot text not null,
  request_number_snapshot integer,
  reviewer_user_id uuid references public.privileged_users(id) on delete restrict,
  reviewer_name_snapshot text,
  requested_at timestamptz not null,
  baseline_value jsonb,
  baseline_file_references jsonb not null default '[]'::jsonb,
  baseline_hash text not null,
  status text not null default 'active' check (status in ('active', 'consumed')),
  ready_via_reply boolean not null default false,
  ready_via_change boolean not null default false,
  ready_via_file_change boolean not null default false,
  readiness_evidence jsonb not null default '{}'::jsonb,
  ready_at timestamptz,
  target_review_round_id uuid references public.book_review_rounds(id) on delete restrict,
  target_review_item_id uuid references public.book_review_items(id) on delete restrict,
  target_comment_id uuid,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  unique (id, update_cycle_id, book_id),
  constraint book_review_update_thread_cycle_scope_fk
    foreign key (update_cycle_id, book_id) references public.book_review_update_cycles(id, book_id) on delete restrict,
  constraint book_review_update_thread_consumption_complete check (
    (status = 'active' and target_review_round_id is null and target_review_item_id is null and target_comment_id is null and consumed_at is null)
    or (status = 'consumed' and target_review_round_id is not null and target_review_item_id is not null and target_comment_id is not null and consumed_at is not null)
  )
);

create index book_review_update_threads_active_cycle
  on public.book_review_update_threads(update_cycle_id, step_name)
  where status = 'active';

create table public.book_review_update_replies (
  id uuid primary key default gen_random_uuid(),
  update_cycle_id uuid not null references public.book_review_update_cycles(id) on delete restrict,
  update_thread_id uuid not null references public.book_review_update_threads(id) on delete restrict,
  book_id uuid not null references public.books(id) on delete restrict,
  author_employee_token_id uuid not null references public.book_access_tokens(id) on delete restrict,
  source_historical_comment_id uuid unique references public.book_review_comments(id) on delete restrict,
  author_name_snapshot text,
  author_email_snapshot text,
  body text not null check (length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint book_review_update_reply_thread_scope_fk
    foreign key (update_thread_id, update_cycle_id, book_id)
    references public.book_review_update_threads(id, update_cycle_id, book_id) on delete restrict
);

create index book_review_update_replies_thread_time
  on public.book_review_update_replies(update_thread_id, created_at);

alter table public.book_review_update_cycles enable row level security;
alter table public.book_review_update_threads enable row level security;
alter table public.book_review_update_replies enable row level security;
revoke all on table public.book_review_update_cycles from public, anon, authenticated;
revoke all on table public.book_review_update_threads from public, anon, authenticated;
revoke all on table public.book_review_update_replies from public, anon, authenticated;
grant all on table public.book_review_update_cycles to service_role;
grant all on table public.book_review_update_threads to service_role;
grant all on table public.book_review_update_replies to service_role;

alter table public.book_review_comments
  add column if not exists continued_from_comment_id uuid references public.book_review_comments(id) on delete restrict,
  add column if not exists update_thread_id uuid references public.book_review_update_threads(id) on delete restrict;

create unique index book_review_comments_one_continued_issue
  on public.book_review_comments(update_thread_id);

alter table public.book_review_update_threads
  add constraint book_review_update_threads_target_comment_fk
  foreign key (target_comment_id) references public.book_review_comments(id) on delete restrict;

alter table public.book_review_audit_events
  add column if not exists update_cycle_id uuid references public.book_review_update_cycles(id) on delete restrict,
  add column if not exists update_thread_id uuid references public.book_review_update_threads(id) on delete restrict,
  add column if not exists update_reply_id uuid references public.book_review_update_replies(id) on delete restrict;

create or replace function public.prevent_consumed_review_update_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare v_cycle_status text;
begin
  if tg_table_name = 'book_review_update_cycles' then
    if tg_op = 'INSERT' then return new; end if;
    if tg_op = 'DELETE' or old.status = 'consumed' then raise exception 'Consumed employee update cycles are immutable.'; end if;
    return new;
  end if;
  if tg_table_name = 'book_review_update_replies' then
    if tg_op <> 'INSERT' then raise exception 'Employee update replies are immutable.'; end if;
    select status into v_cycle_status from public.book_review_update_cycles where id = new.update_cycle_id;
    if v_cycle_status <> 'active' then raise exception 'Employee update cycle is immutable.'; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    select status into v_cycle_status from public.book_review_update_cycles where id = new.update_cycle_id;
    if v_cycle_status <> 'active' then raise exception 'Employee update cycle is immutable.'; end if;
    return new;
  end if;
  if tg_op = 'DELETE' or old.status = 'consumed' then raise exception 'Consumed employee update threads are immutable.'; end if;
  return new;
end;
$$;

create trigger book_review_update_cycles_prevent_consumed_mutation
before update or delete on public.book_review_update_cycles
for each row execute function public.prevent_consumed_review_update_mutation();
create trigger book_review_update_threads_prevent_consumed_mutation
before insert or update or delete on public.book_review_update_threads
for each row execute function public.prevent_consumed_review_update_mutation();
create trigger book_review_update_replies_prevent_mutation
before insert or update or delete on public.book_review_update_replies
for each row execute function public.prevent_consumed_review_update_mutation();

create or replace function public.normalize_review_update_json(p_value jsonb)
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare v_type text; v_result jsonb;
begin
  if p_value is null then return 'null'::jsonb; end if;
  v_type := jsonb_typeof(p_value);
  if v_type = 'string' then return to_jsonb(btrim(p_value #>> '{}')); end if;
  if v_type = 'array' then
    select coalesce(jsonb_agg(public.normalize_review_update_json(value) order by ordinality), '[]'::jsonb)
      into v_result from jsonb_array_elements(p_value) with ordinality;
    return v_result;
  end if;
  if v_type = 'object' then
    select coalesce(jsonb_object_agg(key, public.normalize_review_update_json(value) order by key), '{}'::jsonb)
      into v_result from jsonb_each(p_value);
    return v_result;
  end if;
  return p_value;
end;
$$;

create or replace function public.review_update_evidence_hash(p_value jsonb, p_files jsonb)
returns text
language sql
immutable
set search_path = ''
as $$
  select md5(jsonb_build_object(
    'value', public.normalize_review_update_json(p_value),
    'file_references', public.normalize_review_update_json(coalesce(p_files, '[]'::jsonb))
  )::text)
$$;

create or replace function public.review_update_current_evidence(p_book_id uuid, p_item_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'value', coalesce(s.state_json->'sections'->i.section_key, s.state_json->'sections'->split_part(i.section_key, '.', 2)),
    'file_references', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', f.id,
        'version_number', f.version_number,
        'reviewstudio_file_id', f.reviewstudio_file_id,
        'reviewstudio_review_id', f.reviewstudio_review_id
      ) order by f.id)
      from public.book_files f
      where f.book_id = p_book_id
        and f.is_latest = true
        and f.section_key in (i.section_key, split_part(i.section_key, '.', 2))
    ), '[]'::jsonb)
  )
  from public.book_review_items i
  join public.book_step_data s on s.book_id = p_book_id and s.step_name = i.step_name
  where i.id = p_item_id and i.book_id = p_book_id
$$;

create or replace function public.ensure_review_update_cycle(p_review_round_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare v_round public.book_review_rounds%rowtype; v_cycle_id uuid;
begin
  select * into v_round from public.book_review_rounds where id = p_review_round_id;
  if v_round.id is null or v_round.finalized_at is null or v_round.outcome <> 'request_updates' then return null; end if;

  insert into public.book_review_update_cycles(book_id, source_review_round_id)
  values(v_round.book_id, v_round.id)
  on conflict(source_review_round_id) do update set book_id = excluded.book_id
  returning id into v_cycle_id;

  insert into public.book_review_update_threads(
    update_cycle_id, book_id, source_review_round_id, source_round_number,
    source_review_item_id, source_comment_id, step_name, section_key,
    request_body_snapshot, request_number_snapshot, reviewer_user_id,
    reviewer_name_snapshot, requested_at, baseline_value,
    baseline_file_references, baseline_hash
  )
  select v_cycle_id, v_round.book_id, v_round.id, v_round.round_number,
    i.id, c.id, i.step_name, i.section_key,
    coalesce(nullif(c.body, ''), c.comment_text), c.round_comment_number,
    c.author_privileged_user_id,
    coalesce(c.admin_name, v_round.reviewer_name_snapshot), c.created_at,
    coalesce(i.section_snapshot->'submitted_step'->'sections'->i.section_key,
      i.section_snapshot->'submitted_step'->'sections'->split_part(i.section_key, '.', 2),
      i.section_snapshot->'value'),
    coalesce(i.section_snapshot->'file_references', '[]'::jsonb),
    public.review_update_evidence_hash(
      coalesce(i.section_snapshot->'submitted_step'->'sections'->i.section_key,
        i.section_snapshot->'submitted_step'->'sections'->split_part(i.section_key, '.', 2),
        i.section_snapshot->'value'),
      coalesce(i.section_snapshot->'file_references', '[]'::jsonb)
    )
  from public.book_review_items i
  join public.book_review_comments c on c.review_item_id = i.id
  where i.review_round_id = v_round.id
    and i.decision = 'needs_updates'
    and c.review_round_id = v_round.id
    and c.actionable = true
    and c.parent_comment_id is null
    and c.resolved_at is null
    and c.deleted_at is null
  on conflict(source_comment_id) do nothing;
  return v_cycle_id;
end;
$$;

create or replace function public.create_review_update_cycle_after_finalization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.outcome = 'request_updates' then perform public.ensure_review_update_cycle(new.id); end if;
  return new;
end;
$$;

create trigger book_review_rounds_create_update_cycle
after update of finalized_at, outcome on public.book_review_rounds
for each row
when (old.finalized_at is null and new.finalized_at is not null)
execute function public.create_review_update_cycle_after_finalization();

-- Backfill only continuation pointers for already-finalized Request Updates
-- rounds. No finalized review row is modified.
do $$
declare v_round_id uuid;
begin
  for v_round_id in
    select r.id from public.book_review_rounds r
    join public.books b on b.id = r.book_id and b.latest_review_round_id = r.id
    where r.finalized_at is not null and r.outcome = 'request_updates'
      and b.overall_status::text in ('needs_updates', 'EMPLOYEE_UPDATES')
  loop
    perform public.ensure_review_update_cycle(v_round_id);
  end loop;
end;
$$;

-- Preserve any employee replies written by the superseded implementation as
-- continuation evidence without changing or deleting their historical rows.
insert into public.book_review_update_replies(
  update_cycle_id, update_thread_id, book_id, author_employee_token_id,
  source_historical_comment_id, author_name_snapshot, author_email_snapshot,
  body, created_at
)
select t.update_cycle_id, t.id, t.book_id, reply.author_employee_token_id,
  reply.id, reply.admin_name, reply.admin_email,
  coalesce(nullif(reply.body, ''), reply.comment_text), reply.created_at
from public.book_review_update_threads t
join public.book_review_comments reply on reply.parent_comment_id=t.source_comment_id
where t.status='active' and reply.author_actor_type='employee'
  and reply.author_employee_token_id is not null and reply.deleted_at is null
on conflict(source_historical_comment_id) do nothing;

-- No operation, including an employee reply, may mutate a finalized round.
create or replace function public.prevent_finalized_review_mutation()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_round_id uuid; v_finalized_at timestamptz;
begin
  if tg_table_name = 'book_review_rounds' then
    if tg_op = 'INSERT' then return new; end if;
    v_finalized_at := old.finalized_at;
  else
    v_round_id := case when tg_op = 'DELETE' then old.review_round_id else new.review_round_id end;
    select finalized_at into v_finalized_at from public.book_review_rounds where id = v_round_id;
  end if;
  if v_finalized_at is not null then raise exception 'Finalized review rounds and their history are immutable.'; end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.add_employee_review_reply(p_book_id uuid,p_token_hash text,p_comment_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_token public.book_access_tokens%rowtype;
  v_book public.books%rowtype;
  v_cycle public.book_review_update_cycles%rowtype;
  v_thread public.book_review_update_threads%rowtype;
  v_reply public.book_review_update_replies%rowtype;
begin
  select * into v_book from public.books where id=p_book_id and overall_status::text in ('needs_updates','EMPLOYEE_UPDATES') and deleted_at is null for update;
  select * into v_token from public.book_access_tokens where token_hash=p_token_hash and book_id=p_book_id and role::text='employee' and revoked_at is null and (expires_at is null or expires_at>now()) and metadata->>'token_kind'='book_specific' and 'reply_to_review'=any(allowed_actions) for update;
  if v_book.id is null or v_token.id is null then raise exception 'Employee reply is not authorized.'; end if;

  select cy.* into v_cycle
  from public.book_review_update_cycles cy
  where cy.book_id=p_book_id and cy.source_review_round_id=v_book.latest_review_round_id and cy.status='active'
  for update;
  select t.* into v_thread
  from public.book_review_update_threads t
  join public.book_review_items i on i.id=t.source_review_item_id and i.book_id=p_book_id and i.review_round_id=t.source_review_round_id and i.decision='needs_updates'
  join public.book_review_comments c on c.id=t.source_comment_id and c.book_id=p_book_id and c.review_round_id=t.source_review_round_id and c.review_item_id=i.id and c.actionable=true and c.parent_comment_id is null and c.deleted_at is null
  where t.update_cycle_id=v_cycle.id and t.source_comment_id=p_comment_id and t.book_id=p_book_id and t.status='active'
  for update;
  if v_cycle.id is null or v_thread.id is null or nullif(btrim(p_body),'') is null or length(p_body)>2000 then raise exception 'Employee reply is invalid.'; end if;

  insert into public.book_review_update_replies(update_cycle_id,update_thread_id,book_id,author_employee_token_id,author_name_snapshot,author_email_snapshot,body)
  values(v_cycle.id,v_thread.id,p_book_id,v_token.id,v_token.employee_name,v_token.employee_email,btrim(p_body)) returning * into v_reply;
  insert into public.book_review_audit_events(book_id,review_round_id,review_item_id,comment_id,update_cycle_id,update_thread_id,update_reply_id,action,actor_type,actor_employee_token_id)
  values(p_book_id,v_thread.source_review_round_id,v_thread.source_review_item_id,v_thread.source_comment_id,v_cycle.id,v_thread.id,v_reply.id,'employee_update_reply','employee',v_token.id);
  return jsonb_build_object('ok',true,'reply_id',v_reply.id,'continuation_id',v_thread.id,'ready_for_rereview',true);
end;
$$;

create or replace function public.finalize_kdp_review_round(p_book_id uuid, p_review_round_id uuid, p_actor_user_id uuid, p_outcome text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_book public.books%rowtype; v_round public.book_review_rounds%rowtype;
  v_target text; v_ref public.basecamp_references%rowtype; v_actor_name text; v_reviewer_name text; v_expected_outcome text;
begin
  if p_outcome not in ('request_updates','approve_book') then raise exception 'Review outcome is invalid.'; end if;
  select coalesce(u.display_name,u.email_snapshot,'Reviewer') into v_actor_name from public.privileged_users u
  where u.id=p_actor_user_id and u.disabled_at is null
    and exists(select 1 from public.privileged_user_capability_grants g where g.privileged_user_id=u.id and g.capability_key='can_finalize_book' and g.revoked_at is null);
  if v_actor_name is null then raise exception 'Book finalization is not authorized.'; end if;
  select * into v_book from public.books where id = p_book_id and deleted_at is null for update;
  select * into v_round from public.book_review_rounds where id = p_review_round_id and book_id = p_book_id for update;
  if v_book.id is null or v_round.id is null then raise exception 'Active review round is unavailable.'; end if;
  if v_round.reviewer_user_id is distinct from p_actor_user_id and not exists (select 1 from public.privileged_user_capability_grants g where g.privileged_user_id=p_actor_user_id and g.capability_key in ('can_reassign_reviewer','can_manage_users') and g.revoked_at is null) then raise exception 'Review finalization is not assigned or authorized.'; end if;
  select coalesce(u.display_name,u.email_snapshot,'Reviewer') into v_reviewer_name from public.privileged_users u where u.id=v_round.reviewer_user_id;
  v_expected_outcome := case when p_outcome='approve_book' then 'approved' else 'request_updates' end;
  if v_round.finalized_at is not null then
    if v_round.outcome=v_expected_outcome then
      return jsonb_build_object('ok',true,'outcome',p_outcome,'overall_status',case when p_outcome='approve_book' then 'KDP_INTAKE_APPROVED' else 'EMPLOYEE_UPDATES' end,'review_round_id',p_review_round_id,'replayed',true);
    end if;
    raise exception 'Review round is immutable.';
  end if;
  if v_book.latest_review_round_id is distinct from v_round.id then raise exception 'Active review round is unavailable.'; end if;
  if exists (select 1 from public.book_review_items where review_round_id=p_review_round_id and is_reviewable=true and decision='pending') then raise exception 'Required review sections are still pending.'; end if;
  if p_outcome='request_updates' then
    if not exists (select 1 from public.book_review_items where review_round_id=p_review_round_id and is_reviewable=true and decision='needs_updates') then raise exception 'Request Updates requires at least one requested change.'; end if;
    if exists (
      select 1 from public.book_review_items i
      where i.review_round_id=p_review_round_id and i.is_reviewable=true and i.decision='needs_updates'
        and not exists (
          select 1 from public.book_review_comments c where c.review_item_id=i.id
            and c.review_round_id=p_review_round_id and c.actionable=true
            and c.parent_comment_id is null and c.resolved_at is null and c.deleted_at is null
        )
    ) then raise exception 'Every requested-update section requires an active actionable issue.'; end if;
    v_target := 'EMPLOYEE_UPDATES';
    update public.book_access_tokens set allowed_actions=(select array_agg(distinct action_name) from unnest(allowed_actions || array['reply_to_review','resubmit_for_review']) action_name), updated_at=now() where book_id=p_book_id and role::text='employee' and revoked_at is null and metadata->>'token_kind'='book_specific';
  else
    if exists (select 1 from public.book_review_items i where i.review_round_id=p_review_round_id and i.is_reviewable=true and (i.decision<>'approved' or exists (select 1 from public.book_review_comments c where c.review_item_id=i.id and c.actionable and c.parent_comment_id is null and c.resolved_at is null and c.deleted_at is null))) then raise exception 'All required sections must be approved.'; end if;
    v_target := 'KDP_INTAKE_APPROVED';
  end if;
  update public.book_review_rounds set outcome=v_expected_outcome, finalized_at=now(), finalized_by_user_id=p_actor_user_id, finalized_by_name=v_actor_name, reviewer_name_snapshot=coalesce(reviewer_name_snapshot,v_reviewer_name), employee_updates_started_at=case when p_outcome='request_updates' then now() else null end where id=p_review_round_id;
  update public.books set overall_status=v_target::public.kdp_book_status, current_employee_step=case when p_outcome='request_updates' then 'details' else current_employee_step end, updated_at=now(), last_modified_at=now() where id=p_book_id;
  insert into public.book_status_history(book_id,review_round_id,action,actor_type,actor_privileged_user_id,from_status,to_status,note,metadata) values(p_book_id,p_review_round_id,p_outcome,'admin',p_actor_user_id,v_book.overall_status,v_target,case when p_outcome='approve_book' then 'KDP Intake approved; not an Amazon publication event.' else 'Updates requested from employee.' end,'{}');
  insert into public.book_review_audit_events(book_id,review_round_id,action,actor_type,actor_privileged_user_id,from_state,to_state) values(p_book_id,p_review_round_id,p_outcome,'privileged',p_actor_user_id,jsonb_build_object('book_status',v_book.overall_status),jsonb_build_object('book_status',v_target));
  select * into v_ref from public.basecamp_references where book_id=p_book_id and review_round_id=p_review_round_id and reference_kind='review_round';
  if p_outcome='request_updates' and v_ref.id is not null then insert into public.basecamp_references(book_id,review_round_id,account_id,project_id,bucket_id,reference_kind,todo_list_id,idempotency_key,provisioning_status,metadata) values(p_book_id,p_review_round_id,v_ref.account_id,v_ref.project_id,v_ref.bucket_id,'employee_update',v_ref.todo_list_id,'basecamp:employee-update:'||p_review_round_id::text,'pending',jsonb_build_object('round_number',v_round.round_number)) on conflict(idempotency_key) do nothing; end if;
  if p_outcome='approve_book' and v_ref.id is not null then update public.basecamp_references set provisioning_status='pending', last_provisioning_error=null where id=v_ref.id; end if;
  insert into public.integration_events(provider,event_type,book_id,review_round_id,status,payload_json,metadata) values('basecamp','review_outcome_sync_requested',p_book_id,p_review_round_id,'pending',jsonb_build_object('outcome',p_outcome),'{}');
  return jsonb_build_object('ok',true,'outcome',p_outcome,'overall_status',v_target,'review_round_id',p_review_round_id,'replayed',false);
end;
$$;

create or replace function public.resubmit_kdp_book_for_review(p_book_id uuid,p_token_hash text,p_update_cycle_id uuid,p_source text default 'employee_resubmit')
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_book public.books%rowtype; v_token public.book_access_tokens%rowtype;
  v_old public.book_review_rounds%rowtype; v_new public.book_review_rounds%rowtype;
  v_cycle public.book_review_update_cycles%rowtype; v_replay public.book_review_update_cycles%rowtype;
  v_snapshot jsonb; v_count int; v_book_ref public.basecamp_references%rowtype;
  v_thread public.book_review_update_threads%rowtype; v_target_item_id uuid; v_target_comment_id uuid; v_number int; v_reviewer_id uuid;
begin
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_token from public.book_access_tokens where token_hash=p_token_hash and book_id=p_book_id and role::text='employee' and revoked_at is null and (expires_at is null or expires_at>now()) and metadata->>'token_kind'='book_specific' and 'resubmit_for_review'=any(allowed_actions) for update;
  if v_book.id is null or v_token.id is null then raise exception 'Resubmission is not authorized.'; end if;

  select cy.* into v_replay from public.book_review_update_cycles cy where cy.id=p_update_cycle_id and cy.book_id=p_book_id and cy.status='consumed' and cy.target_review_round_id=v_book.latest_review_round_id;
  if v_replay.id is not null and v_book.overall_status::text in ('for_approval','AWAITING_REVIEW','in_admin_review','IN_REVIEW') then
    select * into v_new from public.book_review_rounds where id=v_replay.target_review_round_id;
    return jsonb_build_object('ok',true,'review_round_id',v_new.id,'round_number',v_new.round_number,'overall_status',v_book.overall_status,'replayed',true);
  end if;
  if v_book.overall_status::text not in ('needs_updates','EMPLOYEE_UPDATES') then raise exception 'Resubmission is not authorized.'; end if;
  select * into v_old from public.book_review_rounds where id=v_book.latest_review_round_id and book_id=p_book_id and outcome='request_updates' and finalized_at is not null;
  select * into v_cycle from public.book_review_update_cycles where id=p_update_cycle_id and book_id=p_book_id and source_review_round_id=v_old.id and status='active' for update;
  if v_old.id is null or v_cycle.id is null then raise exception 'Employee update cycle is unavailable.'; end if;
  if not exists(select 1 from public.book_review_update_threads where update_cycle_id=v_cycle.id and status='active') then raise exception 'Requested update continuation is unavailable.'; end if;

  if exists (
    select 1 from public.book_review_update_threads t
    cross join lateral (select public.review_update_current_evidence(p_book_id,t.source_review_item_id) as evidence) current_state
    where t.update_cycle_id=v_cycle.id and t.status='active' and not (
      exists(select 1 from public.book_review_update_replies reply where reply.update_thread_id=t.id and reply.created_at>t.requested_at)
      or public.normalize_review_update_json(current_state.evidence->'value') is distinct from public.normalize_review_update_json(t.baseline_value)
      or public.normalize_review_update_json(current_state.evidence->'file_references') is distinct from public.normalize_review_update_json(t.baseline_file_references)
    )
  ) then raise exception 'All requested updates require a meaningful change or employee reply.'; end if;
  if exists(select 1 from public.book_step_data where book_id=p_book_id and (is_complete is not true or validation_errors is distinct from '{}'::jsonb)) then raise exception 'Complete all employee steps before resubmitting.'; end if;

  update public.book_review_update_threads t set
    ready_via_reply=exists(select 1 from public.book_review_update_replies reply where reply.update_thread_id=t.id and reply.created_at>t.requested_at),
    ready_via_change=public.normalize_review_update_json((public.review_update_current_evidence(p_book_id,t.source_review_item_id))->'value') is distinct from public.normalize_review_update_json(t.baseline_value),
    ready_via_file_change=public.normalize_review_update_json((public.review_update_current_evidence(p_book_id,t.source_review_item_id))->'file_references') is distinct from public.normalize_review_update_json(t.baseline_file_references),
    readiness_evidence=public.review_update_current_evidence(p_book_id,t.source_review_item_id), ready_at=now()
  where t.update_cycle_id=v_cycle.id and t.status='active';

  select jsonb_build_object('schema_version',1,'book',to_jsonb(v_book)-'metadata','steps',coalesce(jsonb_object_agg(s.step_name::text,jsonb_build_object('state_json',s.state_json,'extracted_fields',s.extracted_fields,'validation_errors',s.validation_errors,'saved_at',s.saved_at)),'{}'::jsonb),'files',coalesce((select jsonb_agg(to_jsonb(f)-'metadata') from public.book_files f where f.book_id=p_book_id and f.is_latest=true),'[]'::jsonb)) into v_snapshot from public.book_step_data s where s.book_id=p_book_id;
  select u.id into v_reviewer_id from public.privileged_users u
  where u.id=v_old.reviewer_user_id and u.disabled_at is null
    and exists(select 1 from public.privileged_user_capability_grants g where g.privileged_user_id=u.id and g.capability_key='can_review' and g.revoked_at is null);
  insert into public.book_review_rounds(book_id,round_number,status,submitted_at,submitted_by_actor_type,submitted_by_email,submitted_by_name,reviewer_user_id,reviewer_assignment_source,reviewer_assigned_at,reviewer_name_snapshot,submission_snapshot,previous_round_id,metadata)
  values(p_book_id,v_old.round_number+1,'submitted',now(),'employee',v_token.employee_email,v_token.employee_name,
    v_reviewer_id,case when v_reviewer_id is null then null else 'inherited' end,case when v_reviewer_id is null then null else now() end,
    case when v_reviewer_id is null then null else v_old.reviewer_name_snapshot end,v_snapshot,v_old.id,jsonb_build_object('source',p_source,'update_cycle_id',v_cycle.id)) returning * into v_new;

  insert into public.book_review_items(book_id,review_round_id,step_name,section_key,section_label,sort_order,is_file_section,is_reviewable,section_snapshot,decision,decision_at,decision_source,carried_from_review_item_id,metadata)
  select p_book_id,v_new.id,d.step_name,d.section_key,d.section_label,d.sort_order,d.is_file_section,d.is_reviewable,
    jsonb_build_object('submitted_step',s.state_json,'submitted_extracted_fields',s.extracted_fields,'value',current_value.value,'file_references',current_files.value),
    case when carry.carries then 'approved' else 'pending' end,case when carry.carries then now() else null end,
    case when carry.carries then 'carried_forward' else null end,case when carry.carries then old.id else null end,
    jsonb_build_object('snapshot_schema_version',1)
  from public.book_section_definitions d
  join public.book_step_data s on s.book_id=p_book_id and s.step_name=d.step_name
  left join public.book_review_items old on old.review_round_id=v_old.id and old.section_key=d.section_key
  cross join lateral (select coalesce(s.state_json->'sections'->d.section_key, s.state_json->'sections'->split_part(d.section_key, '.', 2)) as value) current_value
  cross join lateral (select coalesce((select jsonb_agg(jsonb_build_object('id',f.id,'version_number',f.version_number,'reviewstudio_file_id',f.reviewstudio_file_id,'reviewstudio_review_id',f.reviewstudio_review_id) order by f.id) from public.book_files f where f.book_id=p_book_id and f.is_latest=true and f.section_key in (d.section_key,split_part(d.section_key,'.',2))),'[]'::jsonb) as value) current_files
  cross join lateral (select old.decision='approved' and old.reopened_at is null and public.normalize_review_update_json(coalesce(old.section_snapshot->'submitted_step'->'sections'->d.section_key, old.section_snapshot->'submitted_step'->'sections'->split_part(d.section_key, '.', 2)))=public.normalize_review_update_json(current_value.value) and (not d.is_file_section or public.normalize_review_update_json(old.section_snapshot->'file_references')=public.normalize_review_update_json(current_files.value)) and (d.step_name::text <> 'pricing' or not exists (select 1 from public.book_review_items dep where dep.review_round_id=v_old.id and dep.decision<>'approved' and (dep.is_file_section=true or split_part(dep.section_key,'.',2)='primary_marketplace'))) as carries) carry
  where d.is_reviewable=true;
  get diagnostics v_count=row_count;

  for v_thread in select * from public.book_review_update_threads where update_cycle_id=v_cycle.id and status='active' order by requested_at,id loop
    select i.id into v_target_item_id from public.book_review_items i where i.review_round_id=v_new.id and i.section_key=v_thread.section_key;
    if v_target_item_id is null then raise exception 'Requested update target section is unavailable.'; end if;
    select coalesce(max(round_comment_number),0)+1 into v_number from public.book_review_comments where review_round_id=v_new.id and parent_comment_id is null;
    insert into public.book_review_comments(book_id,review_round_id,review_item_id,body,comment_text,admin_name,round_comment_number,author_actor_type,author_privileged_user_id,actionable,continued_from_comment_id,update_thread_id)
    values(p_book_id,v_new.id,v_target_item_id,v_thread.request_body_snapshot,v_thread.request_body_snapshot,v_thread.reviewer_name_snapshot,v_number,'privileged',v_thread.reviewer_user_id,true,v_thread.source_comment_id,v_thread.id)
    on conflict(update_thread_id) do nothing returning id into v_target_comment_id;
    if v_target_comment_id is null then select id into v_target_comment_id from public.book_review_comments where update_thread_id=v_thread.id; end if;
    update public.book_review_items set decision='needs_updates',decision_at=now(),decision_source='continued_request',update_baseline_hash=public.review_update_evidence_hash((v_thread.readiness_evidence->'value'),(v_thread.readiness_evidence->'file_references')) where id=v_target_item_id;
    update public.book_review_update_threads set status='consumed',consumed_at=now(),target_review_round_id=v_new.id,target_review_item_id=v_target_item_id,target_comment_id=v_target_comment_id where id=v_thread.id;
  end loop;

  update public.book_review_update_cycles set status='consumed',consumed_at=now(),target_review_round_id=v_new.id where id=v_cycle.id;
  update public.books set latest_review_round_id=v_new.id,overall_status='AWAITING_REVIEW',assigned_reviewer_user_id=v_new.reviewer_user_id,updated_at=now(),last_modified_at=now() where id=p_book_id;
  insert into public.book_status_history(book_id,review_round_id,action,actor_type,actor_name,actor_email,from_status,to_status,note,metadata) values(p_book_id,v_new.id,'resubmitted_for_approval','employee',v_token.employee_name,v_token.employee_email,v_book.overall_status,'AWAITING_REVIEW','Employee updates resubmitted.',jsonb_build_object('previous_round_id',v_old.id,'update_cycle_id',v_cycle.id));
  select * into v_book_ref from public.basecamp_references where book_id=p_book_id and reference_kind='book_todo_list';
  if v_book_ref.id is not null then insert into public.basecamp_references(book_id,review_round_id,account_id,project_id,bucket_id,reference_kind,todo_list_id,idempotency_key,provisioning_status,metadata) values(p_book_id,v_new.id,v_book_ref.account_id,v_book_ref.project_id,v_book_ref.bucket_id,'review_round',v_book_ref.todo_list_id,'basecamp:review-round:'||v_new.id::text,'pending',jsonb_build_object('round_number',v_new.round_number)) on conflict(idempotency_key) do nothing; end if;
  insert into public.integration_events(provider,event_type,book_id,review_round_id,status,payload_json,metadata) values('basecamp','review_round_provisioning_requested',p_book_id,v_new.id,'pending',jsonb_build_object('previous_round_id',v_old.id,'update_cycle_id',v_cycle.id),'{}');
  return jsonb_build_object('ok',true,'review_round_id',v_new.id,'round_number',v_new.round_number,'review_item_count',v_count,'overall_status','AWAITING_REVIEW','replayed',false);
end;
$$;

revoke all on function public.normalize_review_update_json(jsonb) from public, anon, authenticated;
revoke all on function public.review_update_evidence_hash(jsonb,jsonb) from public, anon, authenticated;
revoke all on function public.review_update_current_evidence(uuid,uuid) from public, anon, authenticated;
revoke all on function public.ensure_review_update_cycle(uuid) from public, anon, authenticated;
revoke all on function public.add_employee_review_reply(uuid,text,uuid,text) from public, anon, authenticated;
revoke all on function public.finalize_kdp_review_round(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.resubmit_kdp_book_for_review(uuid,text,text) from public, anon, authenticated;
revoke all on function public.resubmit_kdp_book_for_review(uuid,text,text) from service_role;
revoke all on function public.resubmit_kdp_book_for_review(uuid,text,uuid,text) from public, anon, authenticated;
grant execute on function public.add_employee_review_reply(uuid,text,uuid,text) to service_role;
grant execute on function public.finalize_kdp_review_round(uuid,uuid,uuid,text) to service_role;
grant execute on function public.resubmit_kdp_book_for_review(uuid,text,uuid,text) to service_role;
