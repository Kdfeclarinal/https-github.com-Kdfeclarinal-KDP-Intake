-- Fix the submitted-review immutability trigger so normal review decisions/comments
-- can update book_review_items without the trigger referencing round-only columns.
-- Historical migration 20260913000000 installed one generic trigger function for
-- both tables; PostgreSQL resolves NEW/OLD against the firing table at runtime,
-- so the round-only submission_snapshot access fails on book_review_items updates.

create or replace function public.prevent_submitted_review_round_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.submission_snapshot is distinct from old.submission_snapshot
     or new.submitted_at is distinct from old.submitted_at
     or new.submitted_by_actor_type is distinct from old.submitted_by_actor_type
     or new.submitted_by_email is distinct from old.submitted_by_email
     or new.submitted_by_name is distinct from old.submitted_by_name then
    raise exception 'Submitted review snapshots are immutable.';
  end if;
  return new;
end;
$$;

create or replace function public.prevent_submitted_review_item_snapshot_mutation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.section_snapshot is distinct from old.section_snapshot
     or new.section_key is distinct from old.section_key
     or new.step_name is distinct from old.step_name
     or new.review_round_id is distinct from old.review_round_id
     or new.book_id is distinct from old.book_id then
    raise exception 'Submitted review item snapshots are immutable.';
  end if;
  return new;
end;
$$;

drop trigger if exists book_review_rounds_prevent_snapshot_mutation on public.book_review_rounds;
drop trigger if exists book_review_items_prevent_snapshot_mutation on public.book_review_items;

create trigger book_review_rounds_prevent_snapshot_mutation
before update on public.book_review_rounds
for each row execute function public.prevent_submitted_review_round_snapshot_mutation();

create trigger book_review_items_prevent_snapshot_mutation
before update on public.book_review_items
for each row execute function public.prevent_submitted_review_item_snapshot_mutation();

drop function if exists public.prevent_submitted_review_snapshot_mutation();
