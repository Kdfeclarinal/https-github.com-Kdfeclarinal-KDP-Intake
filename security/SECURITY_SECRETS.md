# KDP Intake / Admin Review — Secrets Handling

## Server-Only Secret Inventory

The following are server-only unless a future reviewed architecture explicitly changes that classification:

| Credential | Allowed location |
|---|---|
| Supabase service-role / secret key | Supabase Edge Function/server environment only |
| GHL private integration token | server environment only |
| GHL OAuth client secret, if introduced | server environment only |
| ReviewStudio API key/token | server environment only |
| ReviewStudio webhook/signing secret | server environment only |
| database credentials | managed server environment only |
| signing/encryption secrets | managed secret store/server environment only |

## Never Store or Expose Server Secrets In

- React/Vite source
- compiled `app.js` / `app.css`
- GHL Code elements
- HTML
- client-side environment variables
- source maps shipped publicly
- git commits/history
- task prompts or model context
- browser console output
- copied logs/screenshots
- localStorage/sessionStorage

## Browser-Safe Configuration

Only intentionally public configuration may be exposed to the browser, for example a public endpoint URL or other non-secret identifiers required by the approved client architecture.

A value being called an "API key" does not automatically mean it is safe or unsafe; classify it from the vendor's official security model and the project architecture before exposing it.

## Environment Handling

- Use environment/secret management provided by the backend platform.
- Do not create committed `.env` files containing real credentials.
- If local env files are later required, ensure secret-bearing variants are gitignored before use.
- Use separate staging/test credentials where practical.

## Logs and Errors

Errors returned to the browser must not include:

- raw secrets
- full authorization headers
- service configuration containing secrets
- internal stack/config details that unnecessarily reveal privileged values

## Suspected Exposure

If a secret is exposed:

1. Stop using it.
2. Revoke/rotate it through the owning platform.
3. Remove it from source/logs where possible.
4. Check git/history/artifacts for persistence.
5. Verify the replacement secret remains server-only.
6. Record the incident without copying the secret itself.

Do not attempt to recover a raw secret from a hash or otherwise reconstruct a protected credential.

