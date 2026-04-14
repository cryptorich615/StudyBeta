# StudyClaw Deployment

## Vercel

- Root Directory: `studyclaw`
- Framework Preset: `Next.js`
- Install Command: `pnpm install --frozen-lockfile`
- Build Command: `pnpm vercel-build`
- Output Directory: `apps/web/.next`

The repo is intentionally deployable from `StudyBeta/studyclaw`. Do not point Vercel at the parent `StudyBeta` directory.

## Package Manager

- `package.json` declares `pnpm@9.0.0`
- `pnpm-lock.yaml` is a v9 lockfile

Use the declared pnpm version when reinstalling locally or in CI. The long-term fix for lockfile errors is to regenerate and commit `pnpm-lock.yaml` with the same package manager version if dependencies change.

## Required Vercel Environment Variables

Frontend:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_API_URL`

Backend/API runtime values used by the app and VM:

- `API_BASE_URL`
- `DATABASE_URL`
- `JWT_SECRET`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- `CORS_ORIGIN`
- `CLIENT_URL`
- `FRONTEND_URL`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `OPENCLAW_BASE_URL`
- `OPENCLAW_GATEWAY_TOKEN`
- `OPENCLAW_DEFAULT_MODEL`
- `OPENCLAW_HOME`
- `OPENCLAW_CONFIG_PATH`

Feature-specific optional variables:

- `BROWSER_PROVIDER`
- `BROWSER_BASE_URL`
- `STUDYCLAW_ADMIN_EMAIL`
- `STUDYCLAW_ADMIN_AGENT_ID`
- `STUDYCLAW_TIER1_LIMIT`
- `STUDYCLAW_TIER2_LIMIT`
- `STUDYCLAW_TIER3_LIMIT`
- `STUDYCLAW_RESET_INTERVAL_HOURS`
- `MINIMAX_API_KEY`
- `STUDYCLAW_MANAGED_USAGE_SECRET`
- `STUDYCLAW_MANAGED_MINIMAX_PROXY_BASE_URL`
- `STUDYCLAW_SERVER_MINIMAX_BASE_URL`
- `STUDYCLAW_SERVER_MINIMAX_MODELS_PATH`

See `.env.example` for a working template.

## Current Production Notes

- The Vercel frontend proxies browser API calls through same-origin `/api/*` rewrites.
- The API currently runs outside Vercel and must be reachable at `API_BASE_URL`.
- For production on this VM, the current public API origin is `https://34.58.17.31.nip.io`.
