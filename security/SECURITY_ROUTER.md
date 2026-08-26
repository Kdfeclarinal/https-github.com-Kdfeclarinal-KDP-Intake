# KDP Intake / Admin Review — Security Router

## Purpose

Use this file to select the smallest security context required for the current task. Security is part of planning, implementation, debugging, and release review; it is not a final polish step.

For every new capability or architecture change:

1. Read `SECURITY_CORE.md`.
2. Identify the capabilities actually exercised by the task.
3. Read only the matching additional modules.
4. Reconcile the result with the root `SECURITY_PROFILE.md`.
5. If the trust boundary changes, update `SECURITY_PROFILE.md` before implementation.
6. Before release, run `checklists/SECURITY_RELEASE_CHECKLIST.md` for all active modules.

Do not load every security module into every task.

## Security Source-of-Truth Order

When security guidance conflicts, prefer:

1. Latest explicit project requirement.
2. Verified runtime behavior and actual source code.
3. Current official platform/vendor security documentation.
4. Root `SECURITY_PROFILE.md`.
5. Applicable files in this `security/` directory.
6. General assumptions.

Do not guess about current vendor security behavior when the answer is version-sensitive.

## Module Map

| Capability | Module | When to activate |
|---|---|---|
| Every task | `SECURITY_CORE.md` | Always |
| Browser / React / GHL client code | `SECURITY_FRONTEND_TRUST.md` | Any frontend code or browser-visible state |
| Credentials / tokens / env vars | `SECURITY_SECRETS.md` | Any task that handles or could expose secrets |
| Protected Edge Functions / authorization | `SECURITY_API_AUTH.md` | Any protected read/write or server action |
| npm / React / Vite / third-party packages | `SECURITY_DEPENDENCIES.md` | Any dependency or build-tool change |
| Release / deployment | `checklists/SECURITY_RELEASE_CHECKLIST.md` | Before staging acceptance and production release |

Additional modules should be added only when the project begins exercising a new capability such as file upload/storage changes, arbitrary server-side URL fetching, webhook verification, or another new trust boundary.

## Current React/Vite GHL POC Routing

### Stage A — Mount-only proof

Active modules:

- `SECURITY_CORE.md`
- `SECURITY_FRONTEND_TRUST.md`
- `SECURITY_SECRETS.md`
- `SECURITY_DEPENDENCIES.md`

Not active yet:

- API/auth module for backend calls
- webhook-specific module
- storage/upload module

### Stage B — Protected Edge Function read/write

Add:

- `SECURITY_API_AUTH.md`

The existing KDP scoped opaque-token model remains authoritative unless a separate migration is explicitly approved.

### Stage C — Backend-generated GHL event

Do not invent a new browser-to-GHL privileged path. Before implementation, inspect the actual backend integration and route any additional webhook/integration security module needed by that verified design.

## Re-routing Triggers

Re-run this router before implementing any newly introduced capability, including:

- new authentication or authorization mechanism
- direct Supabase browser access
- file upload/storage changes
- new GHL API or webhook path
- new ReviewStudio API/webhook path
- arbitrary server-side URL fetching
- new paid API
- new background worker/retry system
- new privileged admin action
- production deployment architecture change

