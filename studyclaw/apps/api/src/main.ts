import express from 'express';
import cors from 'cors';
import { json } from 'body-parser';
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
import { gradesRouter } from './modules/grades/grades.route';
import { scheduleRouter } from './modules/schedule/schedule.route';
import { googleRouter } from './modules/google/google.route.js';
import { studyRouter } from './modules/study/study.route';
import { examRouter } from './modules/exam/exam.route';
import { gmailRouter } from './modules/gmail/gmail.route';
import { browserRouter } from './modules/browser/browser.route';
import { minimaxProxyRouter } from './modules/provider-proxy/minimax.route';
import { ensurePlatformSchema } from './lib/platform-schema';
import { startReminderWorker } from './jobs/reminderWorker';
import { loadRepoEnv } from './lib/load-env';

loadRepoEnv();

const app = express();
const port = Number(process.env.PORT ?? 4000);
const allowedOrigins = (process.env.CORS_ORIGIN ?? '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

function parseOrigin(origin: string) {
  try {
    return new URL(origin);
  } catch {
    return null;
  }
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function isAllowedOrigin(origin: string) {
  if (allowedOrigins.includes('*') || allowedOrigins.includes(origin)) {
    return true;
  }

  const requested = parseOrigin(origin);
  if (!requested) {
    return false;
  }

  return allowedOrigins.some((allowedOrigin) => {
    const allowed = parseOrigin(allowedOrigin);
    if (!allowed) {
      return false;
    }

    return (
      allowed.protocol === requested.protocol
      && allowed.port === requested.port
      && isLoopbackHost(allowed.hostname)
      && isLoopbackHost(requested.hostname)
    );
  });
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || isAllowedOrigin(origin)) {
        return callback(null, true);
      }

      return callback(new Error(`Origin ${origin} is not allowed by CORS`));
    },
  })
);
app.use(json({ limit: '10mb' }));
app.use('/api/provider-proxy/minimax', minimaxProxyRouter);
app.use('/api/health', healthRouter); app.use('/api/auth', authRouter); app.use('/api/onboarding', onboardingRouter); app.use('/api/agent', agentRouter); app.use('/api/chat', chatRouter); app.use('/api/study', studyToolsRouter); app.use('/api/reminders', remindersRouter); app.use('/api/openclaw', openclawRouter); app.use('/api/dashboard', dashboardRouter); app.use('/api/coach', coachRouter); app.use('/api/admin', adminRouter); app.use('/api/user', userRouter); app.use('/api/grades', gradesRouter); app.use('/api/schedule', scheduleRouter);
app.use('/api/browser', browserRouter); app.use('/api/google', googleRouter); app.use('/api/gmail', gmailRouter); app.use('/api/learn', studyRouter); app.use('/api/exam', examRouter);

async function start() {
  await ensurePlatformSchema();
  startReminderWorker();
  app.listen(port, () => console.log(`StudyClaw API listening on http://localhost:${port}`));
}

void start();
