-- Upgrade-safe closeout for locked Decisions 8 and 38.
-- This migration intentionally wraps previously deployed functions instead of
-- changing historical migrations that installed environments have already run.

alter table public.book_review_rounds
  add column if not exists started_at timestamptz,
  add column if not exists started_by_user_id uuid references public.privileged_users(id) on delete restrict;

comment on column public.book_review_rounds.started_at is
  'First successful meaningful reviewer mutation; navigation and assignment do not start review.';
comment on column public.book_review_rounds.started_by_user_id is
  'Reviewer responsible for the first meaningful mutation. Written once.';

alter function public.submit_kdp_book_for_approval(uuid,text,text)
  rename to submit_kdp_book_for_approval_without_owner_fallback;

create function public.submit_kdp_book_for_approval(
  p_book_id uuid,
  p_token_hash text,
  p_source text default 'employee_pricing_submit'
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_result jsonb;
  v_round public.book_review_rounds%rowtype;
  v_owner_id uuid;
begin
  v_result := public.submit_kdp_book_for_approval_without_owner_fallback(p_book_id,p_token_hash,p_source);
  select * into v_round from public.book_review_rounds
    where id=(v_result->>'review_round_id')::uuid and book_id=p_book_id for update;
  if v_round.id is null then raise exception 'Submitted book has no active review round.'; end if;
  if v_round.reviewer_user_id is null then
    select u.id into v_owner_id
    from public.privileged_users u
    join public.privileged_user_capability_grants g on g.privileged_user_id=u.id
      and g.capability_key='can_review' and g.revoked_at is null
    where u.role_key='owner' and u.disabled_at is null
    order by u.created_at,u.id limit 1;
    if v_owner_id is not null then
      update public.book_review_rounds set reviewer_user_id=v_owner_id,
        reviewer_assignment_source='owner_fallback',reviewer_assigned_at=coalesce(reviewer_assigned_at,now())
        where id=v_round.id;
      update public.books set assigned_reviewer_user_id=v_owner_id,
        reviewer_assignment_source='owner_fallback',reviewer_assigned_at=coalesce(reviewer_assigned_at,now()),updated_at=now()
        where id=p_book_id and latest_review_round_id=v_round.id;
      if coalesce((v_result->>'already_submitted')::boolean,false) is false then
        update public.basecamp_references set metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('reviewer_user_id',v_owner_id),updated_at=now()
          where book_id=p_book_id and review_round_id=v_round.id and reference_kind='review_round';
        update public.book_status_history set subject_privileged_user_id=v_owner_id,
          metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('reviewer_assignment_source','owner_fallback')
          where book_id=p_book_id and review_round_id=v_round.id and action='submitted_for_approval';
      end if;
      v_result := v_result||jsonb_build_object('reviewer_user_id',v_owner_id);
    end if;
  end if;
  return v_result;
end;
$$;

revoke all on function public.submit_kdp_book_for_approval_without_owner_fallback(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.submit_kdp_book_for_approval(uuid,text,text) from public,anon,authenticated;
grant execute on function public.submit_kdp_book_for_approval(uuid,text,text) to service_role;

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
set search_path=''
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
    raise exception using errcode='40001',message='Review changed elsewhere.';
  end if;

  v_result := public.apply_admin_review_action(p_book_id,p_review_round_id,p_actor_user_id,p_action,p_payload);
  if p_action = 'reach_step' then
    update public.book_review_rounds set status=v_round.status,
      reached_steps=case when (p_payload->>'step_name')=any(reached_steps) then reached_steps else array_append(reached_steps,p_payload->>'step_name') end,
      revision=revision+1 where id=p_review_round_id returning revision into v_revision;
  else
    update public.book_review_rounds set status='in_review',
      started_at=coalesce(started_at,now()),
      started_by_user_id=coalesce(started_by_user_id,p_actor_user_id),
      revision=revision+1 where id=p_review_round_id returning revision into v_revision;
    if v_round.started_at is null then
      update public.books set overall_status='IN_REVIEW',updated_at=now(),last_modified_at=now()
        where id=p_book_id and overall_status::text in ('for_approval','AWAITING_REVIEW');
      insert into public.book_status_history(book_id,review_round_id,action,actor_type,subject_privileged_user_id,from_status,to_status,note,metadata)
      values(p_book_id,p_review_round_id,'review_started','privileged',p_actor_user_id,v_book.overall_status,'IN_REVIEW',
        'Review started on the first meaningful reviewer mutation.',jsonb_build_object('review_action',p_action));
    end if;
  end if;
  return v_result||jsonb_build_object('revision',v_revision);
end;
$$;

revoke all on function public.apply_admin_review_action(uuid,uuid,uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.apply_admin_review_action(uuid,uuid,uuid,text,bigint,jsonb) to service_role;
