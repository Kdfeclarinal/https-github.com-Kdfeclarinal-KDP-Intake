# KDP Intake / Admin Review — Security Profile

## Purpose

This file is the project-specific security profile for the KDP Intake / Admin Review system.

Security is part of architecture, implementation, debugging, and release review. It is not a final polish step.

This profile is based on the project's security entry-point rules and the currently verified KDP architecture. Claude Code must reconcile it against the repository's actual:

```text
security/SECURITY_ROUTER.md
security/SECURITY_CORE.md
security/SECURITY_PROJECT_PROFILE_TEMPLATE.md
security/checklists/SECURITY_RELEASE_CHECKLIST.md
```

and only the additional security modules that actually apply.

If those repository files use different canonical module names, preserve their names and update this profile accordingly rather than inventing a parallel security system.

---

## Security Status

Current state: **DEVELOPMENT / NOT PRODUCTION-APPROVED**

Reasons include:

- final admin workflow is not complete
- Admin Pricing/finalization are not fully verified
- final frontend/server bypass testing has not been completed
- release checklist evidence has not been produced
- architecture is being evaluated through a staging-only React/Vite GHL POC

Do not describe the project as production-ready until the applicable release checklist is complete with evidence.

---

## Security Source-of-Truth Order

When security guidance conflicts, use:

1. Latest explicit project requirement
2. Verified runtime behavior and actual source code
3. Current official platform/vendor security documentation
4. This `SECURITY_PROFILE.md`
5. Applicable repository security modules
6. General assumptions

For current advisories, platform policies, authentication behavior, security headers, SDK changes, or other time-sensitive vendor behavior, verify current official documentation. If live research is unavailable, use the project's research handoff process instead of guessing.

Product/workflow security requirements through Decision 67 are locked in
[`docs/KDP_LOCKED_DECISIONS_1_67.md`](docs/KDP_LOCKED_DECISIONS_1_67.md).
Its supersession and clarification rules govern older project notes; this file
must not claim an unimplemented control is active.

---

# Active Security Capability Routing

The exact repository module names must be verified from `security/SECURITY_ROUTER.md`.

Based on the current architecture, the following capability areas are expected to be active:

| Capability | Status | Why |
|---|---|---|
| Security Core | ACTIVE | Required for every project |
| API / server endpoints | ACTIVE | Supabase Edge Functions expose application operations |
| Authentication / authorization | ACTIVE | Employee/admin scoped access tokens and role/action/page checks |
| Frontend trust boundary | ACTIVE | GHL/React/browser code is untrusted client code |
| Database | ACTIVE | PostgreSQL/Supabase is the workflow source of truth |
| Supabase | ACTIVE | Edge Functions, database, Storage, service-role usage |
| Storage / uploads | ACTIVE | Manuscript/cover file handling and preview links |
| Secrets | ACTIVE | Supabase service role, GHL private token, ReviewStudio credentials, webhook secrets |
| Webhooks / external integrations | ACTIVE | ReviewStudio webhooks and planned/possible GHL backend event sync |
| Dependencies / supply chain | ACTIVE | React/Vite/npm and existing server dependencies |
| SSRF / arbitrary URL fetching | CONDITIONAL | Activate only if the server fetches user-controlled arbitrary URLs |
| AI tool security | N/A for KDP portal | No AI model is currently part of the portal's security authority |
| Browser extension security | N/A | KDP portal is not a browser extension |
| Paid API / spend controls | CONDITIONAL | Activate if a paid external API is introduced |

Do not load every security module into every task. Activate only what the capability requires.

---

# Security Principles

The following are mandatory:

- Treat external input as untrusted.
- Authentication is not authorization.
- Knowing `book_id`, `review_round_id`, section keys, file IDs, or page URLs does not prove access.
- The frontend is never the authority for security-sensitive decisions.
- Use least privilege.
- Prefer fail-closed behavior.
- Secrets do not belong in browser code, logs, source control, screenshots, or task/model prompts.
- Avoid uncontrolled retries, loops, concurrency, and expensive-call abuse.
- Security-sensitive rules must be deterministic server/application logic, not merely UI state or AI instructions.
- Test allowed and denied behavior before release.

---

# Trust Boundaries

## Untrusted / Client-Side

Treat these as attacker-controlled or manipulable:

```text
GHL page DOM
React app state
query parameters
book_id
review_round_id
section keys
button disabled/enabled state
radio/checkbox state
hidden fields
localStorage/sessionStorage
client validation
client role flags
browser console
network requests initiated by the browser
uploaded file metadata supplied by the client
```

A user can modify any browser-side value with DevTools.

## Trusted Only After Server Verification

Security authority belongs to deterministic backend/database logic, including:

```text
Supabase Edge Functions
authorized database RPCs
Postgres constraints / transactional checks
server-side token hashing/validation
server-side workflow state checks
server-side finalization rules
server-issued signed file URLs
server-side GHL API/webhook calls
server-side ReviewStudio API calls
```

Service-role access is privileged but is not itself proof that a request is authorized. Every service-role Edge Function must validate the caller's scoped authority before using privileged database/API access.

---

# Current Access-Token Model

The current system uses scoped opaque access tokens.

Do not replace this with Supabase Auth/JWTs merely because a new React frontend is introduced.

Current model:

```text
browser receives an opaque scoped access token
→ browser submits token to protected Edge Function
→ Edge Function hashes token using SHA-256
→ lookup by token_hash in book_access_tokens
→ validate scope/role/state
→ perform only the authorized operation
```

Raw access tokens must not be stored in the database when a hash is sufficient for lookup/verification.

## Historical Employee Bookshelf Token — Superseded Product Path

Older staged-cutover code may retain this token category, but it does not grant
access to the locked React Bookshelf. The Bookshelf is privileged-user only;
employees enter a specific assigned book through a book-scoped launcher/deep
link.

Expected security properties:

- role = employee
- appropriate Bookshelf/open-book actions only
- may be broader than one book only when explicitly allowed by server-side token metadata/scope
- opening a book should issue/use a book-specific employee authorization context rather than trusting a browser-provided book ID alone

## Book-Specific Employee Token

Expected checks before protected employee operations:

- token exists and hash matches
- role = employee
- token not revoked
- token not expired
- token belongs to the requested book
- requested page is allowed
- requested action is allowed
- book state is employee-editable for write operations

Employee writes are allowed only in employee-editable workflow states:
`EMPLOYEE_INTAKE` / `EMPLOYEE_UPDATES` canonically and `draft` /
`needs_updates` as their deployed aliases. Stage A only adds the canonical enum
labels; it does not rewrite current rows, remove the deployed aliases, or require
current writers to emit canonical values. Both pairs remain recognized during
Stage A, and no review or approved state is employee-editable. Stage B is the
later coordinated writer/data cutover; only that release may normalize rows or
consider invalidating legacy labels.

Google/Supabase authentication on the local privileged Bookshelf slice
establishes identity only. Each privileged request independently validates the
Supabase session, requires the Google provider, resolves an active
`privileged_users` row by immutable Auth user ID, and reloads active capability
grants. Authorization is a separate non-revoked grant stored by privileged-user
ID. Email addresses, provider identity, Basecamp membership, request payloads,
and frontend role flags are never capability proof. Privileged tables remain
RLS protected and unavailable for direct browser reads or writes; the
service-role key is confined to the authorizing Edge Function.

## Historical Admin Review Token — Legacy Compatibility

These checks remain relevant only to retained legacy token paths during the
staged cutover. React Admin Review authenticates with Google/Supabase and then
authorizes the active privileged-user capability, book, round, assignment, and
state on the server.

Required checks before protected admin operations:

- token exists and hash matches
- role = admin
- token not revoked
- token not expired
- token belongs to `book_id`
- token belongs to `review_round_id`
- token kind/scope is admin review
- requested page is allowed
- requested action is allowed
- admin identity required by the workflow is present
- book is still on the latest active review round
- book/review-round status still permits active review

Knowing a valid `book_id` or `review_round_id` without the correctly scoped token must never grant access.

---

# Authorization Rules

## Employee Writes

Server must determine whether an employee can:

- save a draft
- complete a step
- upload/replace a file
- resubmit after requested changes

The browser must not decide completion or unlock state authoritatively.

Required-field rules must be enforced server-side on completion.

Draft saves may be more permissive only when the workflow explicitly allows incomplete drafts.

## Employee Writes — Historical Content File Replacement Boundary

**Added 2026-09-05 with the true-replacement flow.**

This section records the currently implemented delete-and-replace behavior; it
is not the durable product target for genuine later replacements. Decisions
45–46 supersede simple ReviewStudio replacement/overwrite language. The locked
target keeps the same logical ReviewStudio review, creates a native V2/V3/etc.
version, and freezes the exact ReviewStudio version reference into each
applicable KDP review round. That target is not implemented and requires a
staging contract test before reliance on ReviewStudio version behavior.

The Content employee upload path now performs a TRUE file replacement
(POST new file → transactionally promote the staged row and mark the old
`book_files.is_latest=false` → DELETE the old
ReviewStudio review file). This is a privileged write boundary because the
`uploadContentFileToReviewStudio` Edge Function now performs a server-side
`DELETE` against `https://iwdnow.reviewstudio.com` (account
`iwdnow.reviewstudio.com`, ReviewStudio API v2.1).

Hard rules — enforced by the Edge Function, NOT the browser:

1. The browser MUST NOT send `reviewstudio_review_id`,
   `reviewstudio_file_id`, or any other ReviewStudio identifier in the
   replacement request body or query string. The server resolves them
   from the trusted `book_files` row (`is_latest = true`).
2. The browser MUST NOT receive `X-REVIEWSTUDIO-EMAIL` or
   `X-REVIEWSTUDIO-TOKEN`. They are loaded server-side from a secrets
   store (currently Supabase Edge Function secrets) and used only inside
   the Edge Function runtime. Upload responses do not expose ReviewStudio
   or database identifiers. The protected loader exposes only the public
   ReviewStudio file URL needed by the UI. No ReviewStudio credentials
   appear in any response field.
3. The replacement request must include the same scoped `access_token`
   and `book_id` already validated for the initial upload path. Token
   scope is re-checked server-side.
4. The replacement is rejected (HTTP 409) if there is no current
   `book_files` row with `is_latest = true` for the
   requested `(book_id, file_type, section_key)`. This is the
   orchestration's "no current row → fall back to first-upload path"
   branch.
5. The safe replacement order is: resolve current row → POST new
   ReviewStudio file → persist the new `book_files` row staged with
   `is_latest=false` → atomically promote the new row and supersede the old
   row through `promote_replacement_book_file` → DELETE old ReviewStudio file. The
   DELETE is the LAST step. If the new `book_files` insert fails, the
   orphan new RS file is deleted and the replacement is rolled back.
   If the RS DELETE fails (5xx / network error), the new `book_files`
   row is already authoritative; the failure is reported as
   `cleanup_pending` and a reconciliation job (out of scope for this
   task) is responsible for the hard delete of the old `book_files`
   row.
6. The Edge Function does NOT call `DELETE /reviews/{review_id}/files`
   with `delete_all_versions=true`. Each old file is deleted
   independently. There is no automatic retry of the DELETE; the
   `cleanup_pending` flag is the contract.
7. The Edge Function does NOT call `response.json()` after a 204. The
   ReviewStudio DELETE contract is HTTP 204 with no body.

The loader (`loadEmployeePage`) reads `book_files` with
`is_latest = true`, so the most-recent successful
upload is the only one the employee sees — superseded rows are
invisible to the UI but remain in the table for the reconciliation
job's hard-delete pass.

Deployment of the one-current-row database invariant is coupled to the
RPC-compatible upload function. The currently deployed legacy upload sequence
must not receive replacement traffic after the unique-current-file index is
created. Pause Content replacement uploads, apply the migration, immediately
deploy the function that stages the new row with `is_latest=false` and invokes
`promote_replacement_book_file`, verify the path, and only then resume uploads.

## Employee Reads and Reconciliation Writes

`loadEmployeePage` fails closed unless the opaque token is unrevoked,
unexpired, has exactly `role=employee`, is directly bound to the requested
`book_id`, and carries the exact `load_employee_page` action. Bookshelf-wide
actions and metadata-only book lists do not authorize this book-specific read.
Unknown steps are rejected, and Content/Pricing reads additionally require the
authoritative step row, progress state, or current employee step to show that
the requested step is unlocked/current. Details remains the initial readable
step for an otherwise valid book-specific token.

ReviewStudio reconciliation during that read is a separate privileged write.
It runs only when the same token also carries
`upload_content_file_to_reviewstudio` and the authoritative book state is
employee-editable (`draft` / `needs_updates` during cutover;
`EMPLOYEE_INTAKE` / `EMPLOYEE_UPDATES` canonically). A read-authorized but non-write-authorized request
may load the page but cannot mutate `book_files`.

The browser treats the loader's reconciled current file set as authoritative.
Legacy saved `uploaded` booleans cannot satisfy Content file requirements after
the corresponding current row is removed by reconciliation.

Server upload validation enforces the existing product limits (1.5 GB
manuscript, 50 MB cover) and the backend's current extension/MIME pairs. The
browser's `File` metadata remains untrusted; this is intentionally lightweight
validation rather than content-signature inspection.

Draft serializers preserve unanswered AI-content, publishing-rights, and adult
content choices as empty values. Recovered `saveEmployeeStep` v14 performs
server-side completion validation; browser-supplied progress/completion remains
non-authoritative.

## Admin Review Writes

The local workflow-completion implementation re-checks on every mutation:

- current Google/Supabase identity and active privileged-user record
- current non-revoked `can_review` capability
- book/review-round ownership
- active review state
- assigned-reviewer ownership for mutable review work
- page prerequisites or a previously reached page
- item/thread membership in the exact book and round
- comment limits / input constraints

A review round may temporarily have no reviewer while awaiting assignment. No
normal review mutation is authorized in that condition. Once assigned, exactly
that one eligible reviewer owns normal mutations. Owner or a properly capable
Tech Admin must use a deliberate, audited assignment/reassignment or takeover
path; privileged observation alone never grants mutation authority.

Reviewer success is reflected only after the RPC succeeds and the sanitized
authoritative round is reloaded. Round-local actionable issue numbers are
allocated under a transaction advisory lock. Query parameters, item IDs,
Basecamp person IDs, and browser state provide no authority.

## Finalization

Final approval / request-updates logic must be server-authoritative.

Required rule:

```text
All reviewable items across Details + Content + Pricing are decided.

All approved
→ Approve Book

At least one needs_updates
→ Request Updates

Any pending / inconsistent / missing item
→ reject finalization
```

Frontend button visibility is only UX, never authorization.

The finalization RPC independently requires `can_finalize_book`, locks the book
and active round, revalidates every required decision, records status/audit
history, and finalizes once. An assigned reviewer may finalize only with that
capability; an owner-level override additionally requires the existing
reassignment/manage authority.

The locked Decisions 58/63/67 boundary has no finalized-round mutation
exception: the submitted snapshot is immutable from Submit, and the round,
items, comments, and replies become permanently immutable when Request Updates
or Approve Book commits. Employee Updates replies, readiness evidence, changed
values, and changed file/version references live in separate linked continuation
state and are consumed transactionally into the next snapshot and round.

Employee update writes must repeat book-scoped opaque-token authorization and
permit only reviewer-requested section keys or exact requested file sections.
Ready for re-review is derived from normalized persisted values, authoritative
current file/version references, or a continuation reply; the browser cannot
assert it. Resubmission must lock the book, consume the continuation state, and
create one new active round/snapshot without changing the finalized source
round.

Basecamp outcome synchronization happens after canonical commit. Failures update
sanitized retry state and may be retried only by a current privileged identity
with finalization or reviewer-assignment authority. A missing employee Basecamp
mapping fails safely and never creates an unassigned Employee Updates task.

---

# Supabase / Database Security

## RLS

Use default-deny / least-privilege RLS for tables exposed through public Supabase client credentials where applicable.

Because privileged Edge Functions use the service-role key, RLS may be bypassed by those server calls. Therefore:

- service-role Edge Functions must perform explicit authorization
- service-role keys must never enter browser code
- direct browser privileged table writes are prohibited

Do not weaken RLS merely to make frontend development easier.

## Direct Browser-to-Supabase Operations

Default project position:

- privileged database writes: **Edge Function only**
- privileged reads: **Edge Function only unless an explicitly reviewed RLS-safe public path is approved**
- file byte upload may use a short-lived signed upload URL if the server first authorizes the upload and the final metadata/state transition remains server-controlled

If a future React app uses the Supabase public client SDK, that does not change the trust model.

## Database Constraints / Transactions

Use database constraints and transactional RPCs for invariant-critical behavior where appropriate.

Critical multi-record transitions should not depend on a sequence of unrelated client writes.

Duplicate/parallel requests must not create duplicate review rounds, duplicate finalization, or inconsistent status transitions.

---

# Edge Function Security

Every privileged Edge Function must:

1. validate request method / body shape
2. enforce reasonable body/input limits where appropriate
3. validate/normalize untrusted identifiers and input
4. authenticate the scoped access token when required
5. authorize role, book, review round, page, and action
6. validate current workflow state
7. perform the smallest permitted operation
8. fail closed on ambiguous/invalid authorization
9. avoid returning secrets/internal credentials
10. log only safe diagnostic metadata

CORS is not authorization. A permissive CORS policy does not make an endpoint secure if the endpoint's own authorization is correct, and a restrictive CORS policy must not be treated as a substitute for authorization.

---

# Secret Inventory / Handling

The following are server-only secrets:

| Secret / credential | Allowed location |
|---|---|
| Supabase service-role / secret key | Edge Function/server environment only |
| GHL private integration token | Edge Function/server environment only |
| GHL OAuth client secret, if introduced | server environment only |
| Basecamp OAuth client secret | Edge Function/server environment only |
| Basecamp OAuth access/refresh tokens | approved managed token vault only |
| ReviewStudio API key/token | Edge Function/server environment only |
| ReviewStudio webhook secret/signing key | server environment only |
| database credentials | server/managed environment only |
| signing/encryption secrets | server/managed secret store only |

Never expose them in:

- GHL Code elements
- React/Vite source or bundles
- HTML/CSS/JS
- source maps
- git history
- task prompts
- browser console
- logs copied into tickets/chat
- screenshots
- localStorage/sessionStorage

Public Supabase project URLs or public/publishable keys are not service-role secrets, but they still do not grant authorization by themselves and must be paired with correct RLS/server rules.

---

# Browser / Frontend Security

The browser is an untrusted client.

Required behavior:

- no privileged credentials in bundle
- no authorization decisions based only on hidden/disabled UI
- no raw secret logging
- no trusting user-modified `book_id` / `review_round_id`
- no assuming the React app is more trustworthy than the existing GHL JavaScript
- sanitize/escape untrusted content rendered into the DOM
- avoid unsafe HTML injection unless content is explicitly sanitized and the need is justified

The planned React/Vite migration does not improve security automatically. It only changes frontend maintainability. Server authority must remain unchanged or stronger.

---

# File / Storage Security

Manuscripts and covers are sensitive publishing assets.

Required controls:

- authorize file operations server-side
- validate permitted file type/metadata on the server where feasible
- avoid relying only on browser file extensions/MIME values
- do not expose storage credentials
- prefer short-lived signed URLs for private preview/download access
- restrict signed URL lifetime to the minimum practical window
- keep ReviewStudio API credentials server-side
- admins should not gain upload/replace capability unless the workflow explicitly authorizes it
- file references in GHL should be limited to safe convenience links/IDs when needed, not private credentials

If temporary storage paths or signed URLs are returned to the browser, treat them as sensitive capabilities and avoid logging them unnecessarily.

---

# ReviewStudio Security

ReviewStudio API calls requiring credentials must originate from a secure backend/Edge Function.

Browser may receive only the safe review/preview URL/reference needed for the authorized workflow.

Webhook verification must use the configured server-side secret/signature scheme.

Do not trust webhook payloads solely because they reach the public endpoint.

Webhook handlers should verify authenticity before privileged state changes and should be idempotent against retries/duplicates where applicable.

---

# GHL Integration Security

Preferred synchronization path:

```text
browser app
→ protected Supabase Edge Function
→ GHL inbound webhook or GHL API
```

The browser must never receive the GHL private integration token or private webhook secret.

Send important workflow events, not every keystroke/autosave.

Examples of appropriate event classes:

```text
intake_started
step_completed
intake_submitted
reviewstudio_ready
changes_requested
approved
resubmitted
```

Before implementing event delivery, inspect the repository for an existing backend GHL sender. Reuse a proven backend integration instead of inventing a new one for the POC.

---

# Duplicate / Replay / Concurrency Protection

Security-sensitive or status-sensitive endpoints must tolerate duplicate browser clicks, retries, or network replays without corrupting workflow state.

Use appropriate combinations of:

- unique constraints
- current-state checks
- row locks / transactions
- idempotency keys where justified
- review-round identity checks
- latest-version checks

Do not add complex idempotency infrastructure to trivial draft saves unless repository evidence shows it is needed.

Locked reviewer and employee writes require optimistic concurrency. Reviewer
mutations must validate an expected active-round revision and increment it on
success; employee saves must reject a stale expected version instead of silently
overwriting newer canonical state. The current local workflow implements these
contracts through an active-round revision and one coherent book-level employee
revision. Current-file promotion additionally compares the file identity the
employee actually observed. These controls remain unactivated until the pending
migration and corresponding Edge Functions are deployed together and smoke-tested.

Finalized review rounds, their review items, and their comments/replies are
immutable history. Reviewer assignment is stored by privileged-user ID on the
book and round; claim/reassignment requires the corresponding server-verified
capability and must append an audit event. The database permits at most one
submitted/in-review round per book.

Basecamp remains an asynchronous operational mirror. Book-level To-do List
provisioning uses a unique idempotency key and explicit pending/provisioned/
failed state; `provisioned` requires a real returned external ID. Basecamp state
must never authorize or drive a KDP workflow transition.

Basecamp OAuth is an integration connection, never a KDP login. Initiation
requires a current Google/Supabase privileged identity with
`can_manage_integrations`; the callback relies on a hashed, short-lived,
single-use server state because the intentional in-memory privileged session
does not survive a full-page redirect. Account and Pre-Press project IDs come
from server configuration, the project must be accessible, and its enabled
To-dos tool/todoset is discovered from the project dock.

Dynamic Basecamp access and refresh tokens are not stored in
`basecamp_connections` or another general-purpose table. The local integration
uses server-only `read_basecamp_token_bundle`, `store_basecamp_token_bundle`,
and `delete_basecamp_token_bundle` wrappers backed by Supabase Vault. The client
secret and token material never enter React, GHL configuration, browser storage,
API responses, application logs, or generated bundles.

Create Book requires current `can_create_book`, a currently returned member of
the configured Pre-Press project, and a current eligible KDP reviewer. Supabase
commits the canonical book/token/steps/history and pending mapping
transactionally before any Basecamp create request. Basecamp create POSTs are
not automatically retried. Retry first reconciles the deterministic non-secret
book marker and stored IDs; it reissues a book-scoped employee credential only
when no Employee Intake task can be confirmed. Basecamp membership grants no
KDP reviewer/admin authority, and Basecamp task state cannot transition KDP.

---

# Audit / Status History

Important workflow transitions should be auditable.

Current known audit concepts include:

```text
book_status_history
submitted_by
reviewed_by
saved_at
reviewed_at
completed_at
source metadata
```

Audit entries should record sufficient actor/action/time/source context without storing secrets or raw access tokens.

Do not silently rewrite history to hide failed/previous transitions.

The local `submit_kdp_book_for_approval` RPC is executable only by
`service_role`, but service-role restriction alone is not employee
authorization. The employee Edge Function validates the book-scoped token, and
the transaction independently repeats that authorization by token hash before
creating or returning the submitted round.

---

# Logging Rules

Logs may include safe identifiers needed for debugging, but must not include:

- raw access tokens
- service-role key
- GHL private token
- Basecamp client secret, access token, or refresh token
- ReviewStudio API key
- webhook secrets
- private credentials
- unnecessarily exposed signed URLs

Do not print a full browser URL when it contains an access token.

When reporting browser tests, prefer booleans such as:

```text
hasAccessToken: true
hasCoverPreviewUrl: true
```

rather than the secret/capability value itself.

---

# React + Vite GHL POC Security Profile

The staging POC is an architecture experiment, not a production migration.

Required constraints:

- isolated GHL staging page only
- disposable test book only
- no production-page edits
- no production schema migration
- no auth-model rewrite
- no service-role/GHL/ReviewStudio secrets in browser bundle
- one protected read through an existing Edge Function
- one harmless explicit test-only write through an existing Edge Function
- no automatic write on mount
- backend GHL test event only if a suitable existing backend sender is already available
- test both GHL preview and published staging page
- desktop/mobile verification
- idempotent mount across `DOMContentLoaded` and `hydrationDone`

The POC frontend must be treated as untrusted even when running on a private/staging GHL page.

---

# Required Security Tests Before POC PASS

At minimum verify:

1. Bundle/source inspection shows no server-only secrets.
2. App can call only the existing protected endpoint using the intended scoped access context.
3. A missing/invalid token is rejected by the backend.
4. Manipulating `book_id` does not grant another book's data/write access.
5. Repeated frontend mount attempts do not create duplicate writes.
6. Test write is explicit/user-triggered and limited to the disposable staging book.
7. No production resource is mutated.

The full production security checklist is broader and must be run later.

---

# Required Security Tests Before Production Release

Before calling the KDP system production-ready, run the repository security release checklist for all active modules and include evidence for both allowed and denied paths.

Focused bypass tests should include, where applicable:

- invalid token
- expired token
- revoked token
- wrong role
- wrong book ID
- wrong review round ID
- page/action scope violation
- manipulated frontend role/state
- pending/incomplete review save attempt
- unknown/duplicate/missing review section keys
- finalization with pending items
- finalization against stale/non-latest review round
- duplicate submission/finalization attempt
- direct browser attempt to call privileged database paths
- file access outside authorized book/review context

Server controls must continue to reject unauthorized actions even if the browser UI is bypassed through DevTools/console.

---

# Known Current Security Follow-Ups

- Final production security release checklist has not yet been completed.
- Frontend-console bypass testing is intentionally deferred until functional implementation is complete, but it is mandatory before production readiness.
- Development logs/chat have previously demonstrated how raw tokenized URLs can be copied accidentally. Never repeat raw token values in reports; rotate/reissue any development token that is believed to have been exposed before release.
- DRM validation was previously incomplete on Employee Content; required-field enforcement must be server-side before future complete submissions are considered safe/valid.
- React/Vite POC introduces a new frontend build/dependency surface; dependency/security routing must be re-evaluated before implementation.

---

# Architecture-Change Trigger

Re-run the security router and update this profile before introducing any new capability such as:

- Supabase Auth or another authentication system
- a standalone subdomain app with new hosting/auth assumptions
- direct browser Supabase writes
- arbitrary user-controlled URL fetching
- new file-storage provider
- new webhook consumer/sender
- GHL private API integration
- Basecamp API integration
- paid APIs
- AI agents/actions inside the KDP workflow
- browser extensions
- new third-party frontend component/runtime libraries with meaningful security impact

Do not let an architecture experiment silently become production architecture without this review.

# Repository Security Pack Alignment

The repository contains the security modules listed by `security/SECURITY_ROUTER.md`.

This update does not change the existing KDP authentication or authorization architecture. The scoped opaque-token model, protected Supabase Edge Functions, server-authoritative workflow state, and existing frontend trust boundary remain authoritative.

## Additional Active Security Areas

The previously listed `SECURITY_DATABASE.md`,
`SECURITY_PLATFORM_SPECIALIZED.md`, and `SECURITY_DEPLOYMENT.md` paths do not
exist in this repository or elsewhere under the current project workspace.
They are not treated as active policy sources.

- `SECURITY_DEPENDENCIES.md`
  - dependency identity, lockfile integrity, advisory review, build artifacts, unnecessary dependencies, and tool/plugin permissions.

## Additional Implementation Requirements

Basecamp OAuth credentials are held only in Supabase Vault through service-role
`SECURITY DEFINER` wrappers. The stored credential reference is not itself a
credential, and anon/authenticated roles have no access to the wrappers or the
reviewer/Basecamp mapping table. Employee submission is authorized at the Edge
boundary and again transactionally by token hash in the database, using
persisted server state instead of a browser-supplied Pricing snapshot. Basecamp
lifecycle failure is operational only and cannot undo or authorize the canonical
KDP transition.

Privileged operational administration is locally implemented through the existing
Google/Supabase allowlist and capability-grant model. Service-role-only transactional
RPCs enforce Owner creation/demotion boundaries, retain at least one active Owner with
user-management authority, reject stale revisions, invalidate ineligible reviewer
ownership without changing workflow state, and audit administrative mutations.
Employee reassignment revokes prior opaque access and commits canonical continuity
before a retryable Basecamp update. Replacement access preserves only the actions legal
for the current workflow state. Integration responses expose configuration status,
never credential material, and Basecamp success is not reported unless the durable
event state is persisted. Tech Admin delegation is limited server-side to an explicit
non-Owner subset, self-administration is denied, same-target reviewer overrides require
authority and fail without mutation, and the eligible Owner submission fallback is
delivered by a forward migration. Review navigation cannot start review; the first
meaningful reviewer mutation atomically records the original start attribution. This
slice is locally verified but is not hosted or production-activated. Initial activation
uses a single-use, service-role-only bootstrap transaction for one explicit existing
Google identity, only while no valid active Owner exists; it grants the current
capability registry and records an audit event without hard-coded identity data.
Employee-access recovery derives the opaque credential from a stable server-generated
integration-event ID, persists only its hash and prefix, and reuses that identity for
retryable delivery to the existing mapped Basecamp task. The privileged response never
contains the credential, and access is not reported as reestablished until downstream
delivery and durable event settlement both succeed. Per-book claim/settlement CAS and
a one-in-flight database invariant prevent stale recovery or reassignment workers from
overwriting the current employee launcher. During a controlled derivation-secret
rotation, the optional previous server-only secret may be retained temporarily so an
already-persisted access identity remains reconstructable until its delivery settles.

For security-sensitive API requests:

- validate request method, shape, IDs, sizes, and allowed values server-side
- reject unexpected privileged fields where practical
- authorization must be checked independently of browser state
- downstream failures must not create a fail-open authorization or workflow state
- state-changing requests must tolerate accidental duplicate execution appropriately

For browser/frontend builds:

- review final browser bundles and source maps for secrets/debug exposure
- do not treat CORS, hidden URLs, disabled controls, or GHL page access as authorization
- keep raw access tokens out of logs, screenshots, saved debug artifacts, localStorage, and sessionStorage

For production-critical durable data:

- define database/storage backup scope and retention
- protect backups as production data
- verify that backups are actually created
- perform a safe restore test before production approval

## Required Production Security Review

Before production approval:

1. Run the current `SECURITY_RELEASE_CHECKLIST`.
2. Run applicable report-only audits for:
   - exposed secrets
   - authentication / authorization / IDOR
   - database / RLS / storage access
   - untrusted input to dangerous sinks
   - money / resource / abuse paths where applicable
3. Classify findings before implementing fixes.
4. Re-run relevant negative/adversarial tests after fixes.
5. Do not call the system production-ready until applicable P0/P1 findings are resolved or explicitly accepted by the authorized owner.

The existing functional-first development sequence remains valid. These requirements should be applied incrementally as relevant capabilities are implemented and then verified comprehensively before production.
