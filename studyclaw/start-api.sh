#!/bin/bash
export GOOGLE_CALLBACK_URL=https://ciao-mercy-complex-equally.trycloudflare.com/api/auth/google/callback
export OPENCLAW_HOME=/home/martinez_a_richard/.openclaw
export OPENCLAW_CONFIG_PATH=/home/martinez_a_richard/.openclaw/openclaw.json
export GOOGLE_OAUTH_REDIRECT_URI=https://ciao-mercy-complex-equally.trycloudflare.com/api/auth/google/callback
export API_BASE_URL=https://ciao-mercy-complex-equally.trycloudflare.com
export CLIENT_URL=https://study-beta-vercel-test.vercel.app
export CORS_ORIGIN=https://study-beta-vercel-test.vercel.app,https://studyclaw.vercel.app,http://localhost:3000,https://ciao-mercy-complex-equally.trycloudflare.com
cd /home/martinez_a_richard/StudyBeta/studyclaw
exec node_modules/.bin/tsx apps/api/src/main.ts
