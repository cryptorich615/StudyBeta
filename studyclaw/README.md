# StudyClaw

StudyClaw is a student-focused AI platform built on top of OpenClaw. Each student gets an isolated StudyClaw agent, their own model credentials, their own Google Drive and Calendar context, and their own activity history. The repository contains both the web app and the API that coordinates OpenClaw, PostgreSQL, and Google OAuth.

This README is the main operator guide for understanding, configuring, and starting both StudyClaw and OpenClaw in this repo.

## What Is In This Repo

- `apps/web`: Next.js App Router frontend.
- `apps/api`: Express + TypeScript backend.
- `schema.sql`: baseline PostgreSQL schema.
- `packages/prompts`: prompt helpers for StudyClaw agent behavior.
- `infra/nginx`: reverse-proxy example config.
- `docs/README.md`: older notes. Keep for reference, but use this README as the primary startup guide.

## How StudyClaw Works

StudyClaw is split into a few layers:

1. Web app:
   The frontend handles signup, login, onboarding, dashboard, chat, study tools, and settings.

2. API:
   The backend handles JWT auth, Google OAuth, database access, OpenClaw calls, agent provisioning, and admin-only routes.

3. PostgreSQL:
   The database stores users, student profiles, reminders, chat history, agent state metadata, Google tokens, and activity logs.

4. OpenClaw:
   OpenClaw runs the actual agent backends. StudyClaw creates a per-student OpenClaw agent and a separate admin agent.

## Current Auth Model

StudyClaw does not use Express cookie sessions for app auth.

- The backend issues JWTs with HS256 and 7-day expiry.
- The frontend stores the session in `localStorage`.
- Protected API requests send `Authorization: Bearer <token>`.
- Google OAuth signs the user in through the backend, then redirects to a frontend callback page that stores the JWT on the frontend origin.

Relevant files:

- `apps/api/src/lib/auth.ts`
- `apps/api/src/modules/auth/auth.route.ts`
- `apps/web/lib/session.ts`
- `apps/web/lib/api.ts`
- `apps/web/app/auth/callback/page.tsx`

## Current OpenClaw Model

StudyClaw assumes OpenClaw is already installed and reachable by the API.

StudyClaw currently uses OpenClaw in two ways:

- Gateway mode:
  The API sends requests to `POST /v1/responses` using `OPENCLAW_BASE_URL` and `OPENCLAW_GATEWAY_TOKEN`.

- Agent management:
  The API also uses the `openclaw` CLI to create and maintain local per-user agents and the admin agent.

Relevant files:

- `apps/api/src/integrations/openclaw/openclaw.client.ts`
- `apps/api/src/lib/user-agent.ts`
- `apps/api/src/lib/openclaw-control.ts`
- `apps/api/src/lib/openclaw-config.ts`

## StudyClaw Agent Model

StudyClaw now layers a student-agent system on top of the existing `users` and `user_model_credentials` tables.

Important runtime concepts:

- Each student has one `users` row.
- Each student has one `agents` row.
- Each student gets one isolated OpenClaw agent.
- Each student can have one `user_google_tokens` row for Drive and Calendar access.
- Each student’s model-provider credentials remain in `user_model_credentials`.
- Admin behavior is isolated in `admin_agents`.

Locked agent traits live in:

- `apps/api/src/lib/agent-config.ts`

That file defines:

- the immutable StudyClaw safety and student-focus rules
- the quick-start templates
- the merge logic that applies mutable config without allowing the student to override core constraints

## Database Overview

The project still uses `schema.sql` as the baseline schema. On top of that, the API also runs additive startup checks in:

- `apps/api/src/lib/platform-schema.ts`

That startup bootstrap ensures newer tables and columns exist even if the original database was created from an older version of `schema.sql`.

Important tables:

- `users`
- `student_profiles`
- `agent_profiles`
- `agents`
- `user_model_credentials`
- `user_google_tokens`
- `admin_agents`
- `agent_actions`
- `chat_threads`
- `chat_messages`
- `reminders`
- `flashcard_sets`
- `flashcards`
- `quizzes`
- `quiz_questions`

## Requirements

You need all of the following available on the machine that runs StudyClaw:

- Node.js 20+
- pnpm 9+
- PostgreSQL
- OpenClaw installed and available on `PATH`
- A reachable OpenClaw gateway
- Google OAuth credentials if you want Google sign-in, Drive, and Calendar

Optional but recommended:

- `nginx` for VPS reverse proxy
- `pm2` or `systemd` for production process management

## Environment Variables

This repo currently reads from a root `.env`.

Minimum backend variables:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/studyclaw
JWT_SECRET=change-me
OPENCLAW_BASE_URL=http://localhost:18789
OPENCLAW_GATEWAY_TOKEN=replace-me
OPENCLAW_DEFAULT_MODEL=openrouter/auto
```

Google OAuth variables:

```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:4000/api/auth/google/callback
CLIENT_URL=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:3000
```

Fallback URL variables still used in parts of the app:

```env
API_BASE_URL=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:4000
FRONTEND_URL=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:3000
```

Helpful optional variables:

```env
CORS_ORIGIN=http://localhost:3000,http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:3000
STUDYCLAW_ADMIN_EMAIL=you@example.com
STUDYCLAW_STUDENT_DAILY_AGENT_ACTIONS=150
GOOGLE_TOKEN_ENCRYPTION_KEY=replace-with-a-long-random-secret
NODE_TLS_REJECT_UNAUTHORIZED=0
```

Frontend variable:

Create `apps/web/.env.local` when needed:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

For VPS testing:

```env
NEXT_PUBLIC_API_BASE_URL=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:4000
```

## Google OAuth Setup

StudyClaw’s current Google flow expects:

- a Google OAuth client configured in Google Cloud
- the backend callback URL registered exactly
- the frontend URL used after auth to match the running host

At minimum, your Google OAuth client should allow:

- `http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:4000/api/auth/google/callback`

If you also develop locally, add the localhost callback too:

- `http://localhost:4000/api/auth/google/callback`

Requested scopes currently include:

- `openid`
- `email`
- `profile`
- `https://www.googleapis.com/auth/drive.file`
- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/calendar.readonly`

## OpenClaw Setup

Before you start StudyClaw, confirm OpenClaw is working.

Checklist:

1. Make sure the `openclaw` CLI is installed.
2. Make sure the OpenClaw gateway is running.
3. Make sure the API can reach `OPENCLAW_BASE_URL`.
4. Make sure `OPENCLAW_GATEWAY_TOKEN` matches the gateway token.
5. Make sure the model providers you want are configured in OpenClaw.

StudyClaw uses:

- the gateway token for response generation
- local agent directories under the OpenClaw home
- CLI-based agent creation for student and admin agents

If OpenClaw is installed in a non-default location, set:

```env
OPENCLAW_HOME=/path/to/.openclaw
```

## Local Development: First-Time Setup

### 1. Install dependencies

At the repo root:

```bash
pnpm install
```

### 2. Create the database

Example:

```bash
createdb studyclaw
psql studyclaw < schema.sql
```

If your local DB name differs, update `DATABASE_URL`.

### 3. Create the env files

Root `.env`:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/studyclaw
JWT_SECRET=change-me
OPENCLAW_BASE_URL=http://localhost:18789
OPENCLAW_GATEWAY_TOKEN=replace-me
OPENCLAW_DEFAULT_MODEL=openrouter/auto
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_CALLBACK_URL=http://localhost:4000/api/auth/google/callback
CLIENT_URL=http://localhost:3000
API_BASE_URL=http://localhost:4000
FRONTEND_URL=http://localhost:3000
CORS_ORIGIN=http://localhost:3000
```

Frontend `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:4000
```

### 4. Start OpenClaw

Make sure your OpenClaw gateway is already running before you start StudyClaw.

If OpenClaw is not running, StudyClaw can still render pages, but agent-backed flows like chat, coach, and study generation will fail.

### 5. Start the API

```bash
pnpm dev:api
```

Expected output:

```text
StudyClaw API listening on http://localhost:4000
```

### 6. Start the web app

In a second terminal:

```bash
pnpm dev:web
```

Expected output includes:

```text
Local: http://localhost:3000
```

### 7. Open the app

Go to:

- `http://localhost:3000`

## VPS / EC2 Startup Guide

This is the simplest path for the current codebase.

### 1. Clone and install

```bash
git clone <your-repo-url> studyclaw
cd studyclaw
pnpm install
```

### 2. Prepare PostgreSQL

```bash
createdb studyclaw
psql studyclaw < schema.sql
```

### 3. Configure env

Root `.env` should contain real production or staging values:

```env
DATABASE_URL=postgres://postgres:postgres@localhost:5432/studyclaw
JWT_SECRET=replace-this
OPENCLAW_BASE_URL=http://127.0.0.1:18789
OPENCLAW_GATEWAY_TOKEN=replace-this
OPENCLAW_DEFAULT_MODEL=openrouter/auto
GOOGLE_CLIENT_ID=replace-this
GOOGLE_CLIENT_SECRET=replace-this
GOOGLE_CALLBACK_URL=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:4000/api/auth/google/callback
CLIENT_URL=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:3000
API_BASE_URL=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:4000
FRONTEND_URL=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:3000
CORS_ORIGIN=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:3000
STUDYCLAW_ADMIN_EMAIL=you@example.com
GOOGLE_TOKEN_ENCRYPTION_KEY=replace-this
```

Set `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_BASE_URL=http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:4000
```

### 4. Start OpenClaw first

Confirm:

- the gateway is reachable
- the gateway token is correct
- the models you want are available

### 5. Start StudyClaw API

For direct testing:

```bash
pnpm dev:api
```

For managed startup, wrap it with `pm2` or `systemd`.

### 6. Start StudyClaw web

For direct testing:

```bash
pnpm dev:web
```

For a more production-like flow:

```bash
cd apps/web
pnpm exec next build
pnpm exec next start -p 3000
```

### 7. Reverse proxy with nginx

Use `infra/nginx/studyclaw-api.conf` as a starting point.

Typical target layout:

- web app on `127.0.0.1:3000`
- API on `127.0.0.1:4000`
- optional public hostname in front of both

### 8. Verify startup

Check these manually:

- `http://<host>:4000/api/health`
- `http://<host>:3000`
- `http://<host>:3000/login`
- `http://<host>:3000/onboarding`
- `http://<host>:3000/dashboard`

## Recommended Startup Order

When bringing the full stack up, use this order:

1. PostgreSQL
2. OpenClaw gateway
3. StudyClaw API
4. StudyClaw web app
5. Browser validation

If you skip OpenClaw, auth and some pages still load, but:

- chat fails
- coach processing fails
- flashcard generation fails
- quiz generation fails

## First End-To-End Test

After the system is running, test in this order:

1. Open the homepage.
2. Click Sign up or Log in.
3. Complete Google OAuth or email auth.
4. Confirm you land on `/auth/callback`, then `/onboarding` or `/dashboard`.
5. Complete onboarding with a model and quick-start selection.
6. Open `/dashboard`.
7. Open `/chat` and send a prompt.
8. Open `/study` and generate flashcards.
9. Open `/coach` and process a note.
10. Return to `/dashboard` and confirm the activity feed updates.

## Important Runtime Behavior

### OAuth callback flow

The backend callback no longer tries to store the session on the backend origin.

Current flow:

1. Google redirects to the backend callback.
2. The backend creates or updates the user.
3. The backend creates a JWT session payload.
4. The backend redirects to `CLIENT_URL/auth/callback?payload=...`.
5. The frontend callback page stores the JWT in `localStorage`.
6. The frontend redirects to onboarding or dashboard.

### Agent creation flow

During auth and onboarding:

- the backend ensures a personal OpenClaw agent exists
- the backend ensures an `agents` row exists
- the backend stores model credentials in `user_model_credentials`
- the backend stores Google tokens in `user_google_tokens`

### Schema bootstrap flow

The app runs additive schema checks on startup. That means:

- an older database can still boot after code changes
- new columns and tables may be created at API startup

This behavior currently lives in:

- `apps/api/src/lib/platform-schema.ts`

## Troubleshooting

### “Sign in to see your live student board”

This usually means the frontend did not get a stored JWT.

Check:

- that Google OAuth redirects to `/auth/callback`
- that the page is on the frontend origin, not the API origin
- that `CLIENT_URL` matches the browser host
- that localStorage contains `studyclaw-user`

### Google OAuth returns redirect mismatch

Check:

- `GOOGLE_CALLBACK_URL`
- Google Cloud authorized redirect URIs
- whether the hostname matches exactly, including scheme and port

### Dashboard still shows logged-out state

Check:

- `apps/web/lib/session.ts`
- `apps/web/lib/api.ts`
- browser localStorage
- whether the auth callback page ran successfully

### Chat or study tools fail

Check:

- OpenClaw gateway is up
- `OPENCLAW_BASE_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- selected model is valid
- `user_model_credentials` contains a usable key

### Database errors about missing columns

Check:

- API startup logs
- whether `platform-schema.ts` ran
- whether the DB user can alter tables

### CORS issues

Set:

```env
CORS_ORIGIN=http://localhost:3000,http://ec2-3-148-233-46.us-east-2.compute.amazonaws.com:3000
```

### Insecure TLS warning

If you see a warning caused by:

```env
NODE_TLS_REJECT_UNAUTHORIZED=0
```

that is only acceptable for temporary testing. Remove it when you have valid TLS in place.

## Useful Commands

Install deps:

```bash
pnpm install
```

Start API:

```bash
pnpm dev:api
```

Start web:

```bash
pnpm dev:web
```

Apply base schema manually:

```bash
psql studyclaw < schema.sql
```

Typecheck API:

```bash
pnpm exec tsc -p apps/api/tsconfig.json --noEmit
```

Typecheck web:

```bash
pnpm exec tsc -p apps/web/tsconfig.json --noEmit
```

## Where To Edit Common Things

- Auth logic: `apps/api/src/lib/auth.ts`
- Google OAuth: `apps/api/src/modules/auth/auth.route.ts`
- Google service: `apps/api/src/lib/google-service.ts`
- Agent policy: `apps/api/src/lib/agent-config.ts`
- Agent provisioning: `apps/api/src/lib/user-agent.ts`
- Dashboard API: `apps/api/src/modules/dashboard/dashboard.route.ts`
- Dashboard UI: `apps/web/app/dashboard/page.tsx`
- Onboarding API: `apps/api/src/modules/onboarding/onboarding.route.ts`
- Onboarding UI: `apps/web/app/onboarding/page.tsx`
- Admin routes: `apps/api/src/modules/admin/admin.route.ts`

## Current Gaps

The current system is running and testable, but still has a few practical gaps:

- no dedicated migration system yet
- no full production build scripts in `package.json`
- Google tokens are app-encrypted, but key management is still env-based
- OpenClaw startup itself is assumed, not managed by this repo

## Recommended Next Cleanup

1. Add real build and start scripts for production.
2. Move schema bootstrap into versioned migrations.
3. Add health checks for OpenClaw connectivity.
4. Add a dedicated admin UI surface.
5. Add explicit deployment docs for `systemd` or `pm2`.

## Reference Files

- `BUILD_BRIEF.md`
- `schema.sql`
- `apps/api/src/lib/platform-schema.ts`
- `apps/api/src/lib/agent-config.ts`
- `apps/api/src/lib/google-service.ts`
- `apps/api/src/lib/user-agent.ts`
- `apps/api/src/modules/auth/auth.route.ts`
- `apps/api/src/modules/onboarding/onboarding.route.ts`
- `apps/api/src/modules/dashboard/dashboard.route.ts`
- `apps/api/src/modules/admin/admin.route.ts`

