# Repository Guidelines

## Project Structure & Module Organization
This repo is organized as a small monorepo. `apps/web` contains the Next.js frontend and route-driven UI in `app/`. `apps/api` contains the Express API, migrations, and integration code under `src/`. Shared prompt assets live in `packages/prompts`. Deployment and runtime files are in `infra/` and `run-studyclaw-supervisor.sh`. Legacy or transitional code also exists under `src/` and `prisma/`; prefer extending `apps/web` and `apps/api` unless a task clearly targets the older paths.

## Build, Test, and Development Commands
- `pnpm dev:web`: start the frontend from `apps/web`.
- `pnpm dev:api`: start the API with `tsx watch`.
- `pnpm migrate:api`: run API database migrations.
- `cd apps/web && next build`: production build for the frontend.
- `pnpm exec tsc -p apps/api/tsconfig.json --noEmit`: API typecheck.
- `curl -s http://127.0.0.1:4000/api/health`: quick API health check.

CI in `.github/workflows/ci.yml` also runs `npm ci`, `npx tsc --noEmit`, `npm run build`, and `npm test`, so keep local changes compatible with both the workspace scripts and CI expectations.

## Coding Style & Naming Conventions
Use TypeScript throughout. Follow the style already present in the file you touch; this repo currently mixes 2-space and 4-space indentation. Prefer single quotes, semicolons, and small focused functions. Use `PascalCase` for React components, `camelCase` for variables/functions, and kebab-case for route folders like `settings/scheduled-jobs`. Keep API route files named `*.route.ts`.

## Testing Guidelines
There is not yet a large committed test suite, so every change should at minimum pass a targeted build or typecheck. For UI work, run `next build` in `apps/web`. For backend work, run the API TypeScript check and any affected migration path. When adding tests, place them near the feature and use `*.test.ts` or `*.spec.ts`.

## Commit & Pull Request Guidelines
Recent history uses short, imperative commit subjects such as `Save current StudyClaw and OpenClaw state`. Keep commits focused and descriptive. PRs should include a clear summary, risk notes, touched areas (`apps/web`, `apps/api`, migrations), and screenshots or request/response examples for visible behavior changes.

## Security & Configuration Tips
Never commit real secrets or tokens. Review `.env` changes carefully, especially OpenClaw, Google OAuth, and database settings. If a change affects onboarding, auth, or agent launch, verify the full user flow before merging.
