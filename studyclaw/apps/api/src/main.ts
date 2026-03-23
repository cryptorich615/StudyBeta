import express from 'express';
import cors from 'cors';
import { json } from 'body-parser';
import { resolve } from 'node:path';
import { healthRouter } from './modules/health/health.route';
import { authRouter } from './modules/auth/auth.route';
import { onboardingRouter } from './modules/onboarding/onboarding.route';
import { agentRouter } from './modules/agents/agents.route';
import { chatRouter } from './modules/chat/chat.route';
import { studyToolsRouter } from './modules/study-tools/study-tools.route';
import { remindersRouter } from './modules/reminders/reminders.route';
import { openclawRouter } from './modules/openclaw/openclaw.route';
import { dashboardRouter } from './modules/dashboard/dashboard.route';
import { coachRouter } from './modules/coach/coach.route';
import { adminRouter } from './modules/admin/admin.route';
import { userRouter } from './modules/user/user.route';
import { ensurePlatformSchema } from './lib/platform-schema';

process.loadEnvFile?.(resolve(process.cwd(), '../../.env'));

const app = express();
const port = Number(process.env.PORT ?? 4000);
const allowedOrigins = (process.env.CORS_ORIGIN ?? '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  })
);
app.use(json({ limit: '10mb' }));
app.use('/api/health', healthRouter); app.use('/api/auth', authRouter); app.use('/api/onboarding', onboardingRouter); app.use('/api/agent', agentRouter); app.use('/api/chat', chatRouter); app.use('/api/study', studyToolsRouter); app.use('/api/reminders', remindersRouter); app.use('/api/openclaw', openclawRouter); app.use('/api/dashboard', dashboardRouter); app.use('/api/coach', coachRouter); app.use('/api/admin', adminRouter); app.use('/api/user', userRouter);

async function start() {
  await ensurePlatformSchema();
  app.listen(port, () => console.log(`StudyClaw API listening on http://localhost:${port}`));
}

void start();
