import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { db } from '../../lib/db';
import { getOpenClawSettingsSnapshot, updateOpenClawSkillToggle } from '../../lib/openclaw-control';
import { activateUserModelSetting, getUserModelSettings, saveUserModelSetting } from '../../lib/model-settings';
import { buildUserAgentId } from '../../lib/user-agent';

export const openclawRouter = Router();

openclawRouter.use(requireAuth);

const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? join(process.env.HOME ?? '/tmp', '.openclaw');
const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH ?? join(OPENCLAW_HOME, 'openclaw.json');
const CRON_JOBS_PATH = join(OPENCLAW_HOME, 'cron', 'jobs.json');

type OpenClawConfigFile = {
  version?: number;
  channels?: {
    telegram?: {
      enabled?: boolean;
      defaultAccount?: string;
      accounts?: Record<
        string,
        {
          dmPolicy?: string;
          groupPolicy?: string;
          botToken?: string;
        }
      >;
    };
  };
  bindings?: Array<{
    agentId?: string;
    match?: {
      channel?: string;
      accountId?: string;
      peer?: {
        kind?: string;
        id?: string;
      };
    };
  }>;
};

type CronJobRecord = {
  id: string;
  agentId?: string;
  name: string;
  enabled?: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  schedule: {
    kind: 'at' | 'cron' | 'every';
    at?: string;
    expr?: string;
    everyMs?: number;
    tz?: string;
  };
  sessionTarget?: 'current';
  wakeMode?: 'now';
  payload?: {
    kind?: 'agentTurn';
    message?: string;
  };
  state?: {
    nextRunAtMs?: number;
    lastRunAtMs?: number;
    lastRunStatus?: string;
    lastStatus?: string;
    lastDurationMs?: number;
    lastDeliveryStatus?: string;
    consecutiveErrors?: number;
    lastError?: string;
  };
};

type CronJobsFile = {
  version?: number;
  jobs?: CronJobRecord[];
};

async function readOpenClawConfig(): Promise<OpenClawConfigFile> {
  try {
    const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf8');
    return JSON.parse(raw) as OpenClawConfigFile;
  } catch {
    return {};
  }
}

async function writeOpenClawConfig(config: OpenClawConfigFile) {
  await writeFile(OPENCLAW_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function readCronFile(): Promise<CronJobsFile> {
  try {
    const raw = await readFile(CRON_JOBS_PATH, 'utf8');
    const parsed = JSON.parse(raw) as CronJobsFile;
    return {
      version: Number(parsed.version ?? 1),
      jobs: Array.isArray(parsed.jobs) ? parsed.jobs : [],
    };
  } catch {
    return { version: 1, jobs: [] };
  }
}

async function writeCronFile(file: CronJobsFile) {
  await writeFile(
    CRON_JOBS_PATH,
    `${JSON.stringify({ version: Number(file.version ?? 1), jobs: Array.isArray(file.jobs) ? file.jobs : [] }, null, 2)}\n`,
    'utf8'
  );
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

async function getTelegramProfile(userId: string) {
  const result = await db.query(
    `select persona_name
     from agent_profiles
     where user_id = $1
     limit 1`,
    [userId]
  );

  const personaName = String(result.rows[0]?.persona_name ?? '').trim();
  const normalizedPersona = personaName.toLowerCase();

  return {
    personaName: personaName || 'StudyClaw',
    personaKey:
      normalizedPersona === 'dixie' ? 'quick_start_1' : normalizedPersona === 'willow' ? 'quick_start_2' : undefined,
    accountId: normalizedPersona === 'dixie' || normalizedPersona === 'willow' ? normalizedPersona : null,
  };
}

function normalizeTelegramPeerId(value: string) {
  const unsignedMatch = value.match(/\d{5,}/);
  if (unsignedMatch) {
    return unsignedMatch[0];
  }

  const signedMatch = value.match(/-\d{5,}/);
  return signedMatch ? signedMatch[0] : null;
}

async function buildTelegramSettings(userId: string) {
  const [snapshot, config, profile] = await Promise.all([
    getOpenClawSettingsSnapshot(userId),
    readOpenClawConfig(),
    getTelegramProfile(userId),
  ]);

  const telegram = snapshot.channels.find((channel) => channel.id === 'telegram');
  const telegramConfig = config.channels?.telegram;
  const accountId = profile.accountId ?? telegramConfig?.defaultAccount ?? 'willow';
  const accountConfig = telegramConfig?.accounts?.[accountId];
  const agentId = buildUserAgentId(userId);
  const directBinding =
    (config.bindings ?? []).find(
      (binding) =>
        binding.agentId === agentId &&
        binding.match?.channel === 'telegram' &&
        binding.match?.accountId === accountId &&
        binding.match?.peer?.kind === 'direct' &&
        typeof binding.match?.peer?.id === 'string'
    ) ?? null;

  return {
    available: true,
    personaKey: profile.personaKey,
    personaName: profile.personaName,
    accountId,
    botUsername:
      telegram?.settings.find((entry) => entry.key.toLowerCase().includes('username'))?.value ??
      accountId,
    channelEnabled: !!telegramConfig?.enabled,
    accountConfigured: !!accountConfig?.botToken,
    dmPolicy: accountConfig?.dmPolicy ?? 'pairing',
    paired: !!directBinding,
    boundPeerId: directBinding?.match?.peer?.id,
    pendingApprovals: [],
    message: directBinding
      ? `Telegram is linked to direct chat ${directBinding.match?.peer?.id}.`
      : 'Paste the Telegram pairing code or numeric chat ID from your bot conversation to link this StudyClaw agent.',
  };
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

  const cronFile = await readCronFile();
  const jobs = cronFile.jobs ?? [];
  const createdAtMs = Date.now();
  const schedule: CronJobRecord['schedule'] =
    scheduleKind === 'at'
      ? { kind: 'at', at: scheduleValue }
      : scheduleKind === 'cron'
        ? { kind: 'cron', expr: scheduleValue, tz: timezone || 'UTC' }
        : { kind: 'every', everyMs: parseEveryDuration(scheduleValue) ?? undefined };

  if (scheduleKind === 'every' && !schedule.everyMs) {
    return res.status(400).json({ error: 'bad_request', message: 'Repeat every must use a duration like 15m, 1h, or 1d' });
  }

  jobs.unshift({
    id: randomUUID(),
    agentId: buildUserAgentId(req.user!.id),
    name,
    enabled: true,
    createdAtMs,
    updatedAtMs: createdAtMs,
    schedule,
    sessionTarget: 'current',
    wakeMode: 'now',
    payload: {
      kind: 'agentTurn',
      message,
    },
    state: {},
  });

  await writeCronFile({
    version: cronFile.version ?? 1,
    jobs,
  });

  res.json(await getOpenClawSettingsSnapshot(req.user!.id));
});

openclawRouter.delete('/cron/:jobId', async (req: AuthedRequest, res) => {
  const jobId = String(req.params.jobId ?? '').trim();
  const agentId = buildUserAgentId(req.user!.id);
  const cronFile = await readCronFile();
  const jobs = cronFile.jobs ?? [];
  const nextJobs = jobs.filter((job) => !(job.id === jobId && String(job.agentId ?? '') === agentId));

  if (nextJobs.length === jobs.length) {
    return res.status(404).json({ error: 'not_found', message: 'Cron job not found' });
  }

  await writeCronFile({
    version: cronFile.version ?? 1,
    jobs: nextJobs,
  });

  res.json(await getOpenClawSettingsSnapshot(req.user!.id));
});

openclawRouter.get('/telegram', async (req: AuthedRequest, res) => {
  try {
    res.json(await buildTelegramSettings(req.user!.id));
  } catch (error) {
    res.status(500).json({
      error: 'openclaw_telegram_failed',
      message: error instanceof Error ? error.message : 'Failed to load Telegram settings',
    });
  }
});

openclawRouter.post('/telegram/approve', async (req: AuthedRequest, res) => {
  const code = String(req.body?.code ?? req.body?.pairingCode ?? '').trim();
  if (!code) {
    return res.status(400).json({ error: 'bad_request', message: 'Telegram pairing code is required' });
  }

  const current = await buildTelegramSettings(req.user!.id);
  if (!current.accountConfigured) {
    return res.status(400).json({
      error: 'telegram_not_configured',
      message: 'Telegram is not configured on this OpenClaw instance yet.',
    });
  }

  const peerId = normalizeTelegramPeerId(code);
  if (!peerId) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Paste the numeric Telegram chat ID or a pairing code that contains it.',
    });
  }

  const config = await readOpenClawConfig();
  const agentId = buildUserAgentId(req.user!.id);
  const nextBindings = (config.bindings ?? []).filter(
    (binding) => !(binding.agentId === agentId && binding.match?.channel === 'telegram')
  );

  nextBindings.push({
    agentId,
    match: {
      channel: 'telegram',
      accountId: current.accountId,
      peer: {
        kind: 'direct',
        id: peerId,
      },
    },
  });

  config.bindings = nextBindings;
  await writeOpenClawConfig(config);

  const next = await buildTelegramSettings(req.user!.id);
  res.json({
    ...next,
    message: `Telegram is now linked to direct chat ${peerId}.`,
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
