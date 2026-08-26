# KDP Intake / Admin Review — Protected API and Authorization

## Scope

Applies when the browser or another external caller invokes protected Supabase Edge Functions or other privileged application endpoints.

This module does not authorize replacing the existing KDP token architecture.

## Existing KDP Authorization Direction

The current verified project design uses scoped opaque access tokens:

```text
raw scoped token in client request
→ server SHA-256 hash
→ lookup by token_hash
→ validate role/resource/page/action/state
→ perform authorized operation
```

Do not migrate this to Supabase Auth/JWT, a new API server, or another scheme without explicit architectural approval.

## Required Server Checks

Protected operations must validate all relevant dimensions independently:

- token exists and matches
- token not revoked
- token not expired
- role is allowed
- requested resource belongs to token scope
- requested page/step is allowed
- requested action is allowed
- current book/review state permits the action
- identifiers and payload values are valid

CORS is not authorization.

## Employee Operations

For employee writes, server logic should determine whether the caller may:

- save draft
- complete a step
- upload/replace files
- resubmit after requested changes

Completion validation must be server-side. Drafts may be incomplete only when the workflow explicitly permits it.

## Admin Operations

For admin review operations, server logic must validate at minimum:

- admin role/token kind
- book scope
- review-round scope
- active/latest review round
- requested admin page/action
- current review/book status
- expected review-item set
- no unknown/duplicate/inconsistent item decisions where the operation forbids them

Finalization must re-evaluate authoritative state server-side.

## Duplicate / Replay Protection

Operations that can create or finalize workflow state must be safe against:

- double-clicks
- browser retries
- repeated network requests
- stale review rounds
- concurrent requests where relevant

Use constraints, idempotency checks, transactions/RPCs, or equivalent deterministic guards appropriate to the operation.

## API Response Rules

Return only data needed by the client.

Do not return:

- token hashes
- service-role credentials
- provider secrets
- private configuration unrelated to the requested operation

Use safe error messages. Log deeper diagnostics server-side without secret values.

## POC-Specific Rules

For the React/Vite GHL proof:

- the first protected call should reuse an existing Edge Function
- use a disposable test book / scoped test authorization context
- do not perform privileged writes automatically on mount
- any write must be explicit and harmless/test-only
- do not add a new authentication system for the POC

## Required Verification

For every protected operation added to the POC or later app, verify at least:

- valid scoped request succeeds
- missing token is denied
- invalid token is denied
- wrong book scope is denied where applicable
- wrong role/action/page is denied where applicable
- stale/invalid workflow state is denied where applicable

Do not expose raw token values while testing.

