-- Fix terminal Admin Review finalization status typing.
-- The canonical four-argument finalizer previously stored its target status in
-- a text variable, then inserted that text directly into
-- book_status_history.to_status (public.kdp_book_status). PostgreSQL correctly
-- rejected Request Updates / Approve Book before finalization.

create or replace function public.finalize_kdp_review_round(
  p_book_id uuid,
  p_review_round_id uuid,
  p_actor_user_id uuid,
  p_outcome text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_book public.books%rowtype;
  v_round public.book_review_rounds%rowtype;
  v_target public.kdp_book_status;
  v_ref public.basecamp_references%rowtype;
  v_actor_name text;
  v_reviewer_name text;
  v_expected_outcome text;
begin
  if p_outcome not in ('request_updates','approve_book') then
    raise exception 'Review outcome is invalid.';
  end if;

  select coalesce(u.display_name,u.email_snapshot,'Reviewer')
    into v_actor_name
  from public.privileged_users u
  where u.id=p_actor_user_id
    and u.disabled_at is null
    and exists(
      select 1
      from public.privileged_user_capability_grants g
      where g.privileged_user_id=u.id
        and g.capability_key='can_finalize_book'
        and g.revoked_at is null
    );

  if v_actor_name is null then
    raise exception 'Book finalization is not authorized.';
  end if;

  select * into v_book
  from public.books
  where id=p_book_id and deleted_at is null
  for update;

  select * into v_round
  from public.book_review_rounds
  where id=p_review_round_id and book_id=p_book_id
  for update;

  if v_book.id is null or v_round.id is null then
    raise exception 'Active review round is unavailable.';
  end if;

  if v_round.reviewer_user_id is distinct from p_actor_user_id
     and not exists (
       select 1
       from public.privileged_user_capability_grants g
       where g.privileged_user_id=p_actor_user_id
         and g.capability_key in ('can_reassign_reviewer','can_manage_users')
         and g.revoked_at is null
     ) then
    raise exception 'Review finalization is not assigned or authorized.';
  end if;

  select coalesce(u.display_name,u.email_snapshot,'Reviewer')
    into v_reviewer_name
  from public.privileged_users u
  where u.id=v_round.reviewer_user_id;

  v_expected_outcome := case
    when p_outcome='approve_book' then 'approved'
    else 'request_updates'
  end;

  if v_round.finalized_at is not null then
    if v_round.outcome=v_expected_outcome then
      return jsonb_build_object(
        'ok',true,
        'outcome',p_outcome,
        'overall_status',case when p_outcome='approve_book' then 'KDP_INTAKE_APPROVED' else 'EMPLOYEE_UPDATES' end,
        'review_round_id',p_review_round_id,
        'replayed',true
      );
    end if;
    raise exception 'Review round is immutable.';
  end if;

  if v_book.latest_review_round_id is distinct from v_round.id then
    raise exception 'Active review round is unavailable.';
  end if;

  if exists (
    select 1
    from public.book_review_items
    where review_round_id=p_review_round_id
      and is_reviewable=true
      and decision='pending'
  ) then
    raise exception 'Required review sections are still pending.';
  end if;

  if p_outcome='request_updates' then
    if not exists (
      select 1
      from public.book_review_items
      where review_round_id=p_review_round_id
        and is_reviewable=true
        and decision='needs_updates'
    ) then
      raise exception 'Request Updates requires at least one requested change.';
    end if;

    if exists (
      select 1
      from public.book_review_items i
      where i.review_round_id=p_review_round_id
        and i.is_reviewable=true
        and i.decision='needs_updates'
        and not exists (
          select 1
          from public.book_review_comments c
          where c.review_item_id=i.id
            and c.review_round_id=p_review_round_id
            and c.actionable=true
            and c.parent_comment_id is null
            and c.resolved_at is null
            and c.deleted_at is null
        )
    ) then
      raise exception 'Every requested-update section requires an active actionable issue.';
    end if;

    v_target := 'EMPLOYEE_UPDATES'::public.kdp_book_status;

    update public.book_access_tokens
    set allowed_actions=(
      select array_agg(distinct action_name)
      from unnest(allowed_actions || array['reply_to_review','resubmit_for_review']) action_name
    ),
    updated_at=now()
    where book_id=p_book_id
      and role::text='employee'
      and revoked_at is null
      and metadata->>'token_kind'='book_specific';
  else
    if exists (
      select 1
      from public.book_review_items i
      where i.review_round_id=p_review_round_id
        and i.is_reviewable=true
        and (
          i.decision<>'approved'
          or exists (
            select 1
            from public.book_review_comments c
            where c.review_item_id=i.id
              and c.actionable
              and c.parent_comment_id is null
              and c.resolved_at is null
              and c.deleted_at is null
          )
        )
    ) then
      raise exception 'All required sections must be approved.';
    end if;

    v_target := 'KDP_INTAKE_APPROVED'::public.kdp_book_status;
  end if;

  update public.book_review_rounds
  set outcome=v_expected_outcome,
      finalized_at=now(),
      finalized_by_user_id=p_actor_user_id,
      finalized_by_name=v_actor_name,
      reviewer_name_snapshot=coalesce(reviewer_name_snapshot,v_reviewer_name),
      employee_updates_started_at=case when p_outcome='request_updates' then now() else null end
  where id=p_review_round_id;

  update public.books
  set overall_status=v_target,
      current_employee_step=case when p_outcome='request_updates' then 'details' else current_employee_step end,
      updated_at=now(),
      last_modified_at=now()
  where id=p_book_id;

  insert into public.book_status_history(
    book_id,review_round_id,action,actor_type,actor_privileged_user_id,
    from_status,to_status,note,metadata
  )
  values(
    p_book_id,p_review_round_id,p_outcome,'admin',p_actor_user_id,
    v_book.overall_status,v_target,
    case when p_outcome='approve_book'
      then 'KDP Intake approved; not an Amazon publication event.'
      else 'Updates requested from employee.'
    end,
    '{}'::jsonb
  );

  insert into public.book_review_audit_events(
    book_id,review_round_id,action,actor_type,actor_privileged_user_id,
    from_state,to_state
  )
  values(
    p_book_id,p_review_round_id,p_outcome,'privileged',p_actor_user_id,
    jsonb_build_object('book_status',v_book.overall_status),
    jsonb_build_object('book_status',v_target)
  );

  select * into v_ref
  from public.basecamp_references
  where book_id=p_book_id
    and review_round_id=p_review_round_id
    and reference_kind='review_round';

  if p_outcome='request_updates' and v_ref.id is not null then
    insert into public.basecamp_references(
      book_id,review_round_id,account_id,project_id,bucket_id,reference_kind,
      todo_list_id,idempotency_key,provisioning_status,metadata
    )
    values(
      p_book_id,p_review_round_id,v_ref.account_id,v_ref.project_id,v_ref.bucket_id,
      'employee_update',v_ref.todo_list_id,
      'basecamp:employee-update:'||p_review_round_id::text,
      'pending',jsonb_build_object('round_number',v_round.round_number)
    )
    on conflict(idempotency_key) do nothing;
  end if;

  if p_outcome='approve_book' and v_ref.id is not null then
    update public.basecamp_references
    set provisioning_status='pending', last_provisioning_error=null
    where id=v_ref.id;
  end if;

  insert into public.integration_events(
    provider,event_type,book_id,review_round_id,status,payload_json,metadata
  )
  values(
    'basecamp','review_outcome_sync_requested',p_book_id,p_review_round_id,
    'pending',jsonb_build_object('outcome',p_outcome),'{}'::jsonb
  );

  return jsonb_build_object(
    'ok',true,
    'outcome',p_outcome,
    'overall_status',v_target,
    'review_round_id',p_review_round_id,
    'replayed',false
  );
end;
$$;

revoke all on function public.finalize_kdp_review_round(uuid,uuid,uuid,text)
  from public,anon,authenticated;
grant execute on function public.finalize_kdp_review_round(uuid,uuid,uuid,text)
  to service_role;
