-- Forward-only closeout for initial Owner bootstrap and recoverable employee
-- access delivery. Activate with the matching Edge Functions.

create or replace function public.bootstrap_initial_owner(
  p_auth_user_id uuid,
  p_reason text
) returns jsonb
language plpgsql
security definer
set search_path = '' as $$
declare
  v_auth auth.users%rowtype;
  v_target public.privileged_users%rowtype;
  v_before jsonb := '{}'::jsonb;
  v_capability text;
begin
  perform pg_advisory_xact_lock(hashtext('kdp:owner-administration'));

  if p_auth_user_id is null or length(btrim(coalesce(p_reason,''))) < 3 then
    raise exception 'An explicit authenticated identity and bootstrap reason are required.';
  end if;

  if exists(
    select 1
    from public.privileged_users u
    join public.privileged_user_capability_grants g on g.privileged_user_id=u.id
    where u.role_key='owner' and u.disabled_at is null
      and g.capability_key='can_manage_users' and g.revoked_at is null
  ) then
    raise exception 'A valid active Owner already exists.';
  end if;

  select * into v_auth from auth.users where id=p_auth_user_id for update;
  if v_auth.id is null or not (
    coalesce(v_auth.raw_app_meta_data->>'provider','')='google'
    or coalesce(v_auth.raw_app_meta_data->'providers','[]'::jsonb) ? 'google'
  ) then
    raise exception 'The bootstrap identity must be an existing Google-authenticated user.';
  end if;

  select * into v_target
  from public.privileged_users
  where auth_user_id=p_auth_user_id
  for update;

  if v_target.id is null then
    insert into public.privileged_users(auth_user_id,display_name,email_snapshot,role_key)
    values(
      v_auth.id,
      coalesce(nullif(v_auth.raw_user_meta_data->>'full_name',''),nullif(v_auth.raw_user_meta_data->>'name',''),v_auth.email),
      v_auth.email,
      'owner'
    ) returning * into v_target;
  else
    v_before := jsonb_build_object(
      'role',v_target.role_key,
      'active',v_target.disabled_at is null,
      'revision',v_target.revision
    );
    update public.privileged_users
    set role_key='owner',disabled_at=null,revision=revision+1,updated_at=now(),
      display_name=coalesce(nullif(display_name,''),nullif(v_auth.raw_user_meta_data->>'full_name',''),nullif(v_auth.raw_user_meta_data->>'name',''),v_auth.email),
      email_snapshot=coalesce(v_auth.email,email_snapshot)
    where id=v_target.id
    returning * into v_target;
  end if;

  for v_capability in select capability_key from public.privileged_capabilities loop
    if not exists(
      select 1 from public.privileged_user_capability_grants
      where privileged_user_id=v_target.id and capability_key=v_capability and revoked_at is null
    ) then
      insert into public.privileged_user_capability_grants(
        privileged_user_id,capability_key,granted_by_user_id,reason
      ) values(v_target.id,v_capability,v_target.id,btrim(p_reason));
    end if;
  end loop;

  insert into public.administrative_audit_events(
    actor_privileged_user_id,subject_privileged_user_id,action,reason,before_state,after_state
  ) values(
    v_target.id,v_target.id,'initial_owner_bootstrapped',btrim(p_reason),v_before,
    jsonb_build_object(
      'role','owner','active',true,'revision',v_target.revision,
      'capabilities',coalesce((
        select jsonb_agg(g.capability_key order by g.capability_key)
        from public.privileged_user_capability_grants g
        where g.privileged_user_id=v_target.id and g.revoked_at is null
      ),'[]'::jsonb),
      'bootstrap','service_role'
    )
  );

  return jsonb_build_object('ok',true,'owner_user_id',v_target.id,'revision',v_target.revision);
end;
$$;

revoke all on function public.bootstrap_initial_owner(uuid,text) from public,anon,authenticated;
grant execute on function public.bootstrap_initial_owner(uuid,text) to service_role;

create unique index if not exists employee_access_one_in_flight
  on public.integration_events(book_id)
  where provider='basecamp'
    and event_type in ('employee_reassignment_requested','employee_access_recovery_requested')
    and status='pending';

create or replace function public.claim_employee_access_delivery(
  p_book_id uuid,
  p_event_id uuid,
  p_claim_id uuid
) returns jsonb
language plpgsql
security definer
set search_path='' as $$
declare
  v_event public.integration_events%rowtype;
  v_claimed_at timestamptz;
begin
  if p_book_id is null or p_event_id is null or p_claim_id is null then
    raise exception 'Employee access delivery claim is invalid.';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('kdp:employee-access:'||p_book_id::text,0));
  select * into v_event from public.integration_events
    where id=p_event_id and book_id=p_book_id and provider='basecamp'
      and event_type in ('employee_reassignment_requested','employee_access_recovery_requested')
    for update;
  if v_event.id is null or v_event.status not in ('pending','failed') then
    raise exception 'Employee access delivery is unavailable.';
  end if;
  if not exists(
    select 1 from public.book_access_tokens t
    where t.book_id=p_book_id and t.role::text='employee' and t.revoked_at is null
      and t.metadata->>'integration_event_id'=p_event_id::text
  ) then raise exception 'Employee access delivery is stale.'; end if;
  v_claimed_at:=nullif(v_event.metadata->>'delivery_claimed_at','')::timestamptz;
  if v_event.metadata->>'delivery_claim_id' is not null
     and v_event.metadata->>'delivery_claim_id' is distinct from p_claim_id::text
     and v_claimed_at>now()-interval '5 minutes' then
    raise exception 'Employee access delivery is already in progress.';
  end if;
  update public.integration_events set status='pending',processed_at=null,error_message=null,
    metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
      'delivery_claim_id',p_claim_id,'delivery_claimed_at',now()
    ) where id=p_event_id;
  return jsonb_build_object('ok',true,'event_id',p_event_id,'claim_id',p_claim_id);
end;
$$;

create or replace function public.settle_employee_access_delivery(
  p_book_id uuid,
  p_event_id uuid,
  p_claim_id uuid,
  p_status text,
  p_error_message text default null
) returns jsonb
language plpgsql
security definer
set search_path='' as $$
declare v_event public.integration_events%rowtype;
begin
  if p_status not in ('success','failed') then raise exception 'Employee access delivery status is invalid.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('kdp:employee-access:'||p_book_id::text,0));
  select * into v_event from public.integration_events
    where id=p_event_id and book_id=p_book_id and provider='basecamp'
      and event_type in ('employee_reassignment_requested','employee_access_recovery_requested')
    for update;
  if v_event.id is null or v_event.status<>'pending'
     or v_event.metadata->>'delivery_claim_id' is distinct from p_claim_id::text then
    raise exception 'Employee access delivery settlement is stale.';
  end if;
  if not exists(
    select 1 from public.book_access_tokens t
    where t.book_id=p_book_id and t.role::text='employee' and t.revoked_at is null
      and t.metadata->>'integration_event_id'=p_event_id::text
  ) then raise exception 'Employee access delivery settlement is stale.'; end if;
  update public.integration_events set status=p_status,processed_at=now(),
    error_message=case when p_status='failed' then coalesce(nullif(p_error_message,''),'employee_access_sync_failed') else null end,
    metadata=(coalesce(metadata,'{}'::jsonb)-'delivery_claim_id'-'delivery_claimed_at')
    where id=p_event_id;
  return jsonb_build_object('ok',true,'event_id',p_event_id,'status',p_status);
end;
$$;

revoke all on function public.claim_employee_access_delivery(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.settle_employee_access_delivery(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.claim_employee_access_delivery(uuid,uuid,uuid) to service_role;
grant execute on function public.settle_employee_access_delivery(uuid,uuid,uuid,text,text) to service_role;

drop function if exists public.set_kdp_book_trash_state(uuid,uuid,text,bigint,text,text,text);

create function public.set_kdp_book_trash_state(
  p_book_id uuid,
  p_actor_user_id uuid,
  p_action text,
  p_expected_revision bigint,
  p_reason text,
  p_recovery_token_hash text default null,
  p_recovery_token_prefix text default null,
  p_recovery_integration_event_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = '' as $$
declare
  v_book public.books%rowtype;
  v_actor public.privileged_users%rowtype;
  v_token public.book_access_tokens%rowtype;
  v_has_basecamp boolean;
  v_needs_employee_access boolean := false;
  v_recovery_event_id uuid;
  v_reference_kind text;
begin
  perform pg_advisory_xact_lock(hashtextextended('kdp:employee-access:'||p_book_id::text,0));
  select * into v_actor from public.privileged_users where id=p_actor_user_id and disabled_at is null;
  if v_actor.id is null or v_actor.role_key not in ('owner','tech_admin')
     or not public.privileged_user_has_capability(v_actor.id,'can_manage_users') then
    raise exception 'Trash management is not authorized.';
  end if;

  select * into v_book from public.books where id=p_book_id for update;
  if v_book.id is null then raise exception 'Book not found.'; end if;
  if p_expected_revision is null or v_book.trash_revision is distinct from p_expected_revision then
    raise exception using errcode='40001',message='Book trash state changed elsewhere.';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 3 then raise exception 'A reason is required.'; end if;
  if exists(
    select 1 from public.integration_events e
    where e.book_id=p_book_id and e.provider='basecamp'
      and e.event_type in ('employee_reassignment_requested','employee_access_recovery_requested')
      and e.status='pending'
  ) then raise exception 'Employee access delivery is already in progress.'; end if;

  v_has_basecamp := exists(
    select 1 from public.basecamp_references r
    where r.book_id=p_book_id and r.reference_kind in ('book_todo_list','employee_update')
      and r.todo_id is not null
  );

  if p_action='trash' then
    if v_book.deleted_at is not null then
      return jsonb_build_object('ok',true,'deleted',true,'trash_revision',v_book.trash_revision);
    end if;
    update public.books
    set deleted_at=now(),deleted_by_privileged_user_id=v_actor.id,
      deleted_previous_status=overall_status::text,trash_revision=trash_revision+1,
      updated_at=now(),last_modified_at=now()
    where id=p_book_id;
    update public.book_access_tokens
    set revoked_at=coalesce(revoked_at,now()),updated_at=now()
    where book_id=p_book_id and role::text='employee' and revoked_at is null;
    insert into public.book_status_history(book_id,action,actor_type,actor_privileged_user_id,from_status,to_status,note,metadata)
    values(p_book_id,'book_trashed','admin',v_actor.id,v_book.overall_status,v_book.overall_status,btrim(p_reason),jsonb_build_object('basecamp_sync_required',v_has_basecamp));
    if v_has_basecamp then
      insert into public.integration_events(provider,event_type,book_id,status,payload_json,metadata)
      values('basecamp','book_trash_sync_requested',p_book_id,'pending',jsonb_build_object('deleted',true),jsonb_build_object('actor_privileged_user_id',v_actor.id,'operator_intervention_required',true));
    end if;
  elsif p_action='recover' then
    if v_book.deleted_at is null then
      return jsonb_build_object('ok',true,'deleted',false,'trash_revision',v_book.trash_revision);
    end if;
    v_needs_employee_access := v_book.overall_status::text in ('draft','EMPLOYEE_INTAKE','needs_updates','EMPLOYEE_UPDATES');
    if v_needs_employee_access and (
      p_recovery_integration_event_id is null
      or nullif(p_recovery_token_hash,'') is null
      or nullif(p_recovery_token_prefix,'') is null
    ) then
      raise exception 'Employee access recovery data is required.';
    end if;

    update public.books
    set deleted_at=null,deleted_by_privileged_user_id=null,trash_revision=trash_revision+1,
      updated_at=now(),last_modified_at=now()
    where id=p_book_id;

    if v_needs_employee_access then
      update public.book_access_tokens
      set revoked_at=coalesce(revoked_at,now()),updated_at=now()
      where book_id=p_book_id and role::text='employee' and revoked_at is null;
      insert into public.book_access_tokens(
        role,book_id,token_hash,token_prefix,employee_name,employee_email,basecamp_person_id,
        created_by_email,created_by_name,allowed_pages,allowed_actions,metadata
      ) values(
        'employee',p_book_id,p_recovery_token_hash,p_recovery_token_prefix,
        v_book.employee_name,v_book.employee_email,v_book.employee_basecamp_person_id,
        v_actor.email_snapshot,v_actor.display_name,array['details','content','pricing'],
        case when v_book.overall_status::text in ('needs_updates','EMPLOYEE_UPDATES')
          then array['load_employee_page','save_employee_step','complete_employee_step','upload_content_file_to_reviewstudio','reply_to_review','resubmit_for_review']
          else array['load_employee_page','save_employee_step','complete_employee_step','upload_content_file_to_reviewstudio','submit_for_approval'] end,
        jsonb_build_object('token_kind','book_specific','purpose','employee Kindle eBook intake','source','book_recovery','integration_event_id',p_recovery_integration_event_id)
      ) returning * into v_token;

      v_reference_kind := case when v_book.overall_status::text in ('needs_updates','EMPLOYEE_UPDATES') then 'employee_update' else 'book_todo_list' end;
      insert into public.integration_events(id,provider,event_type,book_id,status,payload_json,metadata)
      values(
        p_recovery_integration_event_id,'basecamp','employee_access_recovery_requested',p_book_id,'pending',
        jsonb_build_object('employee_person_id',v_book.employee_basecamp_person_id,'reference_kind',v_reference_kind),
        jsonb_build_object('actor_privileged_user_id',v_actor.id,'access_token_id',v_token.id)
      ) returning id into v_recovery_event_id;
    elsif v_has_basecamp then
      insert into public.integration_events(provider,event_type,book_id,status,payload_json,metadata)
      values('basecamp','book_recovery_sync_requested',p_book_id,'pending',jsonb_build_object('deleted',false),jsonb_build_object('actor_privileged_user_id',v_actor.id,'operator_intervention_required',true));
    end if;

    insert into public.book_status_history(book_id,action,actor_type,actor_privileged_user_id,from_status,to_status,note,metadata)
    values(
      p_book_id,'book_recovered','admin',v_actor.id,v_book.overall_status,v_book.overall_status,btrim(p_reason),
      jsonb_build_object('basecamp_sync_required',v_recovery_event_id is not null or v_has_basecamp,'employee_access_reestablished',false,'recovery_integration_event_id',v_recovery_event_id)
    );
  else
    raise exception 'Unsupported trash action.';
  end if;

  select * into v_book from public.books where id=p_book_id;
  return jsonb_build_object(
    'ok',true,'deleted',v_book.deleted_at is not null,'trash_revision',v_book.trash_revision,
    'employee_access_reestablished',false,
    'basecamp_sync_required',v_recovery_event_id is not null or v_has_basecamp,
    'recovery_event_id',v_recovery_event_id,
    'recovery_reference_kind',v_reference_kind,
    'employee_person_id',v_book.employee_basecamp_person_id
  );
end;
$$;

revoke all on function public.set_kdp_book_trash_state(uuid,uuid,text,bigint,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.set_kdp_book_trash_state(uuid,uuid,text,bigint,text,text,text,uuid) to service_role;
