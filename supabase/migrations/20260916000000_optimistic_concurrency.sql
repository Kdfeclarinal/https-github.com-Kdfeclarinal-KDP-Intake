-- Decisions 36 and 43: server-authoritative optimistic concurrency.
-- This is additive Stage A work. Existing status values remain valid.

alter table public.book_review_rounds
  add column if not exists revision bigint not null default 0;

alter table public.books
  add column if not exists employee_revision bigint not null default 0;

comment on column public.book_review_rounds.revision is
  'CAS revision for every active reviewer mutation. A successful mutation increments exactly once.';
comment on column public.books.employee_revision is
  'Book-wide CAS revision for canonical employee mutations, including current file changes.';

-- The original five-argument function remains the mutation implementation.
-- Only this security-definer wrapper may invoke it after the authority and CAS
-- checks have succeeded while holding the same round lock.
create or replace function public.apply_admin_review_action(
  p_book_id uuid,
  p_review_round_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_expected_revision bigint,
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
  v_result jsonb;
  v_revision bigint;
begin
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_round from public.book_review_rounds where id=p_review_round_id and book_id=p_book_id for update;
  if v_book.id is null or v_round.id is null or v_book.latest_review_round_id is distinct from v_round.id then raise exception 'Review is not authorized.'; end if;
  if v_round.reviewer_user_id is distinct from p_actor_user_id then raise exception 'Review is not assigned to this reviewer.'; end if;
  if not exists (
    select 1 from public.privileged_users u
    join public.privileged_user_capability_grants g on g.privileged_user_id=u.id
    where u.id=p_actor_user_id and u.disabled_at is null
      and g.capability_key='can_review' and g.revoked_at is null
  ) then raise exception 'Review action is not authorized.'; end if;
  if v_round.finalized_at is not null or v_round.status not in ('submitted','in_review') then raise exception 'Review round is immutable.'; end if;
  if p_expected_revision is null or v_round.revision is distinct from p_expected_revision then
    raise exception using errcode='40001', message='Review changed elsewhere.';
  end if;

  v_result := public.apply_admin_review_action(p_book_id,p_review_round_id,p_actor_user_id,p_action,p_payload);
  update public.book_review_rounds set revision=revision+1 where id=p_review_round_id returning revision into v_revision;
  return v_result || jsonb_build_object('revision',v_revision);
end;
$$;

create or replace function public.finalize_kdp_review_round(
  p_book_id uuid,
  p_review_round_id uuid,
  p_actor_user_id uuid,
  p_outcome text,
  p_expected_revision bigint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_book public.books%rowtype;
  v_round public.book_review_rounds%rowtype;
  v_expected_outcome text;
  v_result jsonb;
  v_revision bigint;
begin
  if p_outcome not in ('request_updates','approve_book') then raise exception 'Review outcome is invalid.'; end if;
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_round from public.book_review_rounds where id=p_review_round_id and book_id=p_book_id for update;
  if v_book.id is null or v_round.id is null then raise exception 'Active review round is unavailable.'; end if;
  if not exists (
    select 1 from public.privileged_users u
    join public.privileged_user_capability_grants g on g.privileged_user_id=u.id
    where u.id=p_actor_user_id and u.disabled_at is null
      and g.capability_key='can_finalize_book' and g.revoked_at is null
      and exists(select 1 from public.privileged_user_capability_grants review_grant where review_grant.privileged_user_id=u.id and review_grant.capability_key='can_review' and review_grant.revoked_at is null)
  ) then raise exception 'Book finalization is not authorized.'; end if;
  if v_round.reviewer_user_id is distinct from p_actor_user_id and not exists (
    select 1 from public.privileged_user_capability_grants g
    where g.privileged_user_id=p_actor_user_id
      and g.capability_key in ('can_reassign_reviewer','can_manage_users') and g.revoked_at is null
  ) then raise exception 'Review finalization is not assigned or authorized.'; end if;

  v_expected_outcome := case when p_outcome='approve_book' then 'approved' else 'request_updates' end;
  if v_round.finalized_at is not null then
    if v_round.outcome=v_expected_outcome then
      return public.finalize_kdp_review_round(p_book_id,p_review_round_id,p_actor_user_id,p_outcome);
    end if;
    raise exception 'Review round is immutable.';
  end if;
  if v_book.latest_review_round_id is distinct from v_round.id then raise exception 'Active review round is unavailable.'; end if;
  if p_expected_revision is null or v_round.revision is distinct from p_expected_revision then
    raise exception using errcode='40001', message='Review changed elsewhere.';
  end if;

  v_result := public.finalize_kdp_review_round(p_book_id,p_review_round_id,p_actor_user_id,p_outcome);
  update public.book_review_rounds set revision=revision+1 where id=p_review_round_id returning revision into v_revision;
  update public.books set employee_revision=employee_revision+1 where id=p_book_id;
  return v_result || jsonb_build_object('revision',v_revision);
end;
$$;

revoke all on function public.apply_admin_review_action(uuid,uuid,uuid,text,jsonb) from service_role;
revoke all on function public.finalize_kdp_review_round(uuid,uuid,uuid,text) from service_role;
revoke all on function public.apply_admin_review_action(uuid,uuid,uuid,text,bigint,jsonb) from public, anon, authenticated;
revoke all on function public.finalize_kdp_review_round(uuid,uuid,uuid,text,bigint) from public, anon, authenticated;
grant execute on function public.apply_admin_review_action(uuid,uuid,uuid,text,bigint,jsonb) to service_role;
grant execute on function public.finalize_kdp_review_round(uuid,uuid,uuid,text,bigint) to service_role;

-- Save a complete employee step mutation in one database transaction. The Edge
-- Function still performs rich validation, while this boundary independently
-- rechecks token/book/page/action/workflow authority and the coherent book CAS.
create or replace function public.save_employee_step_if_revision(
  p_book_id uuid,
  p_token_hash text,
  p_expected_revision bigint,
  p_step_name text,
  p_save_type text,
  p_step_data jsonb,
  p_next_step_name text,
  p_next_progress jsonb,
  p_book_patch jsonb,
  p_history jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_book public.books%rowtype;
  v_token public.book_access_tokens%rowtype;
  v_step_type public.book_step_data.step_name%type;
  v_next_step_type public.book_step_data.step_name%type;
  v_revision bigint;
  v_required_action text;
begin
  if p_step_name not in ('details','content','pricing') or p_save_type not in ('draft','complete') then raise exception 'Employee save is invalid.'; end if;
  v_required_action := case when p_save_type='complete' then 'complete_employee_step' else 'save_employee_step' end;
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_token from public.book_access_tokens where token_hash=p_token_hash and book_id=p_book_id for update;
  if v_book.id is null then raise exception 'Book not found.'; end if;
  if v_token.id is null or v_token.role::text<>'employee' or v_token.revoked_at is not null
    or (v_token.expires_at is not null and v_token.expires_at<=now())
    or v_token.metadata->>'token_kind' is distinct from 'book_specific'
    or not (p_step_name=any(coalesce(v_token.allowed_pages,array[]::text[])))
    or not (v_required_action=any(coalesce(v_token.allowed_actions,array[]::text[]))) then raise exception 'Employee save is not authorized.'; end if;
  if v_book.overall_status::text not in ('draft','EMPLOYEE_INTAKE','needs_updates','EMPLOYEE_UPDATES') then raise exception 'This book is not currently editable by an employee.'; end if;
  if p_expected_revision is null or v_book.employee_revision is distinct from p_expected_revision then
    raise exception using errcode='40001', message='Book changed elsewhere.';
  end if;
  select step_name into v_step_type from public.book_step_data where book_id=p_book_id and step_name::text=p_step_name for update;
  if v_step_type is null then raise exception 'This employee step is not unlocked.'; end if;
  if not exists(select 1 from public.book_step_data where book_id=p_book_id and step_name=v_step_type and is_unlocked=true) then raise exception 'This employee step is not unlocked.'; end if;

  update public.book_step_data set
    step_label=p_step_data->>'step_label',
    save_type=(jsonb_populate_record(null::public.book_step_data,jsonb_build_object('save_type',p_save_type))).save_type,
    step_status=(jsonb_populate_record(null::public.book_step_data,jsonb_build_object('step_status',p_step_data->>'step_status'))).step_status,
    is_complete=(p_step_data->>'is_complete')::boolean,
    is_unlocked=true, state_json=coalesce(p_step_data->'state_json','{}'::jsonb),
    extracted_fields=coalesce(p_step_data->'extracted_fields','{}'::jsonb),
    validation_required_keys=coalesce(array(select jsonb_array_elements_text(p_step_data->'validation_required_keys')),array[]::text[]),
    validation_errors=coalesce(p_step_data->'validation_errors','{}'::jsonb),
    saved_by_name=nullif(p_step_data->>'saved_by_name',''), saved_by_email=nullif(p_step_data->>'saved_by_email',''),
    saved_at=(p_step_data->>'saved_at')::timestamptz, metadata=coalesce(p_step_data->'metadata','{}'::jsonb)
  where book_id=p_book_id and step_name=v_step_type;

  if nullif(p_next_step_name,'') is not null and (p_step_data->>'is_complete')::boolean then
    select step_name into v_next_step_type from public.book_step_data where book_id=p_book_id and step_name::text=p_next_step_name for update;
    if v_next_step_type is not null then
      update public.book_step_data set is_unlocked=true,
        step_status=case when is_complete or step_status::text not in ('locked','not_started') then step_status else (jsonb_populate_record(null::public.book_step_data,'{"step_status":"in_progress"}'::jsonb)).step_status end
      where book_id=p_book_id and step_name=v_next_step_type;
    else
      select step_name into v_next_step_type from public.book_section_definitions where step_name::text=p_next_step_name limit 1;
      if v_next_step_type is null then raise exception 'Next employee step is invalid.'; end if;
      insert into public.book_step_data(book_id,step_name,step_label,save_type,step_status,is_complete,is_unlocked,state_json,extracted_fields,validation_required_keys,validation_errors,saved_at,metadata)
      values(p_book_id,v_next_step_type,case p_next_step_name when 'content' then 'Kindle eBook Content' else 'Kindle eBook Pricing' end,'draft',(jsonb_populate_record(null::public.book_step_data,'{"step_status":"in_progress"}'::jsonb)).step_status,false,true,'{}','{}',array[]::text[],'{}',null,jsonb_build_object('unlocked_by_step',p_step_name,'unlocked_at',now()));
    end if;
  end if;

  update public.books set
    progress_state=p_next_progress,
    current_employee_step=(jsonb_populate_record(null::public.books,jsonb_build_object('current_employee_step',p_next_progress->>'activeStep'))).current_employee_step,
    last_saved_at=(p_book_patch->>'last_saved_at')::timestamptz,
    last_modified_at=(p_book_patch->>'last_modified_at')::timestamptz,
    updated_at=(p_book_patch->>'updated_at')::timestamptz,
    book_title=case when p_step_name='details' and p_book_patch?'book_title' then nullif(p_book_patch->>'book_title','') else book_title end,
    subtitle=case when p_step_name='details' and p_book_patch?'subtitle' then nullif(p_book_patch->>'subtitle','') else subtitle end,
    primary_author_name=case when p_step_name='details' and p_book_patch?'primary_author_name' then nullif(p_book_patch->>'primary_author_name','') else primary_author_name end,
    primary_marketplace=case when p_step_name='details' and p_book_patch?'primary_marketplace' then nullif(p_book_patch->>'primary_marketplace','') else primary_marketplace end,
    employee_revision=employee_revision+1
  where id=p_book_id returning employee_revision into v_revision;

  insert into public.book_status_history(book_id,action,from_status,to_status,step_name,actor_type,actor_name,actor_email,note,metadata)
  values(p_book_id,p_history->>'action',v_book.overall_status,v_book.overall_status,v_step_type,'employee',nullif(p_history->>'actor_name',''),nullif(p_history->>'actor_email',''),p_history->>'note',coalesce(p_history->'metadata','{}'));
  update public.book_access_tokens set last_used_at=now(),updated_at=now() where id=v_token.id;
  return jsonb_build_object('ok',true,'employee_revision',v_revision);
end;
$$;

revoke all on function public.save_employee_step_if_revision(uuid,text,bigint,text,text,jsonb,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_employee_step_if_revision(uuid,text,bigint,text,text,jsonb,text,jsonb,jsonb,jsonb) to service_role;

create or replace function public.promote_content_file_if_revision(
  p_book_id uuid,
  p_token_hash text,
  p_expected_revision bigint,
  p_file_type text,
  p_section_key text,
  p_expected_old_file_id uuid,
  p_new_file_id uuid
)
returns bigint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_book public.books%rowtype;
  v_token public.book_access_tokens%rowtype;
  v_current_id uuid;
  v_revision bigint;
begin
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_token from public.book_access_tokens where token_hash=p_token_hash and book_id=p_book_id for update;
  if v_book.id is null or v_token.id is null or v_token.role::text<>'employee'
    or v_token.revoked_at is not null or (v_token.expires_at is not null and v_token.expires_at<=now())
    or v_token.metadata->>'token_kind' is distinct from 'book_specific'
    or not ('upload_content_file_to_reviewstudio'=any(coalesce(v_token.allowed_actions,array[]::text[]))) then raise exception 'File upload is not authorized.'; end if;
  if v_book.overall_status::text not in ('draft','EMPLOYEE_INTAKE','needs_updates','EMPLOYEE_UPDATES') then raise exception 'This book is not currently editable by an employee.'; end if;
  if p_expected_revision is null or v_book.employee_revision is distinct from p_expected_revision then raise exception using errcode='40001',message='Book changed elsewhere.'; end if;
  select id into v_current_id from public.book_files where book_id=p_book_id and file_type=p_file_type and section_key=p_section_key and is_latest=true for update;
  if v_current_id is distinct from p_expected_old_file_id then raise exception using errcode='40001',message='Current file changed elsewhere.'; end if;
  if not exists(select 1 from public.book_files where id=p_new_file_id and book_id=p_book_id and file_type=p_file_type and section_key=p_section_key and is_latest=false for update) then raise exception 'Staged file is unavailable.'; end if;
  if v_current_id is not null then
    update public.book_files set is_latest=false,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('superseded_at',now(),'replaced_by_file_id',p_new_file_id) where id=v_current_id;
  end if;
  update public.book_files set is_latest=true,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('promoted_at',now(),'replaces_file_id',v_current_id) where id=p_new_file_id;
  update public.books set employee_revision=employee_revision+1,updated_at=now(),last_modified_at=now() where id=p_book_id returning employee_revision into v_revision;
  update public.book_access_tokens set last_used_at=now(),updated_at=now() where id=v_token.id;
  return v_revision;
end;
$$;

revoke all on function public.promote_content_file_if_revision(uuid,text,bigint,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.promote_content_file_if_revision(uuid,text,bigint,text,text,uuid,uuid) to service_role;
revoke all on function public.promote_replacement_book_file(uuid,text,text,uuid,uuid) from service_role;

create or replace function public.reconcile_missing_content_file(p_book_id uuid,p_file_id uuid,p_reconciled_at timestamptz)
returns bigint language plpgsql security definer set search_path='' as $$
declare v_book public.books%rowtype; v_file public.book_files%rowtype; v_revision bigint;
begin
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_file from public.book_files where id=p_file_id and book_id=p_book_id for update;
  if v_book.id is null or v_file.id is null then raise exception 'File reconciliation is unavailable.'; end if;
  if v_file.is_latest is not true then return v_book.employee_revision; end if;
  update public.book_files set is_latest=false,updated_at=now(),metadata=coalesce(metadata,'{}')||jsonb_build_object('reconciliation_reason','externally_missing','reconciled_at',p_reconciled_at) where id=p_file_id;
  update public.books set employee_revision=employee_revision+1,updated_at=now(),last_modified_at=now() where id=p_book_id returning employee_revision into v_revision;
  return v_revision;
end; $$;
revoke all on function public.reconcile_missing_content_file(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_missing_content_file(uuid,uuid,timestamptz) to service_role;

create or replace function public.add_employee_review_reply(p_book_id uuid,p_token_hash text,p_comment_id uuid,p_body text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_book public.books%rowtype; v_token public.book_access_tokens%rowtype; v_result jsonb; v_revision bigint;
begin
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_token from public.book_access_tokens where token_hash=p_token_hash and book_id=p_book_id for update;
  if v_book.id is null or v_token.id is null or v_token.role::text<>'employee' or v_token.revoked_at is not null or (v_token.expires_at is not null and v_token.expires_at<=now()) or v_token.metadata->>'token_kind' is distinct from 'book_specific' or not ('reply_to_review'=any(coalesce(v_token.allowed_actions,array[]::text[]))) then raise exception 'Employee reply is not authorized.'; end if;
  if p_expected_revision is null or v_book.employee_revision is distinct from p_expected_revision then raise exception using errcode='40001',message='Book changed elsewhere.'; end if;
  v_result:=public.add_employee_review_reply(p_book_id,p_token_hash,p_comment_id,p_body);
  update public.books set employee_revision=employee_revision+1,updated_at=now(),last_modified_at=now() where id=p_book_id returning employee_revision into v_revision;
  return v_result||jsonb_build_object('employee_revision',v_revision);
end; $$;

create or replace function public.submit_kdp_book_for_approval(p_book_id uuid,p_token_hash text,p_source text,p_expected_revision bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_book public.books%rowtype; v_token public.book_access_tokens%rowtype; v_result jsonb; v_revision bigint;
begin
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_token from public.book_access_tokens where token_hash=p_token_hash and book_id=p_book_id for update;
  if v_book.id is null or v_token.id is null or v_token.role::text<>'employee' or v_token.revoked_at is not null or (v_token.expires_at is not null and v_token.expires_at<=now()) or v_token.metadata->>'token_kind' is distinct from 'book_specific' or not ('submit_for_approval'=any(coalesce(v_token.allowed_actions,array[]::text[]))) then raise exception 'Submission is not authorized.'; end if;
  if v_book.overall_status::text in ('for_approval','AWAITING_REVIEW','in_admin_review','IN_REVIEW') then return public.submit_kdp_book_for_approval(p_book_id,p_token_hash,p_source); end if;
  if p_expected_revision is null or v_book.employee_revision is distinct from p_expected_revision then raise exception using errcode='40001',message='Book changed elsewhere.'; end if;
  v_result:=public.submit_kdp_book_for_approval(p_book_id,p_token_hash,p_source);
  update public.books set employee_revision=employee_revision+1 where id=p_book_id returning employee_revision into v_revision;
  return v_result||jsonb_build_object('employee_revision',v_revision);
end; $$;

create or replace function public.resubmit_kdp_book_for_review(p_book_id uuid,p_token_hash text,p_update_cycle_id uuid,p_expected_revision bigint,p_source text default 'employee_resubmit')
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_book public.books%rowtype; v_token public.book_access_tokens%rowtype; v_result jsonb; v_revision bigint;
begin
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_token from public.book_access_tokens where token_hash=p_token_hash and book_id=p_book_id for update;
  if v_book.id is null or v_token.id is null or v_token.role::text<>'employee' or v_token.revoked_at is not null or (v_token.expires_at is not null and v_token.expires_at<=now()) or v_token.metadata->>'token_kind' is distinct from 'book_specific' or not ('resubmit_for_review'=any(coalesce(v_token.allowed_actions,array[]::text[]))) then raise exception 'Resubmission is not authorized.'; end if;
  if exists(select 1 from public.book_review_update_cycles where id=p_update_cycle_id and book_id=p_book_id and status='consumed' and target_review_round_id=v_book.latest_review_round_id) then return public.resubmit_kdp_book_for_review(p_book_id,p_token_hash,p_update_cycle_id,p_source); end if;
  if p_expected_revision is null or v_book.employee_revision is distinct from p_expected_revision then raise exception using errcode='40001',message='Book changed elsewhere.'; end if;
  v_result:=public.resubmit_kdp_book_for_review(p_book_id,p_token_hash,p_update_cycle_id,p_source);
  update public.books set employee_revision=employee_revision+1 where id=p_book_id returning employee_revision into v_revision;
  return v_result||jsonb_build_object('employee_revision',v_revision);
end; $$;

revoke all on function public.add_employee_review_reply(uuid,text,uuid,text) from service_role;
revoke all on function public.submit_kdp_book_for_approval(uuid,text,text) from service_role;
revoke all on function public.resubmit_kdp_book_for_review(uuid,text,uuid,text) from service_role;
revoke all on function public.add_employee_review_reply(uuid,text,uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.submit_kdp_book_for_approval(uuid,text,text,bigint) from public,anon,authenticated;
revoke all on function public.resubmit_kdp_book_for_review(uuid,text,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.add_employee_review_reply(uuid,text,uuid,text,bigint) to service_role;
grant execute on function public.submit_kdp_book_for_approval(uuid,text,text,bigint) to service_role;
grant execute on function public.resubmit_kdp_book_for_review(uuid,text,uuid,bigint,text) to service_role;
