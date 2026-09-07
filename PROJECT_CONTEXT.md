# KDP Intake / Admin Review — Project Context

## Purpose

This repository supports an internal KDP book-launch intake and admin-review workflow used for publishing operations.

The current system covers:

```text
Employee Bookshelf / project list
→ Details intake
→ Content intake
→ Pricing intake
→ Submit for Approval
→ Admin Details review
→ Admin Content review
→ Admin Pricing review
→ Approve Book or Request Updates
→ status/history / downstream operations
```

This is an existing in-progress project. The backend and much of the current GoHighLevel implementation already work. Do not restart the project from zero.

---

## Current High-Level Status

Approximate project completion for the existing KDP funnel/system: **about 85–90%**.

This percentage is a planning estimate, not a production-readiness claim.

The system is not production-ready until the remaining admin flow, finalization, external integration requirements, regression checks, and security release review are complete.

---

## Current Architecture

### Frontend / Operational Surface

GoHighLevel currently hosts the employee and admin intake/review pages.

The current implementation uses a mixture of:

- native GHL page elements
- custom HTML/CSS/JavaScript
- page-specific controllers
- custom review controls
- GHL page navigation

The existing implementation is selector-heavy and has accumulated page-specific hydration/DOM behavior. It remains valuable as a working behavioral reference.

### Source of Truth

Supabase is the canonical backend source of truth for:

- books
- step data / drafts
- workflow progress
- review rounds
- review items
- file references / metadata
- access-token records
- status/audit history

### External Systems

**ReviewStudio**
- Used for manuscript/cover review files and review links.
- Flow is Client → Project → Review → Review File.
- Privileged ReviewStudio API operations belong on the server/Edge Function side.

**GoHighLevel**
- Current page/funnel/CRM surface.
- Long-term role may include funnel entry points, contacts, notifications, tasks, and workflow events.
- Important workflow events should be synchronized through a backend path, not by exposing private GHL credentials in the browser.

**Basecamp**
- Planned downstream/integration requirement before final deployment according to current project direction.
- Exact integration design and implementation status are not yet verified in this repository context.

---

## Supabase Data Model — Known Important Tables

Current known tables include:

```text
public.books
public.book_step_data
public.kdp_section_definitions
public.book_review_rounds
public.book_review_items
public.book_files
public.book_access_tokens
public.book_status_history
```

Do not assume this list is exhaustive. Repository/database inspection remains authoritative.

---

## Known Important Backend Functions

### Edge Functions

Current known deployed/function contracts referenced by the frontend include:

```text
loadEmployeePage
saveEmployeeStep
loadAdminReviewPage
saveAdminReviewPage
```

Tracked source is present for `loadEmployeePage` and the Content upload path.
No tracked source, migration, deployment artifact, or Git history for
`saveEmployeeStep` exists in this repository as of 2026-09-07; only its frontend
HTTP contract and historical notes are present. Do not treat its server-side
validation or workflow transition behavior as repository-verified until a
read-only deployed-source/database capture is obtained.

Other submission, ReviewStudio, finalization, or synchronization functions may exist and must be verified from the repository before use.

### Database RPC / Transactional Review Save

Known function:

```text
public.save_admin_review_page(
  p_book_id uuid,
  p_review_round_id uuid,
  p_step_name text,
  p_review_items jsonb,
  p_admin_name text,
  p_admin_email text,
  p_source text
)
```

Verified design intent:

- atomic page-level admin review save
- rejects missing/pending/duplicate/unknown/inconsistent review items
- preserves frozen employee `section_snapshot`
- server-side authorization is performed before invoking privileged database operations
- executable only through privileged/server paths, not directly from the public browser

Repository/database state must be checked before relying on exact grants or implementation details.

---

## Access / Authorization Model

The current project uses scoped opaque access tokens rather than Supabase Auth as its primary page-access model.

Current pattern:

```text
raw access token in authorized browser flow
→ SHA-256 hash server-side
→ book_access_tokens lookup
→ role / page / action / book / review-round checks
→ server-authorized operation
```

Known token categories:

### Employee Bookshelf token

- employee-scoped entry/access token
- not necessarily tied to one book
- used to access/open the employee Bookshelf and transition into a book-specific workflow

### Book-specific employee token

- tied to a specific book
- used across employee Details / Content / Pricing as allowed by token permissions

### Admin review token

- role: admin
- tied to a specific `book_id`
- tied to a specific `review_round_id`
- expected to carry allowed admin pages/actions
- used across Admin Details / Content / Pricing for that review round

Do not replace this model with Supabase Auth or another auth design without explicit architecture approval.

---

# Current Functional Progress

## Employee Bookshelf

Status: **VERIFIED / substantially working**

Known behavior:

- secure employee Bookshelf exists
- Bookshelf access can lead into a book-specific employee intake context
- return URL/session behavior has been implemented
- Supabase-backed project/book state is used

Do not assume every legacy Bookshelf edge case has been regression-tested recently.

---

## Employee Details

Status: **VERIFIED / largely working**

Known frontend behavior includes:

- draft save
- Save & Continue
- navigation only after the save response reports server-authoritative Details
  completion and Content unlock
- Supabase persistence
- searchable book fields synchronized from Details where intended

---

## Employee Content

Status: **PARTIAL / frontend and upload boundary verified; save backend source missing**

Known working behavior includes:

- manuscript upload flow
- cover upload flow
- ReviewStudio file metadata/references
- Content persistence
- accessibility and other submitted Content fields
- ReviewStudio preview/review links

Known issue discovered during current work:

- DRM radio was not required by the existing employee Content validation.
- Existing database audit found some legacy/test Content rows with blank/missing DRM.
- At least one submitted/reviewing book legitimately contains no DRM choice because the old workflow allowed it.
- Do not invent or auto-fill a Yes/No answer for legacy submissions.

The repository has no `saveEmployeeStep` implementation to verify the server-side
DRM rule, other Content completion rules, or Pricing unlock transition. A
read-only capture of the deployed function and relevant database/RPC contract is
required before those claims can be promoted to repository-verified behavior.

Target rule going forward:

```text
Save as Draft:
DRM may remain unanswered.

Save & Continue / complete Content:
DRM must be exactly one approved radio value.
```

Verified hardening rules (2026-09-07):

- `loadEmployeePage` requires an unrevoked, unexpired, exact employee-role token
  directly bound to the requested book with exact action
  `load_employee_page`; broad bookshelf actions do not authorize a book read.
  Unknown steps and locked future steps are denied from authoritative workflow
  state.
- Read-triggered ReviewStudio reconciliation may mutate `book_files` only when
  that token additionally carries `upload_content_file_to_reviewstudio` and the
  authoritative book status is `draft` or `needs_updates`.
- Content file presence is derived from the protected loader's reconciled current
  file set; stale saved upload booleans cannot complete Content.
- Draft serialization preserves unanswered AI-content, publishing-rights, and
  adult-content choices rather than inventing defaults.
- ReviewStudio 200 responses require a valid expected resource object; project
  and review reuse must be a confirmed related pair when relationship data is
  available.
- Replacement rows are staged non-current and promoted atomically by the local
  `promote_replacement_book_file` migration/RPC. The migration is prepared but
  not applied; deployment must sequence the migration before compatible function
  code.

---

## Employee Pricing

Status: **IMPLEMENTED / NOT RECENTLY RE-PROVEN END-TO-END**

Known page/workflow exists for pricing, royalty selection, marketplace/list price logic, and persistence.

Do not call it fully verified until the current repository/runtime is inspected and the complete employee flow is regression-tested.

---

## Admin Details

Status: **VERIFIED / functionally complete for the current workflow**

Known working behavior:

- protected admin loader
- 13 reviewable Details items hydrate
- saved review decisions/comments restore
- statuses: pending / approved / needs_updates
- comments optional
- pending decisions block Save & Continue
- bulk Approve All / Update All behavior implemented
- page-level admin save persists reviewer metadata/comments/decisions
- secure navigation from Admin Details → Admin Content preserves required review context

Current important legacy GHL controller/mount identifiers include:

```text
#custom-code-hf2-vbEOgu
#custom-code-nlj-grf1qW
```

These identifiers are implementation history, not future architectural requirements.

---

## Admin Content

Status: **PARTIAL / close to complete**

This page is not far from working. Protected data retrieval is already substantially proven.

Verified/proven behavior from the current implementation:

```text
protected loadAdminReviewPage call        PASS
page = admin_content                      PASS
6 frozen Content review items             PASS
submitted Content display restore runs    PASS
saved review state restore runs            PASS
ReviewStudio review option UI available   PASS
cover file metadata available             PASS
backend can return a cover preview URL     PASS
```

The current `loadAdminReviewPage` response has been extended in development to return Content display-only data, including a cover preview URL. Runtime evidence showed:

```text
hasDisplayData: true
hasCoverPreviewUrl: true
reviewItemCount: 6
```

The current test submission's DRM value is blank because the employee did not select Yes or No under the old validation rules. That is data truth, not a loader failure.

Remaining Admin Content work includes:

- hook the returned cover preview URL into the existing Admin Content UI
- display submitted DRM state correctly for future valid submissions
- represent legacy blank DRM without inventing a value
- complete final end-to-end page save/navigation proof
- run regression and security-preserving tests

Current important legacy GHL identifiers include:

```text
#custom-code-iJ5bo0HKN4
#custom-code-QehqrTbExX
```

---

## Admin Pricing

Status: **NOT YET COMPLETED / VERIFIED**

Admin Pricing still needs the same server-authoritative review behavior and end-to-end verification pattern used for Admin Details/Content.

---

## Final Admin Decision / Status

Status: **NOT YET COMPLETED / VERIFIED**

Required business rule:

```text
All reviewable items across Details + Content + Pricing decided.

If all are approved:
→ Approve Book

If any are needs_updates:
→ Request Updates

If any remain pending:
→ block finalization
```

Finalization must be enforced server-side, not only by button state.

---

# Review Workflow Rules

For every reviewable segment on the current admin page:

- `pending` blocks Save & Continue
- `approved` is a valid decision
- `needs_updates` is a valid decision
- comments are optional unless a future business rule explicitly changes that

The server must reject incomplete or inconsistent review payloads even if the browser is manipulated.

Frozen employee snapshots must remain authoritative for the review round; admin review must not silently read mutable live employee values when the workflow requires submitted/frozen data.

---

# File / ReviewStudio Context

Known ReviewStudio integration direction:

```text
Client
→ Project
→ Review
→ Review File
```

Files are uploaded to a Review, not directly to a Project.

Supabase stores ReviewStudio IDs/URLs/metadata needed by the workflow.

Browser-visible review/preview URLs may be returned when safe, but ReviewStudio API credentials remain server-only.

Cover/manuscript UI must not expose employee upload/replace controls to admins unless explicitly permitted by the workflow.

---

# Approved Architecture Direction — August 2026

The project direction has been reassessed because the current GHL implementation has become expensive to maintain due to many page-specific Custom Code blocks, selectors, CSS fragments, and hydration behavior.

The approved direction **in principle** is a hybrid frontend strategy:

```text
KEEP
- Supabase schema
- workflow/business rules
- access-token model
- Edge Functions
- ReviewStudio integration
- review rounds/items
- audit/history

POTENTIALLY REPLACE OVER TIME
- fragmented selector-heavy GHL frontend implementation
- duplicated page CSS/JS
- page-specific DOM patching
```

This is **not yet approval for a full rebuild**.

---

# React + Vite GHL App-Shell POC

Status: **APPROVED IN PRINCIPLE / IMPLEMENTATION NOT YET AUTHORIZED**

The next architecture experiment is a tiny React + Vite app-shell proof of concept on an isolated GHL staging funnel page.

Purpose:

Confirm that a compiled React/Vite app can mount inside GHL without breaking hydration, security, responsiveness, or existing protected Edge Function access.

Required build direction:

- React
- Vite
- classic IIFE-compatible output for GHL mount
- one `app.js`
- one `app.css`
- mount into `#kdp-intake-app`
- no raw JSX inside GHL
- no Next.js
- no Redux
- no heavy UI framework
- no backend rewrite
- no production-page changes

POC test goals:

1. external React bundle loads on isolated GHL staging page
2. app mounts exactly once
3. handles `DOMContentLoaded` and `hydrationDone`
4. renders a small KDP App Shell POC panel
5. calls one existing protected Supabase Edge Function
6. reads one disposable test book/status
7. performs one harmless test-only update through an existing protected Edge Function
8. sends one backend-generated test GHL event only if a suitable existing backend sender already exists
9. works in GHL preview and published staging page
10. works on desktop/mobile
11. browser inspection shows no private credentials/secrets

The POC must not migrate:

- Details
- Content
- Pricing
- Admin Details
- Admin Content
- Admin Pricing

The first architectural gate is the mount-only proof before Supabase integration is added.

---

# POC Rollback Principle

The POC must be isolated and disposable.

Rollback should require only:

- remove/disable the staging GHL Code element/page
- remove/archive POC static assets
- archive/delete the disposable POC book if appropriate
- discard the POC frontend directory/branch

It must not require restoring production GHL pages or production backend code.

---

# Current Next Step

Before POC implementation:

1. establish repository control documents
   - `CLAUDE.md`
   - `PROJECT_CONTEXT.md`
   - `SECURITY_PROFILE.md`
2. run read-only Claude Code repository reconnaissance
3. verify installed tools/skills and actual security modules
4. reconcile documentation against repository evidence
5. only then approve minimal React/Vite dependencies and mount-only POC implementation

Do not install dependencies or build the POC until the reconnaissance report is reviewed/approved.

---

# Known Gaps / Risks

- Admin Pricing and finalization are not complete/verified.
- Admin Content still needs final UI hookup and end-to-end proof.
- DRM legacy submissions may be blank because old employee validation did not require a choice.
- Final security bypass/release testing has not yet been completed.
- Token values can appear in browser URLs; they must never be copied into logs/reports and any exposed development token must be rotated/reissued before release.
- Current GHL frontend is maintainable but increasingly fragile due to selector/hydration coupling.
- Basecamp integration remains a deployment prerequisite/direction but exact implementation status is not yet verified here.
- GHL backend synchronization capabilities must be inspected before the POC attempts an outbound test event.

---

# Verification Ledger Rules

Use these labels in this document:

- `VERIFIED` — proven by source + relevant runtime/test evidence
- `PARTIAL` — meaningful implementation exists but important behavior remains unverified/incomplete
- `PLANNED` — approved direction but not implemented
- `BLOCKED` — cannot proceed until a stated dependency is resolved
- `N/A` — not applicable

Do not mark research findings, comments, or planned architecture as verified runtime behavior.

After meaningful behavior is proven, update the relevant section rather than creating a second conflicting truth file.
