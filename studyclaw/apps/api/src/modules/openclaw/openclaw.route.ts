import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { db } from '../../lib/db';
import {
  approveUserTelegramPairing,
  createOpenClawCronJob,
  getUserTelegramSettings,
  deleteOpenClawCronJob,
  getOpenClawSettingsSnapshot,
  updateOpenClawSkillToggle,
} from '../../lib/openclaw-control';
import {
  activateUserModelSetting,
  getUserModelSettings,
  saveUserModelSetting,
} from '../../lib/model-settings';

export const openclawRouter = Router();

openclawRouter.use(requireAuth);

async function loadUserAgentPreset(userId: string) {
  const profileResult = await db.query(
    `select preset_key from agent_profiles where user_id = $1 limit 1`,
    [userId]
  );
  const presetKey = String(profileResult.rows[0]?.preset_key ?? '').trim();

  if (presetKey) {
    return presetKey;
  }

  const agentResult = await db.query(
    `select agent_type from agents where user_id = $1 limit 1`,
    [userId]
  );
  return String(agentResult.rows[0]?.agent_type ?? '').trim() || null;
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
    const payload = await getUserModelSettings(req.user!.id);
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: 'model_settings_failed',
      message: error instanceof Error ? error.message : 'Failed to load model settings',
    });
  }
});

openclawRouter.get('/telegram', async (req: AuthedRequest, res) => {
  try {
    const agentPreset = await loadUserAgentPreset(req.user!.id);
    const payload = await getUserTelegramSettings({
      userId: req.user!.id,
      agentPreset,
    });
    res.json(payload);
  } catch (error) {
    res.status(500).json({
      error: 'telegram_settings_failed',
      message: error instanceof Error ? error.message : 'Failed to load Telegram settings',
    });
  }
});

openclawRouter.post('/telegram/approve', async (req: AuthedRequest, res) => {
  const code = String(req.body?.code ?? '').trim();

  if (!code) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'Pairing code is required',
    });
  }

  try {
    const agentPreset = await loadUserAgentPreset(req.user!.id);
    const payload = await approveUserTelegramPairing({
      userId: req.user!.id,
      agentPreset,
      code,
    });
    res.json(payload);
  } catch (error) {
    res.status(400).json({
      error: 'telegram_pairing_failed',
      message: error instanceof Error ? error.message : 'Failed to approve Telegram pairing',
    });
  }
});

openclawRouter.post('/model-settings', async (req: AuthedRequest, res) => {
  const {
    configId,
    providerName,
    serviceBaseUrl,
    apiKey,
    modelName,
    maxContextWindow,
    maxOutputTokens,
    activate,
  } = req.body as {
    configId?: string;
    providerName?: string;
    serviceBaseUrl?: string;
    apiKey?: string;
    modelName?: string;
    maxContextWindow?: number | string | null;
    maxOutputTokens?: number | string | null;
    activate?: boolean;
  };

  if (!providerName?.trim() || !serviceBaseUrl?.trim() || !modelName?.trim()) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'providerName, serviceBaseUrl, and modelName are required',
    });
  }

  try {
    const payload = await saveUserModelSetting({
      userId: req.user!.id,
      email: req.user!.email ?? `${req.user!.id}@local.invalid`,
      configId: configId?.trim() || undefined,
      providerName,
      serviceBaseUrl,
      apiKey,
      modelName,
      maxContextWindow,
      maxOutputTokens,
      activate: !!activate,
    });
    res.json(payload);
  } catch (error) {
    res.status(400).json({
      error: 'model_settings_save_failed',
      message: error instanceof Error ? error.message : 'Failed to save model settings',
    });
  }
});

openclawRouter.post('/model-settings/:configId/activate', async (req: AuthedRequest, res) => {
  const configId = String(req.params.configId || '').trim();

  if (!configId) {
    return res.status(400).json({ error: 'bad_request', message: 'configId is required' });
  }

  try {
    const payload = await activateUserModelSetting({
      userId: req.user!.id,
      email: req.user!.email ?? `${req.user!.id}@local.invalid`,
      configId,
    });
    res.json(payload);
  } catch (error) {
    res.status(400).json({
      error: 'model_settings_activate_failed',
      message: error instanceof Error ? error.message : 'Failed to activate model settings',
    });
  }
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

openclawRouter.post('/cron', async (req: AuthedRequest, res) => {
  const { name, message, scheduleKind, scheduleValue, timezone } = req.body as {
    name?: string;
    message?: string;
    scheduleKind?: 'at' | 'cron' | 'every';
    scheduleValue?: string;
    timezone?: string;
  };

  if (!name?.trim() || !message?.trim() || !scheduleKind || !scheduleValue?.trim()) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'name, message, scheduleKind, and scheduleValue are required',
    });
  }

  if (!['at', 'cron', 'every'].includes(scheduleKind)) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'scheduleKind must be one of: at, cron, every',
    });
  }

  try {
    const snapshot = await createOpenClawCronJob({
      userId: req.user!.id,
      name: name.trim(),
      message: message.trim(),
      scheduleKind,
      scheduleValue: scheduleValue.trim(),
      timezone: timezone?.trim(),
    });
    res.status(201).json(snapshot);
  } catch (error) {
    res.status(400).json({
      error: 'openclaw_cron_create_failed',
      message: error instanceof Error ? error.message : 'Failed to create cron job',
    });
  }
});

openclawRouter.delete('/cron/:jobId', async (req: AuthedRequest, res) => {
  const jobId = String(req.params.jobId || '').trim();
  if (!jobId) {
    return res.status(400).json({ error: 'bad_request', message: 'jobId is required' });
  }

  try {
    const snapshot = await deleteOpenClawCronJob({
      userId: req.user!.id,
      jobId,
    });
    res.json(snapshot);
  } catch (error) {
    res.status(400).json({
      error: 'openclaw_cron_delete_failed',
      message: error instanceof Error ? error.message : 'Failed to delete cron job',
    });
  }
});
