# KDP Intake / Admin Review — Project Context

## Purpose

This repository supports an internal KDP book-launch intake and admin-review workflow used for publishing operations.

The current system covers:

```text
Privileged Bookshelf / Create Book
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

## Locked Product Authority

[Decisions 1–70](docs/KDP_LOCKED_DECISIONS_1_70.md) are the current locked
product/workflow authority. Later numbered decisions and the document's
supersession/clarification map govern where older notes differ. A review round
may temporarily be unassigned while awaiting assignment; once assigned, exactly
one active reviewer owns normal review mutations. Owner or a properly capable
Tech Admin may deliberately reassign or take over. This remains the approved D7/D8 clarification.

The employee workflow continues to use book-scoped opaque authorization.
Privileged Bookshelf and reviewer operations use Google authentication followed
by a Supabase privileged-user record and server-loaded capabilities.

---

## Current Architecture

### Frontend / Operational Surface

React is the application workflow UI direction for Bookshelf, employee intake,
and Admin Review. The locally verified React/Vite shell is intended to run in
the existing GoHighLevel-hosted surface. Legacy GHL pages and their mixture of:

- native GHL page elements
- custom HTML/CSS/JavaScript
- page-specific controllers
- custom review controls
- GHL page navigation

remain present during the staged cutover and are valuable as behavioral
references. They are not the direction for new workflow UI work.

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
- Under Decisions 45–46, a genuine later asset replacement must become a native
  V2/V3/etc. version in the same logical ReviewStudio review, and each KDP review
  round must map to the exact ReviewStudio version it reviewed. The current
  delete-and-replace implementation is historical behavior and this native
  versioning contract is not implemented yet.

**GoHighLevel**
- Current page/funnel/CRM surface.
- Long-term role may include funnel entry points, contacts, notifications, tasks, and workflow events.
- Important workflow events should be synchronized through a backend path, not by exposing private GHL credentials in the browser.

**Basecamp**
- Supabase remains workflow authority; Basecamp is an asynchronous operational mirror only.
- A local privileged Create Book slice now uses the configured Pre-Press project's active membership, commits the canonical Supabase book first, and then provisions one marked human-readable To-do List plus one `KDP Pre-Press — Stage 1` task with reconcile-before-create retry behavior.
- OAuth state, account/project/todoset verification, server-only API access, token refresh boundaries, disconnect state, and sanitized Bookshelf provisioning status are implemented locally. The approved local token-at-rest adapter uses service-role-only Supabase Vault wrappers; live activation requires applying its migration.

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

Tracked source is present for `loadEmployeePage`, `saveEmployeeStep`, and the
Content upload path. The local `saveEmployeeStep` source is a recovered copy of
deployed v14; it preserves unanswered draft values and validates completion on
the server. Any later deployed revision must be captured again before local and
runtime behavior are assumed identical.

The local `submit_kdp_book_for_approval` replacement remains service-role-only
and is invoked only by an employee-authorizing Edge Function. It derives the
submitted snapshot from persisted server state; the browser does not send a
Pricing snapshot or call the RPC directly.

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

The project deliberately uses separate authorization models. Employee intake
uses scoped opaque book tokens. Privileged Bookshelf and Admin Review use a
Google-authenticated Supabase session followed by an active privileged-user
record and server-loaded capabilities. Authentication alone authorizes neither
model.

Current pattern:

```text
raw access token in authorized browser flow
→ SHA-256 hash server-side
→ book_access_tokens lookup
→ role / page / action / book / review-round checks
→ server-authorized operation
```

Known employee token categories:

### Historical employee Bookshelf token — superseded product path

- Older code may still contain an employee-scoped Bookshelf token during the
  staged cutover.
- It is not part of the locked product path: the React Bookshelf is privileged
  only, and employees enter through a secure book-scoped launcher/deep link.

### Book-specific employee token

- tied to a specific book
- used across employee Details / Content / Pricing as allowed by token permissions

### Historical admin review token — legacy compatibility

- role: admin
- tied to a specific `book_id`
- tied to a specific `review_round_id`
- expected to carry allowed admin pages/actions
- retained only for legacy compatibility during the staged cutover; the React
  Admin Review authority is the privileged Google/Supabase capability model

Do not replace employee opaque-token authorization with Supabase Auth, and do
not treat a privileged Supabase session as sufficient without capability and
resource authorization.

---

# Current Functional Progress

## Privileged Bookshelf

Status: **IMPLEMENTED AND LOCALLY VERIFIED / NOT ACTIVATED**

Known behavior:

- Google/Supabase authentication establishes identity, followed by an active
  privileged-user profile and server-loaded capabilities
- authorized cards use canonical Supabase book/workflow data
- privileged users can enter assigned/observable Admin Review or Create Book
  according to capability
- employees do not use this Bookshelf and instead enter a specific book through
  a secure book-scoped launcher/deep link

Live use still requires the pending migrations, Edge Functions, provider/runtime
configuration, privileged bootstrap records, and hosted smoke testing.

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

The recovered `saveEmployeeStep` v14 source verifies the server-side DRM rule,
other Content completion rules, and Pricing unlock transition. React Content now
serializes DRM, cover option, and accessibility using that deployed validation
vocabulary while preserving unanswered draft values.

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
  authoritative book state is employee-editable. Current deployed labels are
  `draft` / `needs_updates`; the locked replacements are `EMPLOYEE_INTAKE` /
  `EMPLOYEE_UPDATES`, and local employee functions accept both during cutover.
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

Status: **IMPLEMENTED / FOCUSED LOCAL REGRESSION VERIFIED**

Known page/workflow exists for pricing, royalty selection, marketplace/list price logic, and persistence. The focused Pricing browser suite passed 43/43 on 2026-09-10; this is local mocked-backend evidence, not hosted end-to-end proof.

Do not call it fully verified until the current repository/runtime is inspected and the complete employee flow is regression-tested.

---

## Locked Workflow Backend Foundation — 2026-09-10

The canonical application-level book states are exactly:

```text
EMPLOYEE_INTAKE
AWAITING_REVIEW
IN_REVIEW
EMPLOYEE_UPDATES
KDP_INTAKE_APPROVED
```

The local, unapplied foundation migration evolves the existing schema rather
than adding a second workflow column. It adds these enum values, privileged
Supabase-auth identities with separately granted capabilities, default/per-book/
per-round reviewer assignment references, explicit round submission snapshots,
finalized-round immutability, comment replies, and idempotent Basecamp book-list
provisioning state on the existing `basecamp_references` table.

Existing `book_status_history`, employee assignment columns, review rounds/items/
comments, section snapshots, `deleted_at`, Basecamp references, and integration
events remain the durable foundation. Soft deletion preserves the logical
workflow record and all dependent history; normal deletion must not hard-delete
the book.

The canonical status release is deliberately staged. Stage A is the additive
foundation migration: it adds the canonical enum labels without rewriting
existing rows, removing legacy labels, or requiring deployed writers to emit
canonical labels. Existing Details, Content, Pricing, and admin review paths
therefore continue accepting legacy labels such as `draft`, `for_approval`,
`in_admin_review`, `needs_updates`, and `approved` during Stage A. Stage B is the
later coordinated writer/data cutover; every legacy writer and reader must be
updated before rows are normalized or legacy labels are made invalid. No
foundation migration has been applied to the hosted database.

The current-file hardening migration is ordered immediately before the Stage A
foundation migration. Applying both requires a short controlled upload pause:
the deployed upload function still inserts a new current row before superseding
the old row, while the migration introduces the one-current-row constraint and
promotion RPC. The safe release sequence is pause Content replacement uploads,
apply the pending migrations, immediately deploy the local RPC-compatible upload
function, verify replacement behavior, then resume uploads.

### Privileged Bookshelf vertical slice — 2026-09-11

The React `?view=bookshelf` and `?view=create-new` routes now have a local
application-side Google/Supabase Auth gate and a server-authorized
`loadPrivilegedBookshelf` read contract. The Edge Function validates the
Supabase user, requires Google as the authentication provider, resolves an
active `privileged_users` row and current non-revoked grants on every request,
and scopes book queries before returning a minimal card projection.
`can_view_all_books` sees all non-deleted books; `can_review` sees current
direct or active-round assignments; `can_create_book` permits the shell but
does not expose unassigned books. Employee opaque tokens cannot authenticate
this path, and privileged cards do not route into employee intake.

This is locally verified, not deployed. Live use requires the workflow
foundation migration, the new Edge Function, Google enabled in Supabase Auth,
an allowlisted callback URL, a browser-safe Supabase publishable key supplied
as runtime configuration, and direct provisioning of privileged identities and
grants. The local Basecamp slice now supplies the authoritative employee source
for Create Book. Privileged soft-delete/recover and Admin Review are implemented
locally but remain part of the unactivated workflow foundation; archive is not wired.

### Basecamp + privileged Create Book slice — 2026-09-12

The local Create New flow now obtains employees exclusively from the configured
Pre-Press project's `GET /projects/{project_id}/people.json` membership and
obtains reviewers from active KDP privileged users with a current `can_review`
grant. Client IDs are selections only; the server revalidates membership,
reviewer eligibility, Google/Supabase identity, and `can_create_book`.

`create_privileged_kdp_book` transactionally creates the legacy-compatible
`draft` book, three employee steps, hashed book-scoped employee token, initial
history, pending Basecamp reference, and integration event. The raw token is
never returned to the privileged browser. Basecamp provisioning begins only
after that transaction commits, so a downstream failure leaves the canonical
book visible with a retryable warning.

Book provisioning uses a deterministic non-secret book marker, stores the
To-do List and Employee Intake task IDs immediately, and reconciles remote
collections before any repeated create POST. Known completed mappings do
nothing; ambiguous failures are reconciled before retry, and a fresh employee
credential is issued only when no existing task can be confirmed. Basecamp
comments/webhooks remain deferred to later lifecycle work.

### Secure submission foundation — 2026-09-12

The local, unapplied secure-submission migration backs dynamic Basecamp OAuth
credentials with Supabase Vault. Only service-role RPC wrappers may create,
decrypt, rotate, or delete a token bundle; browser roles have no table or RPC
access. Refresh-token rotation replaces the stored bundle, and permanent
provider rejection marks the connection `refresh_required`.

Reviewer authority remains in KDP privileged capabilities and assignments. A
server-only mapping records a privileged reviewer ID to a stable Basecamp person
ID only after current Pre-Press project membership is verified; email metadata
never grants authority.

Employee submission sends only the book ID and opaque book-scoped token. The
transactional RPC reauthorizes the token, locks the book, validates persisted
Details/Content/Pricing and required current files, creates one immutable
submitted round and logical snapshot, resolves a valid per-book/default reviewer
or leaves the review unassigned, and moves the book to `AWAITING_REVIEW`.
Existing save/upload endpoints reject that non-editable state. Duplicate/retry
submissions return the existing Round 1 instead of creating another active round.
The local closeout migration adds the eligible Owner fallback through an
upgrade-safe wrapper so databases that already applied the submission foundation
converge without rewriting migration history.

After the canonical transaction commits, Basecamp establishes a distinct `Review — Round 1` task and only then completes the existing employee-side Stage 1 task.
Assignment requires a still-valid reviewer mapping and current project
membership. Missing mapping, outage, or ambiguous response leaves retryable
integration state and never rolls back Supabase workflow authority.

### React workflow completion foundation — 2026-09-14

Status: **IMPLEMENTED AND LOCALLY VERIFIED / NOT ACTIVATED**

The React shell now connects the privileged Bookshelf/Create Book flow, the
opaque-token employee Details → Content → Pricing → Submit flow, and the
Google/Supabase-authorized Admin Review Details → Content → Pricing flow through
the existing lightweight query routes. Employee `step` and privileged
`review_step` transitions update deep links; IDs and query parameters remain
selectors only and never grant access.

Admin decisions and comment operations persist immediately through a
capability-checked Edge Function and service-role-only transactional RPC. The
active assigned reviewer may approve/reopen sections, create or manage comments,
approve eligible pending sections on the current page, and durably reach later
review pages only after prior required pages are decided. Finalized rounds and
their submitted snapshots remain immutable and may be loaded as history.
Employee Updates replies and readiness evidence live in separate continuation
state and are linked forward on resubmission without changing the finalized round.
A round may be temporarily unassigned; normal review mutation authority begins
only after exactly one eligible reviewer is assigned.

Whole-book Request Updates requires no pending review sections and at least one
requested-change section. Approve Book requires every required section approved
and no unresolved actionable issue. Both transitions commit Supabase first;
Approve Book means KDP Intake approved, not published on Amazon. Request Updates
reopens only requested employee sections, while direct save/upload calls reject
changes to approved sections. Ready for re-review is derived from a normalized
value change, a changed current file/version reference, or an employee reply.
Resubmission creates a new immutable snapshot and sequential review round,
inherits the same eligible reviewer, and carries an approval only when its value
and relevant file references remain unchanged.

Basecamp remains downstream. Finalization completes the current Admin Review
task; Request Updates creates a distinct, employee-assigned `Employee Updates —
Round N` task, and resubmission provisions a distinct `Admin Review — Round N+1`
task. Reconciliation markers and unique reference keys prevent task reuse or
duplication. Finalized-outcome failures are exposed as sanitized Bookshelf state
with a separately authorized retry; they never roll back canonical KDP state.

The current post-`299da454` local work preserves two additional verified rules:
Round 1 Admin Review derives from Employee Intake, while Round 2+ derives from
the preceding Employee Updates task and fails closed when that mapping is
missing. Reopen Decision is accepted only for an Approved section; Changes
Requested cannot be reopened, and resolving/deleting its final actionable issue
returns the section to Pending rather than Approved.

This remains Stage A. Legacy status aliases/readers/writers and all legacy GHL
pages are retained until migrations/functions/configuration are activated and a
real employee → reviewer → updates/resubmit → approval smoke test passes.

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
- current-page-only Approve All is implemented; there is no Update All
- React reviewer mutations persist immediately and reload authoritative state
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

Decisions 45–46 supersede the current simple external delete-and-replace model
for genuine later manuscript or cover replacements. The durable target is:

```text
same logical ReviewStudio review
→ native ReviewStudio V2/V3/etc. version
→ exact version reference frozen into the applicable KDP review round
```

KDP round numbers and ReviewStudio version numbers remain independent. This is
a locked target, not a claim that the current upload implementation already
provides native version history.

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

# Historical React + Vite GHL App-Shell POC

Status: **COMPLETED / SUPERSEDED BY THE LOCAL REACT WORKFLOW FOUNDATION**

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

# Historical POC Entry Checklist

Before the original POC implementation, the required checklist was:

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

- The React workflow completion foundation is locally verified but its migrations
  and Edge Functions are not deployed; no hosted end-to-end outcome is claimed.
- Decisions 58/63 are implemented locally: finalized review rounds remain
  immutable, Employee Updates use separate continuation state, and resubmission
  links that context into the next review round. Decision 67's read-only
  boundary and currently preserved snapshot/file identity display are implemented;
  native ReviewStudio version history remains incomplete.
- Team & Permissions, Review Defaults, sanitized Integrations status, deliberate
  employee/reviewer assignment and reassignment, reviewer-ineligibility intervention,
  and transactional last-Owner preservation controls have meaningful local
  implementation but are not activated. The local closeout enforces the Tech Admin
  capability-delegation subset, rejects unauthorized and same-target reviewer
  overrides without mutation, preserves legal Employee Updates actions after employee
  reassignment, fails closed when Basecamp event settlement cannot be persisted, and
  supplies the upgrade-safe Owner fallback. The activation-blocker closeout adds a
  single-use, service-role-only initial Owner bootstrap for an explicit existing Google
  identity. Privileged Trash/Recover now derives recoverable employee access from a
  stable integration-event identity, stores only its hash, and delivers or retries the
  same credential through the mapped Basecamp task without returning it to the
  privileged browser. A per-book server claim and settlement CAS serializes launcher
  delivery so stale in-flight work cannot supersede current employee access. These
  controls and explicit reasoned Employee Updates section
  reopen are implemented locally but not activated.
  Reviewer and employee optimistic concurrency,
  including observed current-file identity, is implemented locally but not activated.
- ReviewStudio native version history/round mapping, author identity sync,
  post-approval correction, KDP Upload Assistant/handoff, complete AI disclosure,
  and fidelity that depends on unavailable historical source data remain incomplete.
- Decision 38 is implemented locally: review navigation records reached-page state
  without starting review; the first successful meaningful reviewer mutation alone
  transitions to `IN_REVIEW` and records immutable start attribution.
- The new SQL migration has static/harness coverage but still requires an
  execution dry-run against a schema-compatible PostgreSQL/Supabase environment.
- DRM legacy submissions may be blank because old employee validation did not require a choice.
- Final security bypass/release testing has not yet been completed.
- Token values can appear in browser URLs; they must never be copied into logs/reports and any exposed development token must be rotated/reissued before release.
- Current GHL frontend is maintainable but increasingly fragile due to selector/hydration coupling.
- Basecamp integration is implemented locally; live OAuth/Vault/project/person
  configuration and a real lifecycle smoke test remain activation prerequisites.
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
