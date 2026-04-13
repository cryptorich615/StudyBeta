#!/bin/bash
export GOOGLE_CALLBACK_URL=https://34.58.17.31.nip.io/api/auth/google/callback
export OPENCLAW_HOME=/home/martinez_a_richard/.openclaw
export OPENCLAW_CONFIG_PATH=/home/martinez_a_richard/.openclaw/openclaw.json
export OPENCLAW_BASE_URL=http://34.58.17.31:18789
export OPENCLAW_GATEWAY_TOKEN=45dd9887be6f5cdd72b93f71dec3f85fe24ccd7a1f4e2cdc
export GOOGLE_OAUTH_REDIRECT_URI=https://34.58.17.31.nip.io/api/auth/google/callback
export API_BASE_URL=https://34.58.17.31.nip.io
export CLIENT_URL=https://studyclaw.vercel.app
export FRONTEND_URL=https://studyclaw.vercel.app
export CORS_ORIGIN=https://studyclaw.vercel.app,https://*.vercel.app,http://localhost:3000,https://34.58.17.31.nip.io
cd /home/martinez_a_richard/StudyBeta/studyclaw
exec node_modules/.bin/tsx apps/api/src/main.ts
