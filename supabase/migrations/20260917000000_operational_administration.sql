-- Operational administration for locked Decisions 5, 6, 9, 16, 42, 44 and 59.
-- Additive only; activate with the matching Edge Functions in one coordinated release.

insert into public.privileged_capabilities(capability_key, description) values
  ('can_change_default_reviewer', 'Change the default reviewer for future submissions.')
on conflict(capability_key) do update set description=excluded.description;

alter table public.privileged_users
  add column if not exists role_key text not null default 'reviewer',
  add column if not exists revision bigint not null default 0;

alter table public.books
  add column if not exists reviewer_assignment_revision bigint not null default 0;

alter table public.books drop constraint if exists books_reviewer_assignment_source_allowed;
alter table public.books add constraint books_reviewer_assignment_source_allowed check (
  reviewer_assignment_source is null or reviewer_assignment_source in ('default','owner_fallback','override','claim','reassignment','inherited')
);
alter table public.book_review_rounds drop constraint if exists book_review_rounds_assignment_source_allowed;
alter table public.book_review_rounds add constraint book_review_rounds_assignment_source_allowed check (
  reviewer_assignment_source is null or reviewer_assignment_source in ('default','owner_fallback','override','claim','reassignment','inherited')
);

alter table public.privileged_users drop constraint if exists privileged_users_role_key_allowed;
alter table public.privileged_users add constraint privileged_users_role_key_allowed
  check(role_key in ('owner','tech_admin','reviewer'));

create table public.administrative_audit_events(
  id uuid primary key default gen_random_uuid(),
  actor_privileged_user_id uuid not null references public.privileged_users(id) on delete restrict,
  subject_privileged_user_id uuid references public.privileged_users(id) on delete restrict,
  book_id uuid references public.books(id) on delete restrict,
  review_round_id uuid references public.book_review_rounds(id) on delete restrict,
  action text not null,
  reason text not null,
  before_state jsonb not null default '{}'::jsonb,
  after_state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.administrative_audit_events enable row level security;
revoke all on table public.administrative_audit_events from public,anon,authenticated;
grant all on table public.administrative_audit_events to service_role;

create or replace function public.privileged_user_has_capability(p_user_id uuid,p_capability text)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.privileged_users u
    join public.privileged_user_capability_grants g on g.privileged_user_id=u.id
    where u.id=p_user_id and u.disabled_at is null and g.capability_key=p_capability and g.revoked_at is null
  );
$$;
revoke all on function public.privileged_user_has_capability(uuid,text) from public,anon,authenticated;
grant execute on function public.privileged_user_has_capability(uuid,text) to service_role;

create or replace function public.tech_admin_delegable_capabilities()
returns text[] language sql immutable security definer set search_path='' as $$
  select array['can_review','can_claim_review','can_assign_reviewer','can_reassign_reviewer','can_create_book','can_view_all_books','can_finalize_book','can_change_default_reviewer']::text[];
$$;
revoke all on function public.tech_admin_delegable_capabilities() from public,anon,authenticated;
grant execute on function public.tech_admin_delegable_capabilities() to service_role;

create or replace function public.create_privileged_user(
  p_actor_user_id uuid,p_email text,p_role_key text,p_capabilities text[],p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor public.privileged_users%rowtype; v_auth_id uuid; v_auth_email text; v_metadata jsonb; v_target public.privileged_users%rowtype; v_cap text;
begin
  perform pg_advisory_xact_lock(hashtext('kdp:owner-administration'));
  select * into v_actor from public.privileged_users where id=p_actor_user_id and disabled_at is null for update;
  if v_actor.id is null or not public.privileged_user_has_capability(v_actor.id,'can_manage_users') then raise exception 'User management is not authorized.'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'A management reason is required.'; end if;
  if p_role_key not in ('owner','tech_admin','reviewer') then raise exception 'Role is invalid.'; end if;
  if p_role_key='owner' and v_actor.role_key<>'owner' then raise exception 'Only an Owner may create Owner authority.'; end if;
  if v_actor.role_key<>'owner' and exists(select 1 from unnest(coalesce(p_capabilities,array[]::text[])) c where not(c=any(public.tech_admin_delegable_capabilities()))) then raise exception 'Capability delegation is not authorized.'; end if;
  if exists(select 1 from unnest(coalesce(p_capabilities,array[]::text[])) c where not exists(select 1 from public.privileged_capabilities pc where pc.capability_key=c)) then raise exception 'Capability is invalid.'; end if;
  if p_role_key='owner' and not ('can_manage_users'=any(coalesce(p_capabilities,array[]::text[]))) then raise exception 'Owner authority requires user-management capability.'; end if;
  select id,email,raw_user_meta_data into v_auth_id,v_auth_email,v_metadata from auth.users where lower(email)=lower(btrim(p_email)) order by created_at desc limit 1 for update;
  if v_auth_id is null then raise exception 'The Google account must sign in once before it can be allowlisted.'; end if;
  if exists(select 1 from public.privileged_users where auth_user_id=v_auth_id) then raise exception 'This Google account is already a team member.'; end if;
  insert into public.privileged_users(auth_user_id,display_name,email_snapshot,role_key)
  values(v_auth_id,coalesce(nullif(v_metadata->>'full_name',''),nullif(v_metadata->>'name',''),v_auth_email),v_auth_email,p_role_key) returning * into v_target;
  foreach v_cap in array coalesce(p_capabilities,array[]::text[]) loop
    insert into public.privileged_user_capability_grants(privileged_user_id,capability_key,granted_by_user_id,reason) values(v_target.id,v_cap,v_actor.id,btrim(p_reason));
  end loop;
  insert into public.administrative_audit_events(actor_privileged_user_id,subject_privileged_user_id,action,reason,after_state)
  values(v_actor.id,v_target.id,'privileged_user_created',btrim(p_reason),jsonb_build_object('role',p_role_key,'active',true,'capabilities',to_jsonb(coalesce(p_capabilities,array[]::text[])),'revision',0));
  return jsonb_build_object('ok',true,'user_id',v_target.id,'revision',0);
end; $$;

create or replace function public.manage_privileged_user(
  p_actor_user_id uuid,
  p_target_user_id uuid,
  p_expected_revision bigint,
  p_role_key text,
  p_active boolean,
  p_capabilities text[],
  p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor public.privileged_users%rowtype;
  v_target public.privileged_users%rowtype;
  v_before jsonb;
  v_after jsonb;
  v_cap text;
  v_assignment record;
begin
  perform pg_advisory_xact_lock(hashtext('kdp:owner-administration'));
  select * into v_actor from public.privileged_users where id=p_actor_user_id and disabled_at is null for update;
  select * into v_target from public.privileged_users where id=p_target_user_id for update;
  if v_actor.id is null or v_target.id is null or not public.privileged_user_has_capability(v_actor.id,'can_manage_users') then
    raise exception 'User management is not authorized.';
  end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'A management reason is required.'; end if;
  if p_role_key not in ('owner','tech_admin','reviewer') then raise exception 'Role is invalid.'; end if;
  if p_expected_revision is null or v_target.revision is distinct from p_expected_revision then
    raise exception using errcode='40001',message='Privileged user changed elsewhere.';
  end if;
  if v_actor.role_key<>'owner' and (v_target.role_key='owner' or p_role_key='owner') then
    raise exception 'Only an Owner may administer Owner authority.';
  end if;
  if v_actor.role_key<>'owner' and p_actor_user_id=p_target_user_id then
    raise exception 'A Tech Admin cannot administer their own account.';
  end if;
  if p_actor_user_id=p_target_user_id and v_actor.role_key<>'owner' and p_role_key='owner' then
    raise exception 'A Tech Admin cannot self-promote to Owner.';
  end if;
  if v_target.role_key='owner' and v_target.disabled_at is null and (not p_active or p_role_key<>'owner') and
     (select count(*) from public.privileged_users where role_key='owner' and disabled_at is null)<=1 then
    raise exception 'At least one active Owner must remain.';
  end if;
  if exists(select 1 from unnest(coalesce(p_capabilities,array[]::text[])) c
            where not exists(select 1 from public.privileged_capabilities pc where pc.capability_key=c)) then
    raise exception 'Capability is invalid.';
  end if;
  if v_actor.role_key<>'owner' and exists(
    select 1 from public.privileged_capabilities pc
    where not(pc.capability_key=any(public.tech_admin_delegable_capabilities()))
      and ((pc.capability_key=any(coalesce(p_capabilities,array[]::text[]))) is distinct from exists(
        select 1 from public.privileged_user_capability_grants g where g.privileged_user_id=v_target.id and g.capability_key=pc.capability_key and g.revoked_at is null
      ))
  ) then raise exception 'Capability delegation is not authorized.'; end if;
  v_before:=jsonb_build_object('role',v_target.role_key,'active',v_target.disabled_at is null,
    'capabilities',coalesce((select jsonb_agg(g.capability_key order by g.capability_key) from public.privileged_user_capability_grants g where g.privileged_user_id=v_target.id and g.revoked_at is null),'[]'::jsonb),
    'revision',v_target.revision);
  update public.privileged_users set role_key=p_role_key,
    disabled_at=case when p_active then null else coalesce(disabled_at,now()) end,
    revision=revision+1,updated_at=now() where id=v_target.id returning * into v_target;
  update public.privileged_user_capability_grants set revoked_at=now(),revoked_by_user_id=v_actor.id,reason=p_reason
    where privileged_user_id=v_target.id and revoked_at is null and not(capability_key=any(coalesce(p_capabilities,array[]::text[])));
  foreach v_cap in array coalesce(p_capabilities,array[]::text[]) loop
    if not exists(select 1 from public.privileged_user_capability_grants where privileged_user_id=v_target.id and capability_key=v_cap and revoked_at is null) then
      insert into public.privileged_user_capability_grants(privileged_user_id,capability_key,granted_by_user_id,reason)
      values(v_target.id,v_cap,v_actor.id,p_reason);
    end if;
  end loop;
  if not exists(
    select 1 from public.privileged_users u
    join public.privileged_user_capability_grants g on g.privileged_user_id=u.id
    where u.role_key='owner' and u.disabled_at is null
      and g.capability_key='can_manage_users' and g.revoked_at is null
  ) then
    raise exception 'At least one active Owner with user-management authority must remain.';
  end if;
  if v_target.disabled_at is not null or not public.privileged_user_has_capability(v_target.id,'can_review') then
    for v_assignment in
      select r.id as round_id,r.book_id,r.revision from public.book_review_rounds r
      join public.books b on b.id=r.book_id and b.latest_review_round_id=r.id
      where r.reviewer_user_id=v_target.id and r.finalized_at is null and r.status in ('submitted','in_review')
      for update of r,b
    loop
      update public.book_review_rounds set reviewer_user_id=null,reviewer_assigned_by_user_id=v_actor.id,
        reviewer_assignment_source=null,reviewer_assigned_at=null,revision=revision+1 where id=v_assignment.round_id;
      update public.books set assigned_reviewer_user_id=null,reviewer_assigned_by_user_id=v_actor.id,
        reviewer_assignment_source=null,reviewer_assigned_at=null,reviewer_assignment_revision=reviewer_assignment_revision+1,
        updated_at=now() where id=v_assignment.book_id;
      insert into public.administrative_audit_events(actor_privileged_user_id,subject_privileged_user_id,book_id,review_round_id,action,reason,before_state,after_state)
      values(v_actor.id,v_target.id,v_assignment.book_id,v_assignment.round_id,'reviewer_ineligibility_intervention',btrim(p_reason),jsonb_build_object('reviewer_user_id',v_target.id,'revision',v_assignment.revision),jsonb_build_object('reviewer_user_id',null,'revision',v_assignment.revision+1));
    end loop;
    for v_assignment in
      select b.id as book_id,b.reviewer_assignment_revision from public.books b
      where b.assigned_reviewer_user_id=v_target.id and b.overall_status::text in ('draft','EMPLOYEE_INTAKE')
        and not exists(select 1 from public.book_review_rounds r where r.book_id=b.id)
      for update of b
    loop
      update public.books set assigned_reviewer_user_id=null,reviewer_assigned_by_user_id=v_actor.id,
        reviewer_assignment_source=null,reviewer_assigned_at=null,reviewer_assignment_revision=reviewer_assignment_revision+1,
        updated_at=now() where id=v_assignment.book_id;
      insert into public.administrative_audit_events(actor_privileged_user_id,subject_privileged_user_id,book_id,action,reason,before_state,after_state)
      values(v_actor.id,v_target.id,v_assignment.book_id,'book_reviewer_override_invalidated',btrim(p_reason),jsonb_build_object('reviewer_user_id',v_target.id,'revision',v_assignment.reviewer_assignment_revision),jsonb_build_object('reviewer_user_id',null,'revision',v_assignment.reviewer_assignment_revision+1));
    end loop;
    if exists(select 1 from public.review_assignment_defaults where reviewer_user_id=v_target.id) then
      delete from public.review_assignment_defaults where reviewer_user_id=v_target.id;
      insert into public.administrative_audit_events(actor_privileged_user_id,subject_privileged_user_id,action,reason,before_state,after_state)
      values(v_actor.id,v_target.id,'default_reviewer_invalidated',btrim(p_reason),jsonb_build_object('reviewer_user_id',v_target.id),'{}'::jsonb);
    end if;
  end if;
  v_after:=jsonb_build_object('role',v_target.role_key,'active',v_target.disabled_at is null,
    'capabilities',coalesce((select jsonb_agg(g.capability_key order by g.capability_key) from public.privileged_user_capability_grants g where g.privileged_user_id=v_target.id and g.revoked_at is null),'[]'::jsonb),
    'revision',v_target.revision);
  insert into public.administrative_audit_events(actor_privileged_user_id,subject_privileged_user_id,action,reason,before_state,after_state)
  values(v_actor.id,v_target.id,'privileged_user_changed',btrim(p_reason),v_before,v_after);
  return jsonb_build_object('ok',true,'user_id',v_target.id,'revision',v_target.revision);
end; $$;

create or replace function public.set_default_reviewer(
  p_actor_user_id uuid,p_target_reviewer_user_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor public.privileged_users%rowtype; v_target public.privileged_users%rowtype; v_old uuid;
begin
  select * into v_actor from public.privileged_users where id=p_actor_user_id and disabled_at is null for update;
  if v_actor.id is null or not public.privileged_user_has_capability(v_actor.id,'can_change_default_reviewer') then raise exception 'Default reviewer change is not authorized.'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'A management reason is required.'; end if;
  select * into v_target from public.privileged_users where id=p_target_reviewer_user_id and disabled_at is null for update;
  if v_target.id is null or not public.privileged_user_has_capability(v_target.id,'can_review') then raise exception 'Default reviewer must be eligible.'; end if;
  select reviewer_user_id into v_old from public.review_assignment_defaults where scope_key='kindle_ebook' for update;
  insert into public.review_assignment_defaults(scope_key,reviewer_user_id,updated_by_user_id,metadata)
  values('kindle_ebook',v_target.id,v_actor.id,jsonb_build_object('reason',btrim(p_reason)))
  on conflict(scope_key) do update set reviewer_user_id=excluded.reviewer_user_id,updated_by_user_id=excluded.updated_by_user_id,metadata=excluded.metadata,updated_at=now();
  insert into public.administrative_audit_events(actor_privileged_user_id,subject_privileged_user_id,action,reason,before_state,after_state)
  values(v_actor.id,v_target.id,'default_reviewer_changed',btrim(p_reason),jsonb_build_object('reviewer_user_id',v_old),jsonb_build_object('reviewer_user_id',v_target.id));
  return jsonb_build_object('ok',true,'reviewer_user_id',v_target.id);
end; $$;

create or replace function public.set_book_reviewer_override(
  p_actor_user_id uuid,p_book_id uuid,p_expected_revision bigint,
  p_target_reviewer_user_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor public.privileged_users%rowtype; v_target public.privileged_users%rowtype; v_book public.books%rowtype; v_old uuid; v_revision bigint;
begin
  select * into v_actor from public.privileged_users where id=p_actor_user_id and disabled_at is null for update;
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  if v_actor.id is null or v_book.id is null or v_book.overall_status::text not in ('draft','EMPLOYEE_INTAKE')
     or exists(select 1 from public.book_review_rounds where book_id=v_book.id) then raise exception 'Pre-submission reviewer override is unavailable.'; end if;
  if p_expected_revision is null or v_book.reviewer_assignment_revision is distinct from p_expected_revision then raise exception using errcode='40001',message='Reviewer override changed elsewhere.'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'An assignment reason is required.'; end if;
  v_old:=v_book.assigned_reviewer_user_id;
  if v_old is null then
    if v_actor.role_key not in ('owner','tech_admin') or not public.privileged_user_has_capability(v_actor.id,'can_assign_reviewer') then raise exception 'Reviewer assignment is not authorized.'; end if;
  else
    if v_actor.role_key not in ('owner','tech_admin') or not public.privileged_user_has_capability(v_actor.id,'can_reassign_reviewer') then raise exception 'Reviewer reassignment is not authorized.'; end if;
    if v_old is not distinct from p_target_reviewer_user_id then raise exception 'This reviewer is already assigned.'; end if;
  end if;
  select * into v_target from public.privileged_users where id=p_target_reviewer_user_id and disabled_at is null for update;
  if v_target.id is null or not public.privileged_user_has_capability(v_target.id,'can_review') then raise exception 'Target reviewer is not eligible.'; end if;
  update public.books set assigned_reviewer_user_id=v_target.id,reviewer_assigned_by_user_id=v_actor.id,
    reviewer_assignment_source='override',reviewer_assigned_at=now(),reviewer_assignment_revision=reviewer_assignment_revision+1,
    updated_at=now() where id=v_book.id returning reviewer_assignment_revision into v_revision;
  insert into public.administrative_audit_events(actor_privileged_user_id,subject_privileged_user_id,book_id,action,reason,before_state,after_state)
  values(v_actor.id,v_target.id,v_book.id,case when v_old is null then 'book_reviewer_override_assigned' else 'book_reviewer_override_changed' end,btrim(p_reason),jsonb_build_object('reviewer_user_id',v_old),jsonb_build_object('reviewer_user_id',v_target.id,'revision',v_revision));
  return jsonb_build_object('ok',true,'reviewer_user_id',v_target.id,'revision',v_revision);
end; $$;

create or replace function public.manage_review_assignment(
  p_actor_user_id uuid,p_book_id uuid,p_review_round_id uuid,p_expected_revision bigint,
  p_expected_reviewer_user_id uuid,p_target_reviewer_user_id uuid,p_action text,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor public.privileged_users%rowtype; v_target public.privileged_users%rowtype; v_book public.books%rowtype; v_round public.book_review_rounds%rowtype; v_current uuid; v_revision bigint;
begin
  select * into v_actor from public.privileged_users where id=p_actor_user_id and disabled_at is null for update;
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  select * into v_round from public.book_review_rounds where id=p_review_round_id and book_id=p_book_id for update;
  if v_actor.id is null or v_book.id is null or v_round.id is null or v_book.latest_review_round_id is distinct from v_round.id or v_round.finalized_at is not null or v_round.status not in ('submitted','in_review') then raise exception 'Active review assignment is unavailable.'; end if;
  if p_expected_revision is null or v_round.revision is distinct from p_expected_revision then raise exception using errcode='40001',message='Review assignment changed elsewhere.'; end if;
  v_current:=coalesce(v_round.reviewer_user_id,v_book.assigned_reviewer_user_id);
  if v_current is distinct from p_expected_reviewer_user_id then raise exception using errcode='40001',message='Review assignment changed elsewhere.'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'An assignment reason is required.'; end if;
  select * into v_target from public.privileged_users where id=p_target_reviewer_user_id and disabled_at is null for update;
  if v_target.id is null or not public.privileged_user_has_capability(v_target.id,'can_review') then raise exception 'Target reviewer is not eligible.'; end if;
  if p_action='claim' then
    if v_current is not null or p_target_reviewer_user_id<>v_actor.id or not public.privileged_user_has_capability(v_actor.id,'can_claim_review') then raise exception 'Review claim is not authorized.'; end if;
  elsif p_action='assign' then
    if v_current is not null or v_actor.role_key not in ('owner','tech_admin') or not public.privileged_user_has_capability(v_actor.id,'can_assign_reviewer') then raise exception 'Review assignment is not authorized.'; end if;
  elsif p_action='reassign' then
    if v_current is null or v_current=p_target_reviewer_user_id or v_actor.role_key not in ('owner','tech_admin') or not public.privileged_user_has_capability(v_actor.id,'can_reassign_reviewer') then raise exception 'Review reassignment is not authorized.'; end if;
  else raise exception 'Review assignment action is invalid.'; end if;
  update public.book_review_rounds set reviewer_user_id=p_target_reviewer_user_id,reviewer_assigned_by_user_id=v_actor.id,
    reviewer_assignment_source=case when p_action='claim' then 'claim' when p_action='assign' then 'override' else 'reassignment' end,
    reviewer_assigned_at=now(),revision=revision+1 where id=v_round.id returning revision into v_revision;
  update public.books set assigned_reviewer_user_id=p_target_reviewer_user_id,reviewer_assigned_by_user_id=v_actor.id,
    reviewer_assignment_source=case when p_action='claim' then 'claim' when p_action='assign' then 'override' else 'reassignment' end,
    reviewer_assigned_at=now(),updated_at=now() where id=v_book.id;
  insert into public.administrative_audit_events(actor_privileged_user_id,subject_privileged_user_id,book_id,review_round_id,action,reason,before_state,after_state)
  values(v_actor.id,p_target_reviewer_user_id,v_book.id,v_round.id,'reviewer_'||p_action,btrim(p_reason),jsonb_build_object('reviewer_user_id',v_current),jsonb_build_object('reviewer_user_id',p_target_reviewer_user_id,'revision',v_revision));
  return jsonb_build_object('ok',true,'reviewer_user_id',p_target_reviewer_user_id,'revision',v_revision);
end; $$;

create or replace function public.reassign_book_employee(
  p_actor_user_id uuid,p_book_id uuid,p_expected_employee_revision bigint,p_expected_employee_person_id text,
  p_replacement_employee_person_id text,p_replacement_employee_name text,p_replacement_employee_email text,
  p_token_hash text,p_token_prefix text,p_integration_event_id uuid,p_reason text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor public.privileged_users%rowtype; v_book public.books%rowtype; v_revision bigint; v_event_id uuid;
begin
  select * into v_actor from public.privileged_users where id=p_actor_user_id and disabled_at is null for update;
  if v_actor.id is null or v_actor.role_key not in ('owner','tech_admin') or not public.privileged_user_has_capability(v_actor.id,'can_manage_users') then raise exception 'Employee reassignment is not authorized.'; end if;
  if coalesce(btrim(p_reason),'')='' then raise exception 'An employee reassignment reason is required.'; end if;
  select * into v_book from public.books where id=p_book_id and deleted_at is null for update;
  if v_book.id is null then raise exception 'Book was not found.'; end if;
  if p_expected_employee_revision is null or v_book.employee_revision is distinct from p_expected_employee_revision or v_book.employee_basecamp_person_id is distinct from p_expected_employee_person_id then raise exception using errcode='40001',message='Employee assignment changed elsewhere.'; end if;
  if p_integration_event_id is null or coalesce(btrim(p_replacement_employee_person_id),'')='' or coalesce(btrim(p_replacement_employee_name),'')='' or p_replacement_employee_person_id=v_book.employee_basecamp_person_id then raise exception 'Replacement employee is invalid.'; end if;
  update public.book_access_tokens set revoked_at=now(),updated_at=now() where book_id=p_book_id and role::text='employee' and revoked_at is null;
  insert into public.book_access_tokens(role,book_id,token_hash,token_prefix,employee_name,employee_email,basecamp_person_id,created_by_email,created_by_name,allowed_pages,allowed_actions,metadata)
  values('employee',p_book_id,p_token_hash,p_token_prefix,p_replacement_employee_name,nullif(p_replacement_employee_email,''),p_replacement_employee_person_id,v_actor.email_snapshot,v_actor.display_name,array['details','content','pricing'],case when v_book.overall_status::text in ('needs_updates','EMPLOYEE_UPDATES') then array['load_employee_page','save_employee_step','complete_employee_step','upload_content_file_to_reviewstudio','reply_to_review','resubmit_for_review'] else array['load_employee_page','save_employee_step','complete_employee_step','upload_content_file_to_reviewstudio','submit_for_approval'] end,jsonb_build_object('token_kind','book_specific','purpose','employee Kindle eBook intake','source','employee_reassignment','integration_event_id',p_integration_event_id));
  update public.books set employee_basecamp_person_id=p_replacement_employee_person_id,employee_name=p_replacement_employee_name,
    employee_email=nullif(p_replacement_employee_email,''),employee_revision=employee_revision+1,updated_at=now(),last_modified_at=now()
    where id=p_book_id returning employee_revision into v_revision;
  update public.basecamp_references set assigned_employee_person_id=p_replacement_employee_person_id,updated_at=now()
    where book_id=p_book_id and reference_kind in ('book_todo_list','employee_update');
  insert into public.integration_events(id,provider,event_type,book_id,status,payload_json,metadata)
  values(p_integration_event_id,'basecamp','employee_reassignment_requested',p_book_id,'pending',jsonb_build_object('replacement_employee_person_id',p_replacement_employee_person_id),jsonb_build_object('actor_privileged_user_id',v_actor.id)) returning id into v_event_id;
  insert into public.administrative_audit_events(actor_privileged_user_id,book_id,action,reason,before_state,after_state)
  values(v_actor.id,v_book.id,'employee_reassigned',btrim(p_reason),jsonb_build_object('employee_person_id',v_book.employee_basecamp_person_id),jsonb_build_object('employee_person_id',p_replacement_employee_person_id,'employee_revision',v_revision));
  return jsonb_build_object('ok',true,'employee_revision',v_revision,'integration_event_id',v_event_id);
end; $$;

revoke all on function public.manage_privileged_user(uuid,uuid,bigint,text,boolean,text[],text) from public,anon,authenticated;
revoke all on function public.create_privileged_user(uuid,text,text,text[],text) from public,anon,authenticated;
revoke all on function public.set_default_reviewer(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.set_book_reviewer_override(uuid,uuid,bigint,uuid,text) from public,anon,authenticated;
revoke all on function public.manage_review_assignment(uuid,uuid,uuid,bigint,uuid,uuid,text,text) from public,anon,authenticated;
revoke all on function public.reassign_book_employee(uuid,uuid,bigint,text,text,text,text,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.manage_privileged_user(uuid,uuid,bigint,text,boolean,text[],text) to service_role;
grant execute on function public.create_privileged_user(uuid,text,text,text[],text) to service_role;
grant execute on function public.set_default_reviewer(uuid,uuid,text) to service_role;
grant execute on function public.set_book_reviewer_override(uuid,uuid,bigint,uuid,text) to service_role;
grant execute on function public.manage_review_assignment(uuid,uuid,uuid,bigint,uuid,uuid,text,text) to service_role;
grant execute on function public.reassign_book_employee(uuid,uuid,bigint,text,text,text,text,text,text,uuid,text) to service_role;
