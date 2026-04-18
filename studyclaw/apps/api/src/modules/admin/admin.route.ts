import { Router } from 'express';
import { requireAdmin, type AuthedRequest } from '../../lib/auth';
import { db } from '../../lib/db';
import { ensureAdminAgent } from '../../lib/user-agent';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import {
  adjustManagedUsageCredits,
  changeManagedUsageTier,
  getContentOpsSnapshot,
  getAdminUserDetail,
  getProviderOpsSnapshot,
  listAdminAuditEvents,
  listAdminUsers,
} from '../../lib/admin-ops';
import { listManagedUsageAccounts, listManagedUsageEventsForUser } from '../../lib/managed-usage';

export const adminRouter = Router();

function isMissingRelationError(error: unknown) {
  return error instanceof Error && /relation .* does not exist/i.test(error.message);
}

async function listBasicUsers(limit = 50) {
  const result = await db.query(
    `select
       u.id,
       u.email,
       u.full_name,
       u.role,
       u.created_at,
       sp.onboarding_complete,
       sp.tier,
       sp.updated_at as last_active_at
     from users u
     left join student_profiles sp on sp.user_id = u.id
     order by u.created_at desc
     limit $1`,
    [limit]
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.full_name ? String(row.full_name) : null,
    email: String(row.email),
    role: String(row.role ?? 'student'),
    tier: row.tier ? `tier_${row.tier}` : null,
    billingMode: 'unknown',
    creditsTotal: 0,
    creditsRemaining: 0,
    usageInWindow: 0,
    providerSelection: null,
    modelSelection: null,
    onboardingComplete: !!row.onboarding_complete,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at ?? row.created_at,
  }));
}

async function getBasicUserDetail(userId: string) {
  const result = await db.query(
    `select
       u.id,
       u.email,
       u.full_name,
       u.role,
       u.created_at,
       u.updated_at,
       coalesce(sp.onboarding_complete, false) as onboarding_complete,
       sp.school_name,
       sp.school_level,
       sp.grade_year,
       sp.major,
       sp.tier,
       sp.updated_at as last_active_at
     from users u
     left join student_profiles sp on sp.user_id = u.id
     where u.id = $1
     limit 1`,
    [userId]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    user: {
      id: String(row.id),
      email: String(row.email),
      fullName: row.full_name ? String(row.full_name) : null,
      role: String(row.role ?? 'student'),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      onboardingComplete: !!row.onboarding_complete,
      schoolName: row.school_name ? String(row.school_name) : null,
      schoolLevel: row.school_level ? String(row.school_level) : null,
      gradeYear: row.grade_year ? String(row.grade_year) : null,
      major: row.major ? String(row.major) : null,
    },
    usage: {
      tier: row.tier ? `tier_${row.tier}` : null,
      billingMode: 'unknown',
      creditsTotal: 0,
      creditsRemaining: 0,
      usedInWindow: 0,
      providerSelection: null,
      modelSelection: null,
      latestWindowEventAt: row.last_active_at ?? row.updated_at ?? row.created_at,
    },
    usageEvents: [],
    counts: {
      studyAssets: 0,
      flashcardSets: 0,
      quizzes: 0,
      conversations: 0,
      reminders: 0,
    },
    auditEvents: [],
  };
}

adminRouter.use(requireAdmin);

adminRouter.get('/users', async (_req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  let users;
  try {
    users = await listAdminUsers({});
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    users = await listBasicUsers(50);
  }

  res.json({
    users: users.slice(0, 50).map((user) => ({
      id: user.id,
      email: user.email,
      full_name: user.name,
      created_at: user.createdAt,
      ...user,
    })),
  });
});

adminRouter.get('/providers', async (req: AuthedRequest, res) => {
  let snapshot;
  try {
    snapshot = await getProviderOpsSnapshot(req.user!.id);
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    snapshot = null;
  }
  res.json({
    providers: snapshot?.providerConfigs ?? [],
    providerSummary: snapshot,
  });
});

adminRouter.get('/system', async (_req: AuthedRequest, res) => {
  res.json({
    memory: process.memoryUsage(),
    uptime: process.uptime(),
    env: {
      nodeVersion: process.version,
    },
  });
});

adminRouter.get('/audit', async (req: AuthedRequest, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit ?? 100) || 100, 1), 500);
  const entries = await listAdminAuditEvents(limit);
  res.json({ entries, limit });
});

adminRouter.get('/content', async (_req: AuthedRequest, res) => {
  const content = await getContentOpsSnapshot();
  res.json(content);
});

adminRouter.get('/managed-usage', async (_req: AuthedRequest, res) => {
  let accounts = [];
  try {
    accounts = await listManagedUsageAccounts();
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
  }
  res.json({ usage: accounts, accounts });
});

adminRouter.get('/managed-usage/:userId', async (req: AuthedRequest, res) => {
  let events = [];
  try {
    events = await listManagedUsageEventsForUser(req.params.userId, 100);
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
  }
  res.json({ userId: req.params.userId, events });
});

adminRouter.patch('/managed-usage/:userId/tier', async (req: AuthedRequest, res) => {
  const tier = String(req.body?.tier ?? '').trim() as 'tier_1' | 'tier_2' | 'tier_3';
  if (!['tier_1', 'tier_2', 'tier_3'].includes(tier)) {
    return res.status(400).json({ error: 'bad_request', message: 'tier must be tier_1, tier_2, or tier_3' });
  }

  let snapshot = null;
  try {
    snapshot = await changeManagedUsageTier({
      actorUserId: req.user!.id,
      targetUserId: req.params.userId,
      tier,
      resetCredits: !!req.body?.resetCredits,
    });
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
  }
  res.json({ ok: true, userId: req.params.userId, tier, snapshot });
});

adminRouter.get('/users/:userId', async (req: AuthedRequest, res) => {
  let detail;
  try {
    detail = await getAdminUserDetail(req.params.userId);
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    detail = await getBasicUserDetail(req.params.userId);
  }

  if (!detail) {
    return res.status(404).json({ error: 'not_found', message: 'User not found' });
  }

  res.json({
    user: {
      id: detail.user.id,
      email: detail.user.email,
      name: detail.user.fullName,
      role: detail.user.role,
      tier: detail.usage?.tier ?? null,
      billingMode: detail.usage?.billingMode ?? 'unknown',
      creditsTotal: detail.usage?.creditsTotal ?? 0,
      creditsRemaining: detail.usage?.creditsRemaining ?? 0,
      usageInWindow: detail.usage?.usedInWindow ?? 0,
      providerSelection: detail.usage?.providerSelection ?? null,
      modelSelection: detail.usage?.modelSelection ?? null,
      onboardingComplete: detail.user.onboardingComplete,
      createdAt: detail.user.createdAt,
      lastActiveAt: detail.usage?.latestWindowEventAt ?? null,
    },
    detail,
  });
});

adminRouter.patch('/users/:userId/tier', async (req: AuthedRequest, res) => {
  const tier = String(req.body?.tier ?? '').trim() as 'tier_1' | 'tier_2' | 'tier_3';
  if (!['tier_1', 'tier_2', 'tier_3'].includes(tier)) {
    return res.status(400).json({ error: 'bad_request', message: 'tier must be tier_1, tier_2, or tier_3' });
  }

  let snapshot = null;
  try {
    snapshot = await changeManagedUsageTier({
      actorUserId: req.user!.id,
      targetUserId: req.params.userId,
      tier,
      resetCredits: !!req.body?.resetCredits,
    });
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
  }
  res.json({ ok: true, userId: req.params.userId, tier, snapshot });
});

adminRouter.patch('/users/:userId/credits', async (req: AuthedRequest, res) => {
  const delta = Number(req.body?.delta ?? 0);
  if (!Number.isFinite(delta)) {
    return res.status(400).json({ error: 'bad_request', message: 'delta must be a number' });
  }

  let detail = null;
  try {
    detail = await adjustManagedUsageCredits({
      actorUserId: req.user!.id,
      targetUserId: req.params.userId,
      delta,
      reason: req.body?.reason ?? null,
    });
  } catch (error) {
    if (!isMissingRelationError(error)) {
      throw error;
    }
    detail = await getBasicUserDetail(req.params.userId);
  }
  res.json({ ok: true, userId: req.params.userId, delta, detail });
});

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
