-- Final Admin Review terminal CAS repair.
-- The revision-aware wrapper must advance the round revision before the
-- canonical four-argument finalizer marks the round immutable. Updating the
-- revision after finalized_at is set is correctly rejected by the immutability
-- trigger.

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
set search_path=''
as $$
declare
  v_book public.books%rowtype;
  v_round public.book_review_rounds%rowtype;
  v_expected_outcome text;
  v_result jsonb;
  v_revision bigint;
begin
  if p_outcome not in ('request_updates','approve_book') then
    raise exception 'Review outcome is invalid.';
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

  if not exists (
    select 1
    from public.privileged_users u
    join public.privileged_user_capability_grants g
      on g.privileged_user_id=u.id
    where u.id=p_actor_user_id
      and u.disabled_at is null
      and g.capability_key='can_finalize_book'
      and g.revoked_at is null
      and exists (
        select 1
        from public.privileged_user_capability_grants review_grant
        where review_grant.privileged_user_id=u.id
          and review_grant.capability_key='can_review'
          and review_grant.revoked_at is null
      )
  ) then
    raise exception 'Book finalization is not authorized.';
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

  v_expected_outcome := case
    when p_outcome='approve_book' then 'approved'
    else 'request_updates'
  end;

  if v_round.finalized_at is not null then
    if v_round.outcome=v_expected_outcome then
      return public.finalize_kdp_review_round(
        p_book_id,p_review_round_id,p_actor_user_id,p_outcome
      );
    end if;
    raise exception 'Review round is immutable.';
  end if;

  if v_book.latest_review_round_id is distinct from v_round.id then
    raise exception 'Active review round is unavailable.';
  end if;

  if p_expected_revision is null or v_round.revision is distinct from p_expected_revision then
    raise exception using errcode='40001', message='Review changed elsewhere.';
  end if;

  update public.book_review_rounds
  set revision=revision+1
  where id=p_review_round_id
  returning revision into v_revision;

  v_result := public.finalize_kdp_review_round(
    p_book_id,p_review_round_id,p_actor_user_id,p_outcome
  );

  update public.books
  set employee_revision=employee_revision+1
  where id=p_book_id;

  return v_result || jsonb_build_object('revision',v_revision);
end;
$$;

revoke all on function public.finalize_kdp_review_round(uuid,uuid,uuid,text,bigint)
  from public,anon,authenticated;
grant execute on function public.finalize_kdp_review_round(uuid,uuid,uuid,text,bigint)
  to service_role;
