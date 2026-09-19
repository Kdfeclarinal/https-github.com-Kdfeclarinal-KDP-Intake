-- Fix review-start status-history attribution. book_status_history.actor_type
-- uses public.kdp_actor_type, whose privileged human actor label is 'admin'.
-- The earlier CAS wrapper wrote 'privileged', which is not a valid enum value.

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
      insert into public.book_status_history(
        book_id,review_round_id,action,actor_type,actor_privileged_user_id,
        subject_privileged_user_id,from_status,to_status,note,metadata
      )
      values(
        p_book_id,p_review_round_id,'review_started','admin',p_actor_user_id,
        p_actor_user_id,v_book.overall_status,'IN_REVIEW',
        'Review started on the first meaningful reviewer mutation.',
        jsonb_build_object('review_action',p_action)
      );
    end if;
  end if;
  return v_result||jsonb_build_object('revision',v_revision);
end;
$$;

revoke all on function public.apply_admin_review_action(uuid,uuid,uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.apply_admin_review_action(uuid,uuid,uuid,text,bigint,jsonb) to service_role;
