-- Align the legacy comment columns with the current round-local comment model.
-- Section comments are authoritatively bound through review_item_id; general comments
-- intentionally have no review item. Newer mutation/continuation code therefore must
-- not be blocked by legacy NOT NULL requirements on duplicated step/section columns.

alter table public.book_review_comments
  alter column review_item_id drop not null,
  alter column step_name drop not null,
  alter column section_key drop not null;
