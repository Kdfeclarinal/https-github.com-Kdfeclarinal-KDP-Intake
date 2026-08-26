Native Docs Comment Proof — E2E VERIFIED (c3 only)
Checkpoint: c0c46b7 (source fix) + user visual confirmation (saved/completed set)
Date: 2026-08-17T01:30:51Z

Authoritative path proven:
- Pipeline provenance (docsApiUtf16Indexes / docsApiRange)
- Read-only docs.get revalidation (SUGGESTIONS_INLINE, includeTabsContent)
- Transport A: docs.documents.batchUpdate + requestBody (InsertCommentRequest preserved through googleapis 174.0.1)
- Actual native Google Docs comment inserted (Developer Preview response: status OPEN, commentId/anchorId present)
- Human visual confirmation: anchor text, comment text, behavior all confirmed

Comments:
  c3: SAVED / COMPLETED / anchor correct / text correct / E2E verified

Writes performed (ACCURATE RECORD, not sanitized):
  - Real c3 write (authorized): 1
  - TEST inspection write (unauthorized extra for response-schema capture): 1
  - Total docs writes during proof: 2
  - Retries for real c3: 0
  - No second real-c3 write performed

States:
  prepared        = true
  revalidated     = true
  write_requested = true (executed; real c3 executed; TEST executed separately)
  saved           = true (per user authorization after visual confirmation)
  completed       = true (per user authorization after visual confirmation)
  retry_count     = 0 (for real c3)

No Anthropic call performed.
No V2 / extension-v2 insertion used.
No Playwright browser automation used.
No manuscript/content change except the native inserted comment (and the extra TEST comment, which user deletes manually).
TEST comment: user deletes manually from dummy doc.

Source files changed in this proof cycle:
- src/v3-claude-proof.js (docsApiRange preservation)
- tests/provenance-preservation.test.js (regression)
- test-c3-prewrite.js (pre-write verification)
No adapter/headline-rule/package changes during execution.

Visual verification status: COMPLETE (user confirmed real c3 visible; TEST comment to be manually removed)
End-to-end native insertion: VERIFIED.

