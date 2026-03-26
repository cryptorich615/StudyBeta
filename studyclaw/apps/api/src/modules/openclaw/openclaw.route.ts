import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import {
  createOpenClawCronJob,
  deleteOpenClawCronJob,
  getOpenClawSettingsSnapshot,
  updateOpenClawSkillToggle,
} from '../../lib/openclaw-control';

export const openclawRouter = Router();

openclawRouter.use(requireAuth);

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
