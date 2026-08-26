# KDP Intake / Admin Review — Dependency and Supply-Chain Security

## Principle

Use the smallest dependency set that solves the approved task.

Do not install packages because they are popular, convenient, or might be useful later.

## React/Vite POC Baseline

Initial candidate dependencies:

- `react`
- `react-dom`
- `vite`

Add another package only when a demonstrated implementation need justifies it.

For example, `@vitejs/plugin-react` should not be added merely by habit if the required build works correctly without it.

Do not add during the mount-only POC unless explicitly approved:

- Redux or another state manager
- React Router
- Tailwind
- shadcn or another UI framework
- Motion/Framer Motion
- Supabase JS SDK
- analytics SDKs
- arbitrary GHL/ReviewStudio browser SDKs

## Installation Rules

Before adding a dependency:

1. State the concrete requirement it solves.
2. Prefer existing/native platform capability when simpler.
3. Check package identity and intended package name carefully.
4. Use the repository's established package manager once established.
5. Commit the lockfile when the POC/code is committed.
6. Review the resulting dependency/diff surface.

## Version and Upgrade Rules

- Do not perform broad dependency upgrades as part of unrelated work.
- Do not blindly use the newest major version if compatibility is unverified.
- For version-sensitive behavior, prefer current official documentation.
- If live/current documentation is unavailable, surface uncertainty instead of guessing.

## Vulnerability Handling

When a relevant advisory or audit finding exists:

- determine whether the vulnerable path is actually reachable in this project
- prefer the smallest compatible remediation
- verify build/runtime behavior after remediation
- do not suppress a meaningful vulnerability merely to obtain a green audit

Do not treat an automated package audit as a complete security review.

## Build Artifact Review

For the POC verify:

- expected output is only `dist/app.js` and `dist/app.css`
- no accidental extra runtime chunks
- no server-only secret strings in output
- no unnecessary source maps in the public staging artifact unless explicitly needed and reviewed

## Third-Party Runtime Scripts

Do not add third-party browser scripts outside the approved bundle unless required and reviewed.

Every third-party runtime dependency increases supply-chain and privacy surface.

