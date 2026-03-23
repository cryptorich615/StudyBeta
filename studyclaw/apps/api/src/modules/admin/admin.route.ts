import { Router } from 'express';
import { requireAdmin, type AuthedRequest } from '../../lib/auth';
import { db } from '../../lib/db';
import { ensureAdminAgent } from '../../lib/user-agent';
import { ensurePlatformSchema } from '../../lib/platform-schema';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

adminRouter.get('/overview', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();

  const [adminAgentResult, studentCountResult, activityResult] = await Promise.all([
    db.query(`select * from admin_agents where owner_user_id = $1`, [req.user!.id]),
    db.query(`select count(*)::int as count from agents`),
    db.query(
      `select a.action_type, a.summary, a.created_at
       from agent_actions a
       order by a.created_at desc
       limit 20`
    ),
  ]);

  res.json({
    adminAgent: adminAgentResult.rows[0] ?? null,
    studentAgentCount: studentCountResult.rows[0]?.count ?? 0,
    recentActions: activityResult.rows,
  });
});

adminRouter.post('/bootstrap', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const adminAgent = await ensureAdminAgent({
    ownerUserId: req.user!.id,
    email: req.user!.email ?? `${req.user!.id}@local.invalid`,
  });

  await db.query(
    `insert into admin_agents (owner_user_id, openclaw_agent_id, config)
     values ($1, $2, $3)
     on conflict (owner_user_id) do update set
       openclaw_agent_id = excluded.openclaw_agent_id,
       config = excluded.config,
       updated_at = now()`,
    [
      req.user!.id,
      adminAgent.openclawAgentId,
      JSON.stringify({
        permissions: ['manage_templates', 'manage_rules', 'debug_agents'],
      }),
    ]
  );

  res.json({ ok: true, adminAgent });
});

adminRouter.post('/agents/:agentId/reset', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const { reason } = req.body as { reason?: string };

  const result = await db.query(
    `update agents
     set status = 'reset_pending', updated_at = now()
     where id = $1
     returning *`,
    [req.params.agentId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'Agent not found.' });
  }

  await db.query(
    `insert into agent_actions (agent_id, action_type, summary, payload)
     values ($1, $2, $3, $4)`,
    [
      req.params.agentId,
      'soft_reset',
      'Admin requested a StudyClaw soft reset.',
      JSON.stringify({ reason: reason ?? null, requestedBy: req.user!.id }),
    ]
  );

  return res.json({ ok: true, agent: result.rows[0] });
});
