# Repository Guidelines

## Project Structure & Module Organization
`apps/web` contains the Next.js app-router frontend. Route segments live in `apps/web/app` (`chat`, `dashboard`, `login`, `onboarding`, `settings`, `signup`, `study`), and shared UI stays in `apps/web/app/components` or `apps/web/lib`. `apps/api` contains the Express API entrypoint in `apps/api/src/main.ts`, feature routers in `apps/api/src/modules`, and service code in `apps/api/src/lib` and `apps/api/src/integrations`. Root-level assets include `schema.sql` for PostgreSQL, `api-spec.yaml` for API shape, `infra/nginx` for deployment config, and `docs` for supporting notes.

## Build, Test, and Development Commands
Run commands from the repository root.

- `pnpm install`: install workspace dependencies.
- `pnpm dev:web`: start the Next.js frontend on `localhost:3000`.
- `pnpm dev:api`: start the API with `tsx watch` on `localhost:4000`.
- `createdb studyclaw_dev && psql studyclaw_dev < schema.sql`: initialize the local database.

There is no dedicated build, lint, or test script in `package.json` yet. If you add one, document it here and keep it runnable from the repo root.

## Coding Style & Naming Conventions
Use TypeScript throughout. Follow the existing code style: single quotes, semicolons, and component names in PascalCase. Use camelCase for variables/functions, and kebab-case for route folder names. Keep backend features grouped by domain under `apps/api/src/modules/<feature>`, and prefer small route/service files over expanding `main.ts`. Use 2-space indentation in new files and keep JSX readable by breaking long prop lists across lines.

## Testing Guidelines
Automated tests are not configured yet, so every change should include manual verification notes in the PR. For frontend work, exercise the affected route in `apps/web/app`. For backend work, hit the relevant `/api/*` endpoint after loading `schema.sql`. When adding tests, colocate them with the feature using `*.test.ts` or `*.spec.ts` and add a root script so contributors can run them consistently.

## Commit & Pull Request Guidelines
Current history uses short, imperative subjects and release commits (`Initial commit: StudyClaw starter project`, `Release v0.1.0`). Keep commit titles brief, specific, and in the imperative mood. PRs should include: a summary of user-visible changes, impacted areas (`apps/web`, `apps/api`, schema, or infra), setup or env changes, and screenshots for UI updates. Link the relevant task or issue whenever one exists.

## Security & Configuration Tips
Do not expose backend secrets in the frontend. Keep `.env` values local, treat `OPENCLAW_GATEWAY_TOKEN` as server-only, and avoid committing real credentials or generated `.next` output.
