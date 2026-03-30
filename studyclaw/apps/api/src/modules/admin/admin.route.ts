import { Router } from 'express';
import { requireAdmin, type AuthedRequest } from '../../lib/auth';
import { db } from '../../lib/db';
import { ensureAdminAgent } from '../../lib/user-agent';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import {
  adjustManagedUsageCredits,
  changeManagedUsageTier,
  getAdminOverviewSnapshot,
  getAdminUserDetail,
  getContentOpsSnapshot,
  getProviderOpsSnapshot,
  getSystemOpsSnapshot,
  listAdminAuditEvents,
  listAdminUsers,
  logAdminAuditEvent,
} from '../../lib/admin-ops';
import { listManagedUsageAccounts, listManagedUsageEventsForUser } from '../../lib/managed-usage';

export const adminRouter = Router();

adminRouter.use(requireAdmin);

function readParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? '';
}

adminRouter.get('/overview', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const snapshot = await getAdminOverviewSnapshot(req.user!.id);
  res.json(snapshot);
});

adminRouter.get('/users', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const users = await listAdminUsers({
    query: typeof req.query.q === 'string' ? req.query.q : null,
    role: typeof req.query.role === 'string' ? req.query.role : null,
    tier: typeof req.query.tier === 'string' ? req.query.tier : null,
    billingMode: typeof req.query.billingMode === 'string' ? req.query.billingMode : null,
    providerSelection: typeof req.query.providerSelection === 'string' ? req.query.providerSelection : null,
    modelSelection: typeof req.query.modelSelection === 'string' ? req.query.modelSelection : null,
    onboarding: typeof req.query.onboarding === 'string' ? req.query.onboarding : null,
    createdFrom: typeof req.query.createdFrom === 'string' ? req.query.createdFrom : null,
    createdTo: typeof req.query.createdTo === 'string' ? req.query.createdTo : null,
  });
  res.json({ users });
});

adminRouter.get('/users/:userId', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const userId = readParam(req.params.userId);
  const detail = await getAdminUserDetail(userId);
  if (!detail) {
    return res.status(404).json({ error: 'not_found', message: 'User not found.' });
  }

  return res.json(detail);
});

adminRouter.patch('/users/:userId/tier', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const userId = readParam(req.params.userId);
  const tier = String(req.body?.tier ?? '').trim();
  if (!['tier_1', 'tier_2', 'tier_3'].includes(tier)) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'tier must be one of tier_1, tier_2, or tier_3',
    });
  }

  const snapshot = await changeManagedUsageTier({
    actorUserId: req.user!.id,
    targetUserId: userId,
    tier: tier as 'tier_1' | 'tier_2' | 'tier_3',
    resetCredits: Boolean(req.body?.resetCredits),
  });
  return res.json({ snapshot });
});

adminRouter.patch('/users/:userId/credits', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const userId = readParam(req.params.userId);
  const delta = Number(req.body?.delta ?? NaN);
  if (!Number.isFinite(delta) || delta === 0) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'delta must be a non-zero number',
    });
  }

  const detail = await adjustManagedUsageCredits({
    actorUserId: req.user!.id,
    targetUserId: userId,
    delta: Math.trunc(delta),
    reason: typeof req.body?.reason === 'string' ? req.body.reason : null,
  });
  return res.json({ detail });
});

adminRouter.get('/managed-usage', async (_req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const accounts = await listManagedUsageAccounts();
  res.json({ accounts });
});

adminRouter.get('/managed-usage/:userId', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const userId = readParam(req.params.userId);
  const detail = await getAdminUserDetail(userId);
  if (!detail) {
    return res.status(404).json({ error: 'not_found', message: 'Managed usage account not found.' });
  }

  const events = await listManagedUsageEventsForUser(userId, 40);
  return res.json({ account: detail.usage, events });
});

adminRouter.get('/providers', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const snapshot = await getProviderOpsSnapshot(req.user!.id);
  res.json(snapshot);
});

adminRouter.get('/content', async (_req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const snapshot = await getContentOpsSnapshot();
  res.json(snapshot);
});

adminRouter.get('/audit', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 200);
  const events = await listAdminAuditEvents(limit);
  res.json({ events });
});

adminRouter.get('/system', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const snapshot = await getSystemOpsSnapshot(req.user!.id);
  res.json(snapshot);
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
        role: 'master_admin',
        permissions: [
          'manage_templates',
          'manage_policy',
          'manage_rules',
          'manage_runtime',
          'debug_agents',
          'reset_agents',
          'inspect_platform',
        ],
      }),
    ]
  );

  await logAdminAuditEvent({
    actorUserId: req.user!.id,
    targetUserId: req.user!.id,
    eventType: 'admin_bootstrap',
    entityType: 'admin_agent',
    entityId: adminAgent.openclawAgentId,
    summary: 'Rebuilt the admin agent binding.',
  });

  res.json({ ok: true, adminAgent });
});

adminRouter.post('/agents/:agentId/reset', async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const { reason } = req.body as { reason?: string };
  const agentId = readParam(req.params.agentId);

  const result = await db.query(
    `update agents
     set status = 'reset_pending', updated_at = now()
     where id = $1
     returning *`,
    [agentId]
  );

  if (!result.rows[0]) {
    return res.status(404).json({ error: 'not_found', message: 'Agent not found.' });
  }

  await db.query(
    `insert into agent_actions (agent_id, action_type, summary, payload)
     values ($1, $2, $3, $4)`,
    [
      agentId,
      'soft_reset',
      'Admin requested a StudyClaw soft reset.',
      JSON.stringify({ reason: reason ?? null, requestedBy: req.user!.id }),
    ]
  );

  await logAdminAuditEvent({
    actorUserId: req.user!.id,
    eventType: 'agent_reset_requested',
    entityType: 'agent',
    entityId: agentId,
    summary: 'Queued a soft reset for an agent.',
    metadata: { reason: reason ?? null },
  });

  return res.json({ ok: true, agent: result.rows[0] });
});
