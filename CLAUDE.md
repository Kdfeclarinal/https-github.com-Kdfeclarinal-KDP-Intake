# KDP Intake / Admin Review — Claude Code Instructions

## Project Role

This repository contains the KDP Intake / Admin Review system used for publishing operations.

Claude Code is the repository-aware implementation and verification agent. The ChatGPT codebase thread is the project-level instructor / architect / orchestrator and may provide task briefs, approved architectural decisions, runtime findings, and acceptance criteria.

This is an existing in-progress system. Do not redesign, restart, or migrate it unless the current task explicitly authorizes that work.

---

## Read First

Before meaningful project work, read:

1. `CLAUDE.md`
2. `PROJECT_CONTEXT.md`
3. `SECURITY_PROFILE.md`
4. The repository security entry point / router / core files referenced by `SECURITY_PROFILE.md`
5. Only the additional security modules that apply to the current capability
6. The `karpathy-guidelines` skill when writing, reviewing, refactoring, or planning code changes

If any of these files disagree with verified repository/runtime evidence, report the discrepancy. Do not silently choose a new architecture.

---

## Source of Truth

General project precedence:

1. Latest explicit user/task instruction
2. Current approved direction in `PROJECT_CONTEXT.md`
3. Verified runtime behavior and actual repository source
4. Current official vendor/framework documentation when version-specific behavior matters
5. Existing project documentation and comments
6. Assumptions

For security-specific conflicts, use this precedence:

1. Latest explicit project requirement
2. Verified runtime behavior and actual source code
3. Current official platform/vendor security documentation
4. `SECURITY_PROFILE.md`
5. Applicable files under the repository security system
6. General assumptions

Do not promote comments, plans, documentation, model agreement, or plausible architecture into claims about implemented behavior without source/runtime evidence.

---

## Primary Coding Agent / Model Context

Primary execution environment:

```text
Claude Code
→ OmniRoute
→ Kilo Gateway
→ HY3
```

Current preferred implementation model:

```text
kg/tencent/hy3:free
```

Fallback routing may exist through:

```text
kc/kilo-auto/free
```

Treat model names as routing handles, not quality rankings. Repository-specific evidence overrides generic model-tier assumptions.

If a provider fails, rate-limits, truncates, or Claude Code restarts, the repository state is authoritative. Reinspect affected files and the current git diff before continuing. Never assume an interrupted edit completed.

---

## Karpathy Guidelines

The project uses the installed `karpathy-guidelines` skill as a behavioral layer.

Apply it when writing, reviewing, refactoring, or planning code changes.

Key expectations:

- Think before coding.
- Surface assumptions and uncertainty.
- Prefer the smallest working solution.
- Make surgical changes.
- Do not refactor unrelated code.
- Define verifiable success criteria.
- Every changed line should trace directly to the requested task.
- If a simpler approach exists, say so.

Do not copy the entire skill into project files. Read and apply the installed skill itself.

---

## Core Engineering Rules

### Inspect Before Editing

For non-trivial work:

```text
inspect
→ establish evidence
→ plan the smallest justified change
→ implement
→ verify
→ inspect final diff
```

Use native Read / Grep / Glob first for ordinary repository inspection.

Do not invent file paths, APIs, database fields, Edge Functions, GHL behavior, or ReviewStudio behavior.

### Surgical Changes

- Touch only files needed for the task.
- Preserve existing working behavior.
- Do not clean up unrelated formatting or dead code.
- Match the existing code style unless the task explicitly changes it.
- Remove only imports/functions/variables made unused by your own change.
- Avoid speculative abstractions and premature framework layers.

### Backend Authority

The browser/UI is never the authority for security-sensitive or workflow-sensitive decisions.

Do not rely on:

- disabled buttons
- hidden controls
- client-side role flags
- browser state
- `book_id` / `review_round_id` knowledge
- frontend validation alone

for authorization, review eligibility, completion, finalization, or privileged writes.

Authoritative rules belong in Edge Functions, database constraints/RPCs, or other deterministic server-side logic.

### Preserve Current Backend Unless Explicitly Authorized

The current Supabase schema, access-token model, Edge Functions, ReviewStudio integration, and review-round workflow contain substantial verified work.

Do not replace them with Supabase Auth, a new API server, a new database, or another auth scheme merely because a new frontend framework is being tested.

Architecture migration requires explicit approval.

---

## Security Routing Is Mandatory

Security is part of planning, implementation, debugging, and release review.

For a new project capability or architecture change:

1. Read the repository security router.
2. Always apply security core.
3. Activate only modules applicable to the capability.
4. Update `SECURITY_PROFILE.md` if the security boundary changes.
5. Include security requirements in the implementation plan.

When security-related behavior fails:

```text
reproduce
→ inspect the security boundary
→ test allowed behavior
→ test denied behavior
→ make the smallest security-preserving fix
→ retest
```

Do not globally disable security to make debugging easier.

Before production/release, run the repository security release checklist and report applicable items as:

- PASS
- FAIL
- VERIFY
- N/A

with evidence.

A happy-path demo is not a security review.

---

## Secrets / Sensitive Values

Never print, commit, paste into task reports, or embed in browser code:

- Supabase service-role / secret keys
- GHL private integration tokens
- ReviewStudio API keys
- ReviewStudio webhook secrets
- signing secrets
- private webhook credentials
- database credentials
- raw access tokens unless an explicit local security test requires handling them, and even then do not log them

Do not expose secrets through:

- React/Vite bundles
- GHL Code elements
- browser console logs
- source maps
- localStorage/sessionStorage
- URL construction beyond the existing approved scoped access-token flow
- screenshots or copied DevTools output

If a token or secret is accidentally exposed during development, treat it as compromised and rotate/reissue it before release.

---

## Installed Skills / MCP / Tool Selection

Capabilities are a toolbox, not mandatory ceremony. Choose the smallest useful set for the task.

### Verified / Expected Relevant Tools

**Superpowers**
- Use selectively for planning, TDD, systematic debugging, verification, code review, or complex subagent workflows.
- Do not invoke heavyweight workflows for trivial edits.

**Graphify**
- If `graphify-out/graph.json` exists and cross-file relationships matter, use `graphify query`, `graphify path`, or `graphify explain` before broad raw browsing.
- Use ordinary Read/Grep when sufficient.
- After code changes, run `graphify update .` if this repository is using Graphify and the project workflow expects the graph to remain current.

**Context7**
- Use when implementation depends on current React, Vite, Supabase library, framework, SDK, or package behavior.
- Prefer retrieved current docs over model memory.

**Playwright**
- Use for meaningful browser/runtime verification, interaction tests, responsive checks, hydration behavior, and regression checks.
- Source code looking correct is not runtime proof.

**Frontend-design / Impeccable**
- Use after functional structure works when meaningful UI design/refinement is requested.
- Do not use them to expand the scope of a mount/integration proof.

**Motion AI Kit / other animation tools**
- Use only when deliberate motion materially improves UX.
- Do not add motion merely because the capability exists.

**Skill Creator / Find Skills / Claude Code Setup**
- Use only when the task genuinely requires them.

### Researched / Optional UI Resources

shadcn/ui, 21st.dev, UI UX Pro Max, Lucide, OriginKit, Motion/Framer Motion, Figma MCP, and other design resources are optional unless their installation is independently verified in the current environment.

Do not install or introduce them during the initial React/Vite GHL mount POC unless the task explicitly requires them.

### Disabled Memory Tool

Claude-Mem is disabled because it previously conflicted with the routing environment. Do not re-enable it automatically.

Repository files and native Claude Code context are preferred.

---

## Subagent Policy

Use subagents selectively.

### Small / Routine

Use the main coding agent only.

Examples:
- one-field validation change
- small CSS/selector fix
- isolated change across roughly 1–3 files

### Medium / Ambiguous

Use the main agent plus at most one targeted subagent when independent inspection materially reduces uncertainty.

Good roles:
- bounded source tracing
- skeptical review / attempted falsification

The main agent must verify material findings against actual source/runtime evidence.

### Big / High Risk

Multiple complementary subagents may be justified for:

- authentication/authorization
- secrets/security boundaries
- database migrations
- destructive operations
- concurrency
- major refactors
- production release review
- architecture spanning several subsystems

Prefer complementary roles, not duplicate opinions.

Agent agreement never substitutes for source/runtime evidence.

---

## Forensic Evidence Language

For read-only investigations, classify material findings as:

- `VERIFIED IN CODE`
- `VERIFIED IN RUNTIME`
- `VERIFIED IN PROJECT DOCUMENTATION`
- `INFERRED / PLANNED`
- `INCORRECT OR UNSUPPORTED`

If a claim depends on the live GHL/Supabase/ReviewStudio environment, keep it unverified until tested there.

---

## Current Development Gate

The current approved direction is **not a full frontend rebuild**.

The next architecture experiment is only a tiny React + Vite classic-IIFE app-shell proof of concept on an isolated GHL staging funnel page.

Until that POC is explicitly authorized for implementation:

- do not install frontend dependencies
- do not create the React app
- do not modify production GHL pages
- do not migrate Details, Content, Pricing, Admin Details, Admin Content, or Admin Pricing
- do not rewrite backend architecture
- do not change the auth model
- do not deploy production resources

When the POC is authorized, its scope is still limited to proving the app shell, lifecycle behavior, protected Edge Function access, one harmless test-only write, optional backend GHL event, responsiveness, and secret non-exposure.

Update this section when the approved project gate changes.

---

## React / Vite POC Constraints

When implementation is later authorized:

- React + Vite
- compiled external bundle
- classic IIFE-compatible build for GHL
- one `app.js`
- one `app.css`
- mount into `#kdp-intake-app`
- no raw JSX pasted into GHL
- no Next.js
- no Redux
- no heavy UI framework
- no production-page migration
- no backend rewrite
- initialization must be idempotent
- handle `DOMContentLoaded` and GHL `hydrationDone`
- mount exactly once

The POC should use a disposable staging page and disposable test book/status data.

---

## GHL Rules

GHL is currently used as the funnel/CRM surface and may also host the POC mount point.

For GHL work:

- distinguish staging from production
- do not modify production pages without explicit authorization
- assume GHL hydration can re-run lifecycle behavior
- make mount/init logic idempotent
- keep GHL Code elements small when using external bundles
- do not place private credentials in GHL HTML/CSS/JS
- do not rely on iframe/external-tracking behavior unless verified for the exact use case

The older selector-heavy GHL implementation remains working project history and may be used as behavioral reference, but do not migrate it until approved.

---

## Supabase / Database Rules

Supabase is the current source of truth for KDP workflow state.

Do not perform destructive migrations or schema changes without explicit approval.

Prefer:

- deterministic server-side validation
- database constraints where appropriate
- transactional RPCs for multi-record critical transitions
- least privilege
- default-deny RLS for public access where applicable
- Edge Functions for privileged operations

Service-role use is server-side only.

Direct browser-to-database privileged writes are not allowed.

A browser may use explicitly approved public/RLS-safe paths or short-lived signed upload URLs only when the security profile and current task permit them.

---

## Verification Before Completion

Never call work complete because the code "looks right."

Before reporting completion, use the verification appropriate to the task:

- build/type/syntax checks
- unit/integration tests where applicable
- database assertions
- browser/runtime verification
- responsive checks
- allowed + denied authorization tests for security-sensitive changes
- final `git diff` inspection

For UI work, use Playwright/browser evidence when practical.

For the React/Vite GHL POC, success must be tied to the explicit PASS/FAIL checklist in the POC task specification.

---

## External / Production Actions

Ask before:

- production deployment
- modifying a production GHL page
- destructive database operations
- credential changes
- paid API usage
- irreversible external mutations
- changing authentication/authorization architecture

Normal reversible repository edits within an explicitly authorized task do not require repeated approval after every file.

---

## Project Documentation Updates

After behavior is actually proven:

- update the relevant verification/progress entry in `PROJECT_CONTEXT.md`
- update `SECURITY_PROFILE.md` if the security boundary changed
- do not mark planned/research-only behavior as PASS

Do not rewrite project history for cosmetic reasons.

---

## Completion Report Format

For substantial tasks, return:

1. Objective completed
2. Files changed
3. What changed and why
4. Verification run
5. Evidence / PASS-FAIL results
6. Security-relevant findings
7. Remaining uncertainty / follow-up
8. Final diff summary

Do not claim deployment, runtime success, or production readiness without direct evidence.
