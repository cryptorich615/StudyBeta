import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { getOpenClawSettingsSnapshot, updateOpenClawSkillToggle } from '../../lib/openclaw-control';

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
