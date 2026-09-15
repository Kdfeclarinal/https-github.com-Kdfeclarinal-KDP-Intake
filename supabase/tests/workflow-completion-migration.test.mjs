import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  new URL(
    '../migrations/20260914000000_review_round_completion.sql',
    import.meta.url
  ),
  'utf8'
);
const continuationSql = readFileSync(
  new URL('../migrations/20260915000000_review_update_continuation.sql', import.meta.url),
  'utf8'
);

test(
  'review persistence RPC is server-only and locks the active round',
  () => {
    assert.match(
      sql,
      /create or replace function public\.apply_admin_review_action/i
    );

    assert.match(
      sql,
      /from public\.book_review_rounds[\s\S]*for update/i
    );

    assert.match(
      sql,
      /revoke all on function public\.apply_admin_review_action[\s\S]*anon, authenticated/i
    );
  }
);

test(
  'finalization and resubmission are transactional server-only RPCs',
  () => {
    assert.match(
      sql,
      /create or replace function public\.finalize_kdp_review_round/i
    );

    assert.match(
      sql,
      /create or replace function public\.resubmit_kdp_book_for_review/i
    );

    assert.match(
      sql,
      /KDP_INTAKE_APPROVED/i
    );

    assert.match(
      sql,
      /EMPLOYEE_UPDATES/i
    );

    assert.match(
      sql,
      /book_review_rounds_one_active_per_book[\s\S]*finalized_at is null/i
    );
  }
);

test(
  'comment numbering and review history are concurrency and audit protected',
  () => {
    assert.match(
      sql,
      /pg_advisory_xact_lock/i
    );

    assert.match(
      sql,
      /unique[\s\S]*review_round_id[\s\S]*round_comment_number/i
    );

    assert.match(
      sql,
      /book_review_audit_events/i
    );
  }
);

test(
  'employee update and Basecamp lifecycle mappings are durable and idempotent',
  () => {
    assert.match(
      sql,
      /employee_update/i
    );

    assert.match(
      sql,
      /basecamp:employee-update:/i
    );

    assert.match(
      sql,
      /basecamp:review-round:/i
    );

    assert.match(continuationSql, /book_review_update_replies/i);
    assert.match(continuationSql, /create or replace function public\.prevent_finalized_review_mutation/i);
  }
);

test(
  'review mutations enforce server-side page prerequisites',
  () => {
    assert.match(
      sql,
      /Review page is not accessible/i
    );

    assert.match(
      sql,
      /reached_steps/i
    );

    assert.match(
      sql,
      /p_action = 'reach_step'/i
    );
  }
);

test(
  'carry-forward metadata is set only when the approval itself carries',
  () => {
    assert.match(
      sql,
      /cross join lateral[\s\S]*as carries/i
    );

    assert.match(
      sql,
      /case when carry\.carries then old\.id else null end/i
    );
  }
);

test(
  'Pricing carry-forward is invalidated by requested marketplace or file dependencies',
  () => {
    assert.match(
      sql,
      /d\.step_name::text\s*<>\s*'pricing'/i
    );

    assert.match(
      sql,
      /dep\.is_file_section\s*=\s*true/i
    );

    assert.match(
      sql,
      /primary_marketplace/i
    );
  }
);

test(
  'only one Basecamp outcome sync may remain pending per review round',
  () => {
    assert.match(
      sql,
      /basecamp_one_pending_review_outcome_sync/i
    );

    assert.match(
      sql,
      /review_outcome_sync_requested[^;]*review_outcome_retry_requested/i
    );
  }
);

test(
  'review snapshots compare qualified definitions to step-local serialized section keys',
  () => {
    assert.match(
      sql,
      /split_part\(d\.section_key\s*,\s*'\.'\s*,\s*2\)/i
    );

    assert.match(
      sql,
      /split_part\(i\.section_key\s*,\s*'\.'\s*,\s*2\)/i
    );
  }
);

test(
  'file-backed ready-for-rereview compares frozen and current file identities',
  () => {
    assert.match(
      sql,
      /update_baseline_hash[\s\S]*file_references/i
    );

    assert.match(
      sql,
      /reviewstudio_file_id/i
    );
  }
);

test(
  'reopen is limited to an approved section so unresolved requested changes cannot become pending',
  () => {
    assert.match(
      sql,
      /p_action = 'reopen'[\s\S]*v_item\.decision\s*<>\s*'approved'[\s\S]*Only an approved section may be reopened/i
    );

    assert.match(
      sql,
      /decision\s*=\s*'pending'[\s\S]*decision_source\s*=\s*'reopened'/i
    );
  }
);
