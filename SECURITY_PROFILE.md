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

## Employee Bookshelf Token

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

Current known editable statuses include `draft` and `needs_updates`; verify exact source before changing this rule.

## Admin Review Token

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

## Admin Review Writes

Every admin decision save must re-check:

- admin token scope
- book/review-round ownership
- active review state
- page/step permission
- expected reviewable item set
- no unknown or duplicate section keys
- no pending/inconsistent decisions when page save requires all items decided
- comment limits / input constraints

The existing transactional review-save design should remain authoritative where already implemented.

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

---

# Logging Rules

Logs may include safe identifiers needed for debugging, but must not include:

- raw access tokens
- service-role key
- GHL private token
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
