import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { getOpenClawSettingsSnapshot, updateOpenClawSkillToggle } from '../../lib/openclaw-control';
import { activateUserModelSetting, getUserModelSettings, saveUserModelSetting } from '../../lib/model-settings';

export const openclawRouter = Router();

openclawRouter.use(requireAuth);

const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? '/home/ubuntu/.openclaw';
const CRON_JOBS_PATH = join(OPENCLAW_HOME, 'cron', 'jobs.json');

type CronJobRecord = {
  id: string;
  jobId: string;
  name: string;
  message: string;
  schedule: {
    kind: 'at' | 'cron' | 'every';
    at?: string;
    expr?: string;
    everyMs?: number;
    timezone?: string;
  };
  createdAt: string;
};

async function readCronJobs(): Promise<CronJobRecord[]> {
  try {
    const raw = await readFile(CRON_JOBS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as { jobs?: CronJobRecord[] };
    return Array.isArray(parsed.jobs) ? parsed.jobs : [];
  } catch {
    return [];
  }
}

async function writeCronJobs(jobs: CronJobRecord[]) {
  await writeFile(CRON_JOBS_PATH, JSON.stringify({ jobs }, null, 2), 'utf8');
}

function parseEveryDuration(value: string) {
  const match = value.trim().match(/^(\d+)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    return null;
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers: Record<string, number> = {
    ms: 1,
    s: 1000,
    m: 60_000,
    h: 3_600_000,
    d: 86_400_000,
  };

  return amount * multipliers[unit];
}

openclawRouter.get('/settings', async (req: AuthedRequest, res) => {
  try {
    const snapshot = await getOpenClawSettingsSnapshot(req.user!.id);
    res.json(snapshot);
  } catch (error) {
    res.status(500).json({
      error: 'openclaw_settings_failed',
      message: error instanceof Error ? error.message : 'Failed to load OpenClaw settings',
    });
  }
});

openclawRouter.get('/model-settings', async (req: AuthedRequest, res) => {
  try {
    res.json(await getUserModelSettings(req.user!.id));
  } catch (error) {
    res.status(500).json({
      error: 'openclaw_model_settings_failed',
      message: error instanceof Error ? error.message : 'Failed to load model settings',
    });
  }
});

openclawRouter.post('/model-settings', async (req: AuthedRequest, res) => {
  try {
    const snapshot = await saveUserModelSetting({
      userId: req.user!.id,
      email: req.user!.email ?? `${req.user!.id}@local.invalid`,
      configId: typeof req.body?.configId === 'string' ? req.body.configId : undefined,
      providerName: String(req.body?.providerName ?? ''),
      serviceBaseUrl: String(req.body?.serviceBaseUrl ?? ''),
      apiKey: typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined,
      modelName: String(req.body?.modelName ?? ''),
      maxContextWindow: req.body?.maxContextWindow,
      maxOutputTokens: req.body?.maxOutputTokens,
      activate: !!req.body?.activate,
    });
    res.json(snapshot);
  } catch (error) {
    res.status(400).json({
      error: 'openclaw_model_settings_save_failed',
      message: error instanceof Error ? error.message : 'Failed to save model settings',
    });
  }
});

openclawRouter.post('/model-settings/:configId/activate', async (req: AuthedRequest, res) => {
  try {
    const snapshot = await activateUserModelSetting({
      userId: req.user!.id,
      email: req.user!.email ?? `${req.user!.id}@local.invalid`,
      configId: String(req.params.configId ?? ''),
    });
    res.json(snapshot);
  } catch (error) {
    res.status(400).json({
      error: 'openclaw_model_settings_activate_failed',
      message: error instanceof Error ? error.message : 'Failed to activate saved model',
    });
  }
});

openclawRouter.post('/cron', async (req: AuthedRequest, res) => {
  const name = String(req.body?.name ?? '').trim();
  const message = String(req.body?.message ?? '').trim();
  const scheduleKind = String(req.body?.scheduleKind ?? '').trim() as 'at' | 'cron' | 'every';
  const scheduleValue = String(req.body?.scheduleValue ?? '').trim();
  const timezone = String(req.body?.timezone ?? '').trim();

  if (!name || !message || !['at', 'cron', 'every'].includes(scheduleKind) || !scheduleValue) {
    return res.status(400).json({ error: 'bad_request', message: 'name, message, scheduleKind, and scheduleValue are required' });
  }

  const jobs = await readCronJobs();
  const jobId = randomUUID();
  const schedule: CronJobRecord['schedule'] =
    scheduleKind === 'at'
      ? { kind: 'at', at: scheduleValue }
      : scheduleKind === 'cron'
        ? { kind: 'cron', expr: scheduleValue, timezone: timezone || 'UTC' }
        : { kind: 'every', everyMs: parseEveryDuration(scheduleValue) ?? undefined };

  if (scheduleKind === 'every' && !schedule.everyMs) {
    return res.status(400).json({ error: 'bad_request', message: 'Repeat every must use a duration like 15m, 1h, or 1d' });
  }

  jobs.unshift({
    id: jobId,
    jobId,
    name,
    message,
    schedule,
    createdAt: new Date().toISOString(),
  });

  await writeCronJobs(jobs);
  res.json(await getOpenClawSettingsSnapshot(req.user!.id));
});

openclawRouter.delete('/cron/:jobId', async (req: AuthedRequest, res) => {
  const jobId = String(req.params.jobId ?? '').trim();
  const jobs = await readCronJobs();
  const nextJobs = jobs.filter((job) => job.jobId !== jobId && job.id !== jobId);

  if (nextJobs.length === jobs.length) {
    return res.status(404).json({ error: 'not_found', message: 'Cron job not found' });
  }

  await writeCronJobs(nextJobs);
  res.json(await getOpenClawSettingsSnapshot(req.user!.id));
});

openclawRouter.get('/telegram', async (req: AuthedRequest, res) => {
  try {
    const snapshot = await getOpenClawSettingsSnapshot(req.user!.id);
    const telegram = snapshot.channels.find((channel) => channel.id === 'telegram');

    res.json({
      available: true,
      message: telegram?.capabilities?.probe || 'Telegram status unavailable',
      botUsername: telegram?.settings.find((entry) => entry.key.toLowerCase().includes('username'))?.value ?? undefined,
      channelEnabled: !!telegram?.enabled,
      accountConfigured: !!telegram?.authConfigured,
      paired: !!telegram?.enabled && !!telegram?.authConfigured,
      dmPolicy: telegram?.capabilities?.actions?.join(', ') || undefined,
    });
  } catch (error) {
    res.status(500).json({
      error: 'openclaw_telegram_failed',
      message: error instanceof Error ? error.message : 'Failed to load Telegram settings',
    });
  }
});

openclawRouter.post('/telegram/approve', async (req: AuthedRequest, res) => {
  const code = String(req.body?.code ?? '').trim();
  if (!code) {
    return res.status(400).json({ error: 'bad_request', message: 'Telegram pairing code is required' });
  }

  const snapshot = await getOpenClawSettingsSnapshot(req.user!.id);
  const telegram = snapshot.channels.find((channel) => channel.id === 'telegram');
  if (!telegram?.authConfigured) {
    return res.status(400).json({
      error: 'telegram_not_configured',
      message: 'Telegram is not configured on this OpenClaw instance yet.',
    });
  }

  res.json({
    available: true,
    message: 'Telegram pairing approval is not fully automated yet on this StudyClaw instance.',
    botUsername: telegram.settings.find((entry) => entry.key.toLowerCase().includes('username'))?.value ?? undefined,
    channelEnabled: !!telegram.enabled,
    accountConfigured: !!telegram.authConfigured,
    paired: false,
    dmPolicy: telegram.capabilities?.actions?.join(', ') || undefined,
  });
});

openclawRouter.patch('/skills/:skillName', async (req: AuthedRequest, res) => {
  const skillName = String(req.params.skillName || '').trim();
  const enabled = req.body?.enabled;

  if (!skillName) {
    return res.status(400).json({ error: 'bad_request', message: 'skillName is required' });
  }

  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ error: 'bad_request', message: 'enabled must be a boolean' });
  }

  try {
    const snapshot = await updateOpenClawSkillToggle({
      userId: req.user!.id,
      skillName,
      enabled,
    });
    res.json(snapshot);
  } catch (error) {
    res.status(400).json({
      error: 'openclaw_skill_update_failed',
      message: error instanceof Error ? error.message : 'Failed to update skill',
    });
  }
});
