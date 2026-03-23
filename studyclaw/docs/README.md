# StudyClaw starter with real OpenClaw wiring

## Product brief
- The project build brief lives in `BUILD_BRIEF.md`.
- Treat the brief as the default product contract for future implementation.
- The non-negotiable product rules in that file should override convenience decisions during feature work.

## Testing locally
1. Install dependencies: run `pnpm install` at the repo root (requires Node 20+ and pnpm 9+).
2. Provision a local Postgres database (for example `createdb studyclaw_dev`) and apply `schema.sql` via `psql studyclaw_dev < schema.sql`.
3. Create a `.env` for `apps/api` with values such as:
   - `DATABASE_URL=postgresql://localhost/studyclaw_dev`
   - `OPENCLAW_BASE_URL=<your gateway>`
   - `OPENCLAW_GATEWAY_TOKEN=<token>`
   - `PORT=4000`
   - `CORS_ORIGIN=http://localhost:3000`
4. Create a `.env.local` for `apps/web` with:
   - `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000`
5. In one terminal, start the backend: `pnpm dev:api`.
6. In another terminal, start the frontend: `pnpm dev:web`.
7. Visit `http://localhost:3000` to see the priority-first UI and exercise onboarding/chat/study flows.

## Testing on a VPS
1. Provision a Linux VPS (Ubuntu 24.04+ recommended) and install system packages: Node.js 20+, `pnpm`, and Postgres (plus `nginx` if you plan to reverse-proxy).
2. Clone the repo into `/home/<user>/studyclaw` and `cd` into it.
3. Install dependencies with `pnpm install`.
4. Initialize the production Postgres database (e.g., `createdb studyclaw_prod`) and execute `psql studyclaw_prod < schema.sql`.
5. Create a `.env` on the server (preferably outside the repo) with production values:
   - `DATABASE_URL=postgresql://<dbuser>:<dbpass>@localhost/studyclaw_prod`
   - `OPENCLAW_BASE_URL=https://<your-gateway>`
   - `OPENCLAW_GATEWAY_TOKEN=<token>`
   - `PORT=4000`
   - `NODE_ENV=production`
   - `CORS_ORIGIN=https://<your-web-domain-or-ip>`
6. Create `apps/web/.env.local` with:
   - `NEXT_PUBLIC_API_BASE_URL=https://<your-api-domain-or-ip>`
7. Start the API behind a process manager such as `pm2` or a `systemd` service: `pnpm dev:api` (or `NODE_ENV=production pnpm dev:api`) and ensure it listens on the configured `PORT`.
8. Deploy the Next.js frontend similarly (`pnpm dev:web` for testing or build with `pnpm --filter apps/web build && pnpm --filter apps/web start`).
9. Configure `nginx` using `infra/nginx/studyclaw-api.conf` as a template to proxy `/api` to the backend and serve the Next.js app, then restart `nginx`.
10. Point your DNS or use the server IP to load the web UI (port 80/443) and verify the home, dashboard, chat, and study flows are working.

## Validation checklist
1. Open `/settings` and confirm the frontend shows the expected API target from `NEXT_PUBLIC_API_BASE_URL`.
2. Create an account on `/signup`, then confirm `/settings` shows the stored session and user ID.
3. Complete `/onboarding` and confirm the API returns success instead of `missing_agent`.
4. Open `/chat`, send a prompt, and verify a response is returned from the API for the signed-in user.
5. Open `/study`, generate flashcards and a quiz, and verify both return persisted IDs from Postgres.
6. Confirm dark and light mode remain readable on home, onboarding, chat, study, and settings.
7. Repeat the same checks after pointing `NEXT_PUBLIC_API_BASE_URL` at the VPS API.

## Current product audit
- Add: explicit assignments and exams data models plus CRUD, because the current dashboard is still mostly presentational.
- Add: a real auth model replacing the starter `x-user-id` header, because VPS testing should not depend on client-forged identity.
- Add: file upload and syllabus ingestion so the assistant is grounded in real student documents.
- Change: dashboard cards from static examples to live data from courses, deadlines, reminders, and AI recommendations.
- Change: onboarding so it captures courses and deadlines in structured form instead of only comma-separated subject names.
- Remove: remaining placeholder copy once the live data flows exist, especially fake reminders and sample priorities.

## Included
- `schema.sql`: PostgreSQL MVP schema
- `api-spec.yaml`: API starter spec
- `apps/api`: Express + TypeScript backend starter
- `apps/web`: Next.js page skeletons
- `packages/prompts`: base study prompt builder
- `infra/nginx`: reverse proxy example

## OpenClaw wiring
- The API calls `POST /v1/responses` on your OpenClaw gateway.
- Set `OPENCLAW_BASE_URL` to your gateway origin, for example `https://3.148.233.46`.
- Set `OPENCLAW_GATEWAY_TOKEN` to the real gateway token from your server config.
- The frontend must never receive the gateway token directly.
- Rotate the gateway token before production if it was ever exposed.

## Immediate next steps
1. Create a Postgres database and run `schema.sql`.
2. Replace the fake `x-user-id` auth middleware with real JWT auth.
3. Install dependencies for `express`, `cors`, `body-parser`, `pg`, `tsx`, and your TypeScript toolchain.
4. Start the API and test `/api/chat/send` with a user who has completed onboarding.
5. Add OCR, transcription, and object storage next.
