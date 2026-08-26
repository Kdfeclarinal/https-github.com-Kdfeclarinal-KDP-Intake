# KDP Intake / Admin Review — Security Core

## Universal Rules

These rules apply to every project task.

- Treat all external input as untrusted.
- Authentication is not authorization.
- Knowing `book_id`, `review_round_id`, section keys, file IDs, or URLs does not prove permission.
- The frontend is never the authority for security-sensitive or workflow-sensitive decisions.
- Use least privilege.
- Prefer fail-closed behavior for authorization and state transitions.
- Keep secrets out of client code, source control, logs, screenshots, and model/task prompts.
- Security-sensitive rules belong in deterministic server/database logic, not only in UI state.
- Avoid uncontrolled retries, loops, concurrency, duplicate writes, and expensive-call abuse.
- Preserve existing working security boundaries unless the task explicitly authorizes a redesign.

## Server Authority

The server must independently enforce rules for operations such as:

- employee draft/completion eligibility
- employee book ownership/scope
- admin book/review-round scope
- approve / needs-update decisions
- final approval / request-updates conditions
- privileged database writes
- GHL API calls
- ReviewStudio API calls
- signed file URL issuance

A disabled button, hidden field, route guard, React state value, or browser role flag is UX only.

## Input and State Validation

For security-sensitive operations:

1. Validate request method and body shape.
2. Enforce reasonable input/body limits where appropriate.
3. Normalize and validate identifiers.
4. Authenticate the caller/token.
5. Authorize role, resource, action, and current workflow state.
6. Perform only the smallest permitted operation.
7. Reject ambiguous, stale, duplicate, or inconsistent requests where they could violate an invariant.

## Logging

Logs must support debugging without exposing secrets.

Safe examples:

- operation name
- result status
- opaque internal record IDs when appropriate
- safe error category
- timestamps

Do not log:

- raw access tokens
- service-role keys
- GHL private tokens
- ReviewStudio API keys
- webhook secrets
- full authorization headers
- private signed URLs unless specifically required and appropriately protected

## Security-Preserving Debugging

Do not globally disable security because debugging is inconvenient.

Use:

```text
reproduce
→ identify trust boundary
→ test allowed behavior
→ test denied behavior
→ make smallest security-preserving fix
→ retest
```

Temporary local bypasses must never become production defaults.

## Verification Standard

A happy-path demo is not a security review.

Before production-ready status, verify relevant allowed and denied paths and run the release checklist with evidence using:

- PASS
- FAIL
- VERIFY
- N/A

