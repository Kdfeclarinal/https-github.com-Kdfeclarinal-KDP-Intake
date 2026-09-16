-- Decisions 20, 35, 41, 65, and 67: explicit employee correction reopens and
-- privileged Trash/Recover operations. This is a forward-only local migration;
-- applying it remains an operator-controlled activation step.

create table public.book_review_update_reopens (
  id uuid primary key default gen_random_uuid(),
  update_cycle_id uuid not null references public.book_review_update_cycles(id) on delete restrict,
  book_id uuid not null references public.books(id) on delete restrict,
  source_review_round_id uuid not null references public.book_review_rounds(id) on delete restrict,
  source_item_id uuid not null references public.book_review_items(id) on delete restrict,
  step_name text not null check (step_name in ('details','content','pricing')),
  section_key text not null,
  reason text not null check (length(btrim(reason)) between 1 and 1000),
  employee_token_id uuid not null references public.book_access_tokens(id) on delete restrict,
  employee_name_snapshot text,
  employee_email_snapshot text,
  reopened_at timestamptz not null default now(),
  unique (update_cycle_id, source_item_id),
  constraint book_review_update_reopen_cycle_scope_fk
    foreign key (update_cycle_id, book_id) references public.book_review_update_cycles(id, book_id) on delete restrict
);

alter table public.book_review_update_reopens enable row level security;
revoke all on table public.book_review_update_reopens from public, anon, authenticated;
grant all on table public.book_review_update_reopens to service_role;

create or replace function public.prevent_review_update_reopen_mutation()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  raise exception 'Employee correction reopen records are immutable.';
end;
$$;

create trigger book_review_update_reopens_immutable
before update or delete on public.book_review_update_reopens
for each row execute function public.prevent_review_update_reopen_mutation();

create or replace function public.reopen_employee_review_section(
  p_book_id uuid,
  p_token_hash text,
  p_update_cycle_id uuid,
  p_section_key text,
  p_reason text,
  p_expected_revision bigint
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_book public.books%rowtype;
  v_token public.book_access_tokens%rowtype;
  v_cycle public.book_review_update_cycles%rowtype;
  v_item public.book_review_items%rowtype;
  v_reopen public.book_review_update_reopens%rowtype;
  v_revision bigint;
begin
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_token from public.book_access_tokens where token_hash=p_token_hash and book_id=p_book_id for update;
  if v_book.id is null or v_token.id is null or v_token.role::text <> 'employee'
     or v_token.revoked_at is not null or (v_token.expires_at is not null and v_token.expires_at <= now())
     or v_token.metadata->>'token_kind' is distinct from 'book_specific'
     or not ('reply_to_review'=any(coalesce(v_token.allowed_actions,array[]::text[]))) then
    raise exception 'Employee correction reopen is not authorized.';
  end if;
  if v_book.overall_status::text not in ('needs_updates','EMPLOYEE_UPDATES') then
    raise exception 'This book is not in Employee Updates.';
  end if;
  if p_expected_revision is null or v_book.employee_revision is distinct from p_expected_revision then
    raise exception using errcode='40001', message='Book changed elsewhere.';
  end if;
  select * into v_cycle from public.book_review_update_cycles
    where id=p_update_cycle_id and book_id=p_book_id and source_review_round_id=v_book.latest_review_round_id and status='active' for update;
  if v_cycle.id is null then raise exception 'The active update cycle is unavailable.'; end if;
  select * into v_item from public.book_review_items
    where review_round_id=v_cycle.source_review_round_id and book_id=p_book_id
      and (section_key=p_section_key or split_part(section_key,'.',2)=split_part(p_section_key,'.',2))
      and decision='approved' and is_reviewable=true;
  if v_item.id is null then raise exception 'Only an approved section may be reopened.'; end if;
  insert into public.book_review_update_reopens(update_cycle_id,book_id,source_review_round_id,source_item_id,step_name,section_key,reason,employee_token_id,employee_name_snapshot,employee_email_snapshot)
    values(v_cycle.id,p_book_id,v_cycle.source_review_round_id,v_item.id,v_item.step_name::text,v_item.section_key,btrim(p_reason),v_token.id,v_token.employee_name,v_token.employee_email)
    on conflict(update_cycle_id,source_item_id) do nothing returning * into v_reopen;
  if v_reopen.id is null then
    select * into v_reopen from public.book_review_update_reopens where update_cycle_id=v_cycle.id and source_item_id=v_item.id;
  else
    if split_part(v_item.section_key,'.',2)='primary_marketplace' then
      insert into public.book_review_update_reopens(update_cycle_id,book_id,source_review_round_id,source_item_id,step_name,section_key,reason,employee_token_id,employee_name_snapshot,employee_email_snapshot)
        select v_cycle.id,p_book_id,v_cycle.source_review_round_id,i.id,i.step_name::text,i.section_key,
          left('Automatically reopened because Primary marketplace was reopened: '||btrim(p_reason),1000),v_token.id,v_token.employee_name,v_token.employee_email
        from public.book_review_items i
        where i.review_round_id=v_cycle.source_review_round_id and i.book_id=p_book_id and i.step_name::text='pricing' and i.decision='approved' and i.is_reviewable=true
        on conflict(update_cycle_id,source_item_id) do nothing;
    end if;
    update public.books set employee_revision=employee_revision+1,updated_at=now(),last_modified_at=now()
      where id=p_book_id returning employee_revision into v_revision;
  end if;
  return jsonb_build_object('ok',true,'reopen_id',v_reopen.id,'section_key',v_reopen.section_key,'employee_revision',coalesce(v_revision,v_book.employee_revision));
end;
$$;

revoke all on function public.reopen_employee_review_section(uuid,text,uuid,text,text,bigint) from public,anon,authenticated;
grant execute on function public.reopen_employee_review_section(uuid,text,uuid,text,text,bigint) to service_role;

-- If an approved historical section was explicitly reopened, only the new
-- round's item loses carry-forward approval. The finalized source item is never
-- updated.
create or replace function public.invalidate_reopened_review_item_carry()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if new.carried_from_review_item_id is not null and exists (
    select 1 from public.book_review_update_reopens r
    join public.book_review_update_cycles c on c.id=r.update_cycle_id
    join public.book_review_rounds nr on nr.id=new.review_round_id
    where r.source_item_id=new.carried_from_review_item_id and r.book_id=new.book_id
      and c.source_review_round_id=nr.previous_round_id
  ) then
    new.decision := 'pending';
    new.decision_at := null;
    new.decision_by_user_id := null;
    new.decision_source := 'employee_reopened';
    new.carried_from_review_item_id := null;
  end if;
  return new;
end;
$$;

create trigger book_review_items_invalidate_employee_reopen_carry
before insert on public.book_review_items
for each row execute function public.invalidate_reopened_review_item_carry();

alter table public.books
  add column if not exists deleted_by_privileged_user_id uuid references public.privileged_users(id) on delete restrict,
  add column if not exists deleted_previous_status text,
  add column if not exists trash_revision bigint not null default 0;

comment on column public.books.deleted_previous_status is 'Audit snapshot of the canonical status at soft deletion; recovery does not invent a replacement workflow state.';

create or replace function public.set_kdp_book_trash_state(
  p_book_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_expected_revision bigint,
  p_reason text,
  p_recovery_token_hash text default null,
  p_recovery_token_prefix text default null
) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_book public.books%rowtype;
  v_actor public.privileged_users%rowtype;
  v_token public.book_access_tokens%rowtype;
  v_has_basecamp boolean;
begin
  select * into v_actor from public.privileged_users where id=p_actor_user_id and disabled_at is null;
  if v_actor.id is null or v_actor.role_key not in ('owner','tech_admin')
     or not exists(select 1 from public.privileged_user_capability_grants g where g.privileged_user_id=v_actor.id and g.capability_key='can_manage_users' and g.revoked_at is null) then
    raise exception 'Trash management is not authorized.';
  end if;
  select * into v_book from public.books where id=p_book_id for update;
  if v_book.id is null then raise exception 'Book not found.'; end if;
  if p_expected_revision is null or v_book.trash_revision is distinct from p_expected_revision then
    raise exception using errcode='40001',message='Book trash state changed elsewhere.';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'A reason is required.'; end if;
  v_has_basecamp := exists(select 1 from public.basecamp_references r where r.book_id=p_book_id and r.provisioning_status='ready');
  if p_action='trash' then
    if v_book.deleted_at is not null then return jsonb_build_object('ok',true,'deleted',true,'trash_revision',v_book.trash_revision); end if;
    update public.books set deleted_at=now(),deleted_by_privileged_user_id=v_actor.id,deleted_previous_status=overall_status::text,trash_revision=trash_revision+1,updated_at=now(),last_modified_at=now() where id=p_book_id;
    update public.book_access_tokens set revoked_at=coalesce(revoked_at,now()),updated_at=now() where book_id=p_book_id and role::text='employee';
    insert into public.book_status_history(book_id,action,actor_type,actor_privileged_user_id,from_status,to_status,note,metadata)
      values(p_book_id,'book_trashed','admin',v_actor.id,v_book.overall_status,v_book.overall_status,btrim(p_reason),jsonb_build_object('basecamp_sync_required',v_has_basecamp));
    if v_has_basecamp then
      insert into public.integration_events(provider,event_type,book_id,status,payload_json,metadata)
        values('basecamp','book_trash_sync_requested',p_book_id,'pending',jsonb_build_object('deleted',true),jsonb_build_object('actor_privileged_user_id',v_actor.id,'operator_intervention_required',true));
    end if;
  elsif p_action='recover' then
    if v_book.deleted_at is null then return jsonb_build_object('ok',true,'deleted',false,'trash_revision',v_book.trash_revision); end if;
    update public.books set deleted_at=null,deleted_by_privileged_user_id=null,trash_revision=trash_revision+1,updated_at=now(),last_modified_at=now() where id=p_book_id;
    if v_book.overall_status::text in ('draft','EMPLOYEE_INTAKE','needs_updates','EMPLOYEE_UPDATES') and nullif(p_recovery_token_hash,'') is not null then
      insert into public.book_access_tokens(role,book_id,token_hash,token_prefix,employee_name,employee_email,basecamp_person_id,created_by_email,created_by_name,allowed_pages,allowed_actions,metadata)
        values('employee',p_book_id,p_recovery_token_hash,p_recovery_token_prefix,v_book.employee_name,v_book.employee_email,v_book.employee_basecamp_person_id,v_actor.email_snapshot,v_actor.display_name,array['details','content','pricing'],case when v_book.overall_status::text in ('needs_updates','EMPLOYEE_UPDATES') then array['load_employee_page','save_employee_step','complete_employee_step','upload_content_file_to_reviewstudio','reply_to_review','resubmit_for_review'] else array['load_employee_page','save_employee_step','complete_employee_step','upload_content_file_to_reviewstudio','submit_for_approval'] end,jsonb_build_object('token_kind','book_specific','purpose','employee Kindle eBook intake','source','book_recovery'))
        returning * into v_token;
    end if;
    insert into public.book_status_history(book_id,action,actor_type,actor_privileged_user_id,from_status,to_status,note,metadata)
      values(p_book_id,'book_recovered','admin',v_actor.id,v_book.overall_status,v_book.overall_status,btrim(p_reason),jsonb_build_object('basecamp_sync_required',v_has_basecamp,'employee_access_reestablished',v_token.id is not null));
    if v_has_basecamp then
      insert into public.integration_events(provider,event_type,book_id,status,payload_json,metadata)
        values('basecamp','book_recovery_sync_requested',p_book_id,'pending',jsonb_build_object('deleted',false),jsonb_build_object('actor_privileged_user_id',v_actor.id,'operator_intervention_required',true));
    end if;
  else
    raise exception 'Unsupported trash action.';
  end if;
  select * into v_book from public.books where id=p_book_id;
  return jsonb_build_object('ok',true,'deleted',v_book.deleted_at is not null,'trash_revision',v_book.trash_revision,'employee_access_reestablished',v_token.id is not null,'basecamp_sync_required',v_has_basecamp);
end;
$$;

revoke all on function public.set_kdp_book_trash_state(uuid,uuid,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.set_kdp_book_trash_state(uuid,uuid,text,bigint,text,text,text) to service_role;
