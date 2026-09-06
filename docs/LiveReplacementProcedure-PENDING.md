# Controlled Live Replacement Verification — PROCEDURE (PENDING APPROVAL)

**STATUS: PREPARED. NOT EXECUTED. Requires explicit operator approval before any
live Supabase mutation or ReviewStudio POST/DELETE.**

This procedure verifies the Content file **true delete-and-replace** path against
the live ReviewStudio account (`iwdnow.reviewstudio.com`, API v2.1) and a
**disposable staging book**. It performs real external ReviewStudio deletion and
real Supabase `book_files` mutation — do NOT run without approval.

---

## Preconditions (verify before starting)

- Operator has approved this exact procedure.
- A disposable staging book exists with a **book-specific employee token**
  (`book_id` + `access_token`) whose scope allows Content upload/replace.
- At least one current file exists to replace. If the book has no manuscript or
  no cover yet, do a **first-upload** (not replacement) first so there is
  something to replace.
- ReviewStudio credentials (`REVIEWSTUDIO_ADMIN_EMAIL`, `REVIEWSTUDIO_API_KEY`,
  `REVIEWSTUDIO_API_BASE_URL`, `REVIEWSTUDIO_TEMP_BUCKET`) are configured for the
  deployed Edge Function. **Never** print them.
- Record pre-test state read-only (see Step 1) before any mutation.

## Contract under test (from `_replaceOrchestration.ts`)

1. resolve current `book_files` row (`is_latest=true`) for `(book_id, file_type,
   section_key)`
2. POST new file into the **SAME** Review (`/reviews/{review_id}/files`)
3. insert new `book_files` row `is_latest=true`
4. mark old row `is_latest=false` + `replaced_by_file_id=new.id`
5. DELETE old RS file (`/reviews/{review_id}/files/{old_file_id}`, last step, no
   `delete_all_versions`, no auto-retry)

---

## Step 1 — Read-only baseline (before mutation)

Query (read-only) for the disposable book:

```sql
-- service-role / read-only inspection only; never via browser
select id, book_id, file_type, section_key, is_latest,
       replaced_by_file_id, reviewstudio_review_id, reviewstudio_file_id,
       reviewstudio_file_url, file_status
from public.book_files
where book_id = '<DISPOSABLE_BOOK_ID>'
order by file_type, uploaded_at desc;
```

Record:
- `manuscript`: current row id + reviewstudio_review_id + reviewstudio_file_id
- `cover`: current row id + reviewstudio_review_id + reviewstudio_file_id
- Both should be the ONLY `is_latest=true` row for their `(file_type, section_key)`.
- Confirmed the same Review is used per file type (the workflow uses a separate
  Review per file type).

## Step 2 — Prepare a small, harmless replacement file

Use a tiny valid manuscript (PDF) and cover (JPG/TIFF) in the temp bucket that
the Edge Function's server-side `uploadContentFileToReviewStudio` will POST to
ReviewStudio. The file is uploaded to Supabase temp storage first; the Edge
Function then hands ReviewStudio a signed URL.

## Step 3 — Execute Replace Manuscript (APPROVAL REQUIRED)

Call the deployed Edge Function (server-side path only):

```
POST https://<supabase>.functions/v1/uploadContentFileToReviewStudio
{
  "book_id": "<DISPOSABLE_BOOK_ID>",
  "access_token": "<SCOPED_EMPLOYEE_TOKEN>",   // never log the token
  "step_name": "content",
  "file_type": "manuscript",
  "section_key": "content.manuscript"
}
```
with the multipart file body.

**Expected (ok:true):**
- response contains new `book_file_id`, `reviewstudio_file_id`,
  `reviewstudio_file_url`, `processing_status`
- `cleanup_pending` absent (or present only if the old RS DELETE failed)

## Step 4 — Verify Replace Manuscript state (read-only)

```sql
select id, file_type, is_latest, replaced_by_file_id,
       reviewstudio_review_id, reviewstudio_file_id
from public.book_files
where book_id = '<DISPOSABLE_BOOK_ID>' and file_type = 'manuscript'
order by uploaded_at desc;
```

Check:
- exactly ONE row `is_latest=true` (the new one)
- old row `is_latest=false` AND `replaced_by_file_id = <new_id>`
- new row `reviewstudio_review_id` == old row's review (same Review reused)
- `reviewstudio_file_id` is a NEW id (different from old)
- old RS file returns 404/410 when GET `/reviews/{review_id}/files/{old_id}`
  (deleted), new RS file returns 200 (present)
- `integration_events` row for the replacement phase = success

## Step 5 — Execute + verify Replace Cover (APPROVAL REQUIRED)

Repeat Steps 3–4 with `"file_type": "cover"`, `"section_key": "content.cover"`.
Same assertions.

## Step 6 — Portal refresh check

Load `loadEmployeePage` for the disposable book (read-only, scoped token) and
confirm the returned `files` array shows ONLY the new manuscript + new cover
(`is_latest=true` filter), i.e. the portal points only at the replacement.

---

## Rollback / recovery notes

- If the new RS upload fails: old file remains authoritative; nothing to roll back.
- If the new `book_files` insert fails: Edge Function attempts to DELETE the
  orphan new RS file; old remains authoritative.
- If the supersede update fails: operation returns `requires_reconciliation`;
  the old RS file is NOT deleted. A reconciliation job must set
  `old.is_latest=false, old.replaced_by_file_id=new.id` before any further use.
- If the old RS DELETE fails: new row is authoritative, `cleanup_pending`
  recorded; a reconciliation job performs the hard delete of the old RS file.

---

## Non-goals

- No first-upload path execution here (only replacement).
- No production book touched. No production GHL page.
- No ReviewStudio versioning (`delete_all_versions`) — explicitly not used.
- No auto-retry of the DELETE.

---

## Approval gate

**Do not run Steps 3 or 5 without explicit operator approval.** This procedure
causes irreversible external ReviewStudio deletion and real Supabase mutation on
a disposable staging book only.
