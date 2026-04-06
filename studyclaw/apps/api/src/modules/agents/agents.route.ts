import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { buildLockedSystemPrompt, mergeAgentConfig, resolveAgentPresetFromPersonaName } from '../../lib/agent-config';
import { syncUserWorkspaceIdentity } from '../../lib/user-agent';

export const agentRouter = Router();
agentRouter.use(requireAuth);

agentRouter.get('/me', async (req: AuthedRequest, res) => {
  const result = await db.query(`select * from agent_profiles where user_id = $1`, [req.user!.id]);
  res.json(result.rows[0] ?? null);
});

agentRouter.patch('/me', async (req: AuthedRequest, res) => {
  const current = await db.query(`select * from agent_profiles where user_id = $1`, [req.user!.id]);
  const profile = current.rows[0] as
    | {
        persona_name: string;
        tone: string;
        verbosity: string;
        teaching_style: string;
        reminder_style: string;
        preset_key?: string | null;
        custom_instructions?: string | null;
      }
    | undefined;

  if (!profile) {
    return res.status(404).json({ error: 'not_found', message: 'Agent profile not found' });
  }

  const next = {
    personaName: req.body.personaName ?? profile.persona_name,
    tone: req.body.tone ?? profile.tone,
    verbosity: req.body.verbosity ?? profile.verbosity,
    teachingStyle: req.body.teachingStyle ?? profile.teaching_style,
    reminderStyle: req.body.reminderStyle ?? profile.reminder_style,
    customInstructions: req.body.customInstructions ?? profile.custom_instructions ?? null,
  };

  const merged = mergeAgentConfig(resolveAgentPresetFromPersonaName(next.personaName), next);
  const systemPrompt = buildLockedSystemPrompt(merged);

  const result = await db.query(
    `update agent_profiles
     set persona_name = $2,
         tone = $3,
         verbosity = $4,
         teaching_style = $5,
         reminder_style = $6,
         custom_instructions = $7,
         system_prompt = $8,
         preset_key = $9
     where user_id = $1
     returning *`,
    [
      req.user!.id,
      next.personaName,
      next.tone,
      next.verbosity,
      next.teachingStyle,
      next.reminderStyle,
      next.customInstructions,
      systemPrompt,
      resolveAgentPresetFromPersonaName(next.personaName),
    ]
  );

  await syncUserWorkspaceIdentity({
    userId: req.user!.id,
    email: req.user!.email ?? `${req.user!.id}@local.invalid`,
    personaName: next.personaName,
    tone: next.tone,
  }).catch(() => undefined);

  res.json(result.rows[0]);
});
