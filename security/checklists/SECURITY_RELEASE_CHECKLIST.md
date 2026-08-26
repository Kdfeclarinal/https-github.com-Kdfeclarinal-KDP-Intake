# KDP Intake / Admin Review — Security Release Checklist

## How to Use

Run this checklist for the modules active in the current stage.

For every applicable line record:

- PASS
- FAIL
- VERIFY
- N/A

and include concise evidence.

A happy-path demo is not sufficient.

---

## A. Core

| Check | Status | Evidence |
|---|---|---|
| Security modules were routed for the current capability |  |  |
| Untrusted inputs are identified and validated at the correct boundary |  |  |
| Authorization is server-side for privileged actions |  |  |
| Security-sensitive failure behavior is fail-closed |  |  |
| No security control was disabled merely to make debugging easier |  |  |
| Relevant allowed and denied paths were tested |  |  |

## B. Frontend Trust

| Check | Status | Evidence |
|---|---|---|
| Frontend does not act as authority for role/resource/workflow decisions |  |  |
| No privileged write occurs automatically on app mount |  |  |
| Repeated `DOMContentLoaded` / `hydrationDone` does not duplicate mount or side effects |  |  |
| No unsafe raw-HTML sink was introduced without review |  |  |
| Browser-visible state is treated as manipulable |  |  |

## C. Secrets

| Check | Status | Evidence |
|---|---|---|
| No Supabase service-role/secret key in browser/source/bundle |  |  |
| No GHL private token/client secret in browser/source/bundle |  |  |
| No ReviewStudio API/webhook secret in browser/source/bundle |  |  |
| No private secret in logs, screenshots, task reports, or committed env files |  |  |
| Public build artifacts inspected for accidental secret strings |  |  |

## D. Dependencies

| Check | Status | Evidence |
|---|---|---|
| Only dependencies required by the approved scope were added |  |  |
| Package names/versions were verified |  |  |
| Lockfile exists when implementation is committed |  |  |
| No unrelated dependency upgrades were bundled with the change |  |  |
| Build artifacts match expected `app.js` / `app.css` shape for the POC |  |  |

## E. Protected API / Authorization

Complete when Stage B or later is active.

| Check | Status | Evidence |
|---|---|---|
| Existing scoped authorization model was preserved unless explicitly changed |  |  |
| Valid scoped request succeeds |  |  |
| Missing/invalid token is denied |  |  |
| Wrong resource scope is denied where applicable |  |  |
| Wrong role/page/action is denied where applicable |  |  |
| Invalid/stale workflow state is denied where applicable |  |  |
| CORS is not being relied on as authorization |  |  |
| Duplicate/replayed privileged requests cannot violate workflow invariants |  |  |
| API response does not expose token hashes or server secrets |  |  |

## F. GHL Staging POC Acceptance

| Check | Status | Evidence |
|---|---|---|
| Isolated staging page only; production pages unchanged |  |  |
| External classic `app.js` loads |  |  |
| External `app.css` loads |  |  |
| React mounts exactly once |  |  |
| GHL Preview works |  |  |
| Published staging page works |  |  |
| Desktop layout works |  |  |
| Mobile layout works |  |  |
| Browser Sources/Network/Storage inspection completed |  |  |
| No server-only secret exposed in browser inspection |  |  |

## G. Production-Release Gate

These are not satisfied merely by passing the staging POC.

| Check | Status | Evidence |
|---|---|---|
| Full active-module security review completed |  |  |
| Browser-console bypass attempts performed for client-side protections |  |  |
| Server authority still rejects unauthorized manipulated requests |  |  |
| Audit/status history behavior verified for privileged transitions |  |  |
| Rollback plan verified |  |  |
| No unresolved FAIL items remain |  |  |
| VERIFY items are resolved or explicitly accepted before production |  |  |

