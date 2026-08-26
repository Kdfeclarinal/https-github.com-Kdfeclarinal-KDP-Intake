# KDP Intake / Admin Review — Frontend Trust Boundary

## Scope

Applies to all browser-visible code, including:

- current GHL custom HTML/CSS/JavaScript
- React/Vite bundles
- GHL Code elements
- query parameters
- browser storage
- DOM state
- browser network requests

## Trust Model

Assume the user can modify any client-side value with DevTools.

Treat as untrusted:

- `book_id`
- `review_round_id`
- access-token input supplied by the browser
- role flags
- step/status values
- disabled/enabled controls
- hidden inputs
- comments and form values
- localStorage/sessionStorage
- client-side validation results
- file metadata supplied by the browser

The frontend may improve UX, but it must not grant authority.

## Browser-to-Backend Rule

The browser may call only approved public/protected backend paths appropriate to the current architecture.

For the KDP POC:

```text
React/GHL browser
→ existing protected Supabase Edge Function
→ server-side authorization
→ data/action
```

Do not introduce direct privileged table writes merely because React is being introduced.

## Client Bundle Rules

The compiled `app.js` / `app.css` must not contain server-only credentials.

Never embed:

- Supabase service-role / secret key
- GHL private integration token
- GHL OAuth client secret
- ReviewStudio API key/token
- ReviewStudio webhook secret
- private signing/encryption secrets

Public configuration may be included only when it is intentionally browser-safe.

## Access Tokens

The current KDP system uses scoped opaque access tokens. A browser may need to carry a scoped token to call protected Edge Functions, but:

- never hardcode a raw token in source or the compiled bundle
- never print the raw token in console logs
- never include raw tokens in screenshots/reports
- do not treat possession of a resource ID as equivalent to authorization
- server validation remains mandatory on every protected operation

## DOM / Rendering

- Prefer normal React rendering and text escaping.
- Do not introduce raw HTML injection (`dangerouslySetInnerHTML`, equivalent DOM sinks) without a demonstrated requirement and reviewed sanitization strategy.
- Do not trust content merely because it came from a database; stored data can still originate from untrusted input.

## GHL Hydration / Mounting

`DOMContentLoaded` and GHL `hydrationDone` handling is a reliability requirement, not an authorization control.

The mount must be idempotent so repeated lifecycle events do not create duplicate application instances or duplicate side effects.

The mount-only POC must not automatically perform privileged writes on mount.

## Browser Verification

Before the POC is accepted, inspect:

- page source
- loaded JavaScript bundle
- Network requests
- browser console
- local/session storage

Confirm no server-only secret is exposed and no duplicate mount/write occurs.

