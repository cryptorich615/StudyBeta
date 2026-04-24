import { db } from './db';
import { getOpenClawSettingsSnapshot } from './openclaw-control';
import {
  listManagedUsageAccounts,
  listManagedUsageEventsForUser,
  type StudyClawUsageTier,
  updateManagedUsageTier,
} from './managed-usage';

type AuditInput = {
  actorUserId?: string | null;
  targetUserId?: string | null;
  eventType: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
  metadata?: Record<string, unknown>;
};

type UserListFilters = {
  query?: string | null;
  role?: string | null;
  tier?: string | null;
  billingMode?: string | null;
  providerSelection?: string | null;
  modelSelection?: string | null;
  onboarding?: string | null;
  createdFrom?: string | null;
  createdTo?: string | null;
};

export async function logAdminAuditEvent(input: AuditInput) {
  try {
    await db.query(
      `insert into admin_audit_events (
         actor_user_id,
         target_user_id,
         event_type,
         entity_type,
         entity_id,
         summary,
         metadata_json
       ) values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        input.actorUserId ?? null,
        input.targetUserId ?? null,
        input.eventType,
        input.entityType,
        input.entityId ?? null,
        input.summary,
        JSON.stringify(input.metadata ?? {}),
      ]
    );
  } catch (error: any) {
    if (error?.code !== '42P01') {
      throw error;
    }
  }
}

export async function listAdminAuditEvents(limit = 50) {
  let result;
  try {
    result = await db.query(
      `select a.id,
              a.event_type,
              a.entity_type,
              a.entity_id,
              a.summary,
              a.metadata_json,
              a.created_at,
              actor.email as actor_email,
              target.email as target_email
       from admin_audit_events a
       left join users actor on actor.id = a.actor_user_id
       left join users target on target.id = a.target_user_id
       order by a.created_at desc
       limit $1`,
      [limit]
    );
  } catch (error: any) {
    if (error?.code === '42P01') {
      return [];
    }
    throw error;
  }

  return result.rows.map((row) => ({
    id: String(row.id),
    eventType: String(row.event_type),
    entityType: String(row.entity_type),
    entityId: row.entity_id ? String(row.entity_id) : null,
    summary: String(row.summary),
    actorEmail: row.actor_email ? String(row.actor_email) : null,
    targetEmail: row.target_email ? String(row.target_email) : null,
    metadata: (row.metadata_json ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}

export async function getAdminOverviewSnapshot(adminUserId: string) {
  const [
    metricsResult,
    recentUsersResult,
    managedUsageResult,
    recentAudit,
    notices,
    providerFailuresResult,
  ] = await Promise.all([
    db.query(
      `with user_base as (
         select
           u.id,
           u.role,
           u.created_at,
           sp.onboarding_complete,
           uup.billing_mode,
           (
             select max(last_seen) from (
               select u.created_at as last_seen
               union all
               select ct.last_message_at from chat_threads ct where ct.user_id = u.id
               union all
               select sa.updated_at from study_assets sa where sa.user_id = u.id
               union all
               select r.updated_at from reminders r where r.user_id = u.id
               union all
               select mue.reserved_at from managed_usage_events mue where mue.user_id = u.id
             ) activity
           ) as last_active_at
         from users u
         left join student_profiles sp on sp.user_id = u.id
         left join user_usage_profiles uup on uup.user_id = u.id
       ),
       usage_rollup as (
         select
           coalesce(sum(case when status = 'consumed' then request_units else 0 end), 0)::int as credits_consumed_30d,
           coalesce(sum(case when status = 'failed' then 1 else 0 end), 0)::int as failed_requests_30d
         from managed_usage_events
         where reserved_at >= now() - interval '30 days'
       )
       select
         count(*)::int as total_users,
         count(*) filter (where role != 'admin' and last_active_at >= now() - interval '7 days')::int as active_users,
         count(*) filter (where role != 'admin' and created_at >= now() - interval '7 days')::int as new_signups,
         count(*) filter (where role != 'admin' and billing_mode in ('managed', 'byok'))::int as paid_users,
         count(*) filter (where role != 'admin' and coalesce(billing_mode, 'unknown') not in ('managed', 'byok'))::int as free_users,
         count(*) filter (where role != 'admin' and onboarding_complete = true)::int as onboarded_users,
         (select credits_consumed_30d from usage_rollup) as credits_consumed_30d,
         (select failed_requests_30d from usage_rollup) as failed_requests_30d
       from user_base`
    ),
    db.query(
      `select id, email, full_name, role, created_at
       from users
       order by created_at desc
       limit 6`
    ),
    listManagedUsageAccounts(),
    listAdminAuditEvents(12),
    buildSystemNotices(adminUserId),
    db.query(
      `select
         coalesce(sum(case when status = 'failed' then 1 else 0 end), 0)::int as failed_requests_24h
       from managed_usage_events
       where reserved_at >= now() - interval '24 hours'`
    ),
  ]);

  const row = metricsResult.rows[0] ?? {};
  const totalUsers = Number(row.total_users ?? 0);
  const paidUsers = Number(row.paid_users ?? 0);
  const freeUsers = Number(row.free_users ?? 0);
  const conversionRate = totalUsers > 1 ? Number(((paidUsers / Math.max(totalUsers - 1, 1)) * 100).toFixed(1)) : 0;
  const heavyUsageAccounts = [...managedUsageResult]
    .sort((left, right) => (right.usedInWindow ?? 0) - (left.usedInWindow ?? 0))
    .slice(0, 5);

  return {
    metrics: {
      totalUsers,
      activeUsers: Number(row.active_users ?? 0),
      newSignups: Number(row.new_signups ?? 0),
      paidUsers,
      freeUsers,
      conversionRate,
      onboardedUsers: Number(row.onboarded_users ?? 0),
      creditsConsumed30d: Number(row.credits_consumed_30d ?? 0),
      providerSpend30d: null,
      failedRequests30d: Number(row.failed_requests_30d ?? 0),
      failedRequests24h: Number(providerFailuresResult.rows[0]?.failed_requests_24h ?? 0),
    },
    recentActivity: recentAudit,
    recentUsers: recentUsersResult.rows.map((user) => ({
      id: String(user.id),
      email: String(user.email),
      fullName: user.full_name ? String(user.full_name) : null,
      role: String(user.role ?? 'student'),
      createdAt: user.created_at,
    })),
    heavyUsageAccounts,
    quickActions: [
      { label: 'Review user accounts', href: '/admin/users' },
      { label: 'Adjust credits and tiers', href: '/admin/usage' },
      { label: 'Inspect provider ops', href: '/admin/providers' },
      { label: 'Open system status', href: '/admin/system' },
    ],
    notices,
  };
}

export async function listAdminUsers(filters: UserListFilters) {
  const values: unknown[] = [];
  const clauses: string[] = [];

  if (filters.query?.trim()) {
    values.push(`%${filters.query.trim()}%`);
    clauses.push(`(coalesce(u.full_name, '') ilike $${values.length} or u.email ilike $${values.length})`);
  }

  if (filters.role?.trim()) {
    values.push(filters.role.trim());
    clauses.push(`u.role = $${values.length}`);
  }

  if (filters.tier?.trim()) {
    values.push(filters.tier.trim());
    clauses.push(`uup.tier::text = $${values.length}`);
  }

  if (filters.billingMode?.trim()) {
    values.push(filters.billingMode.trim());
    clauses.push(`coalesce(uup.billing_mode, 'unknown') = $${values.length}`);
  }

  if (filters.providerSelection?.trim()) {
    values.push(filters.providerSelection.trim());
    clauses.push(`coalesce(uup.provider_selection, split_part(uup.model_selection, '/', 1), 'unknown') = $${values.length}`);
  }

  if (filters.modelSelection?.trim()) {
    values.push(filters.modelSelection.trim());
    clauses.push(`coalesce(uup.model_selection, '') = $${values.length}`);
  }

  if (filters.onboarding === 'complete') {
    clauses.push(`coalesce(sp.onboarding_complete, false) = true`);
  } else if (filters.onboarding === 'incomplete') {
    clauses.push(`coalesce(sp.onboarding_complete, false) = false`);
  }

  if (filters.createdFrom?.trim()) {
    values.push(filters.createdFrom.trim());
    clauses.push(`u.created_at >= $${values.length}::timestamptz`);
  }

  if (filters.createdTo?.trim()) {
    values.push(filters.createdTo.trim());
    clauses.push(`u.created_at <= $${values.length}::timestamptz`);
  }

  const whereSql = clauses.length ? `where ${clauses.join(' and ')}` : '';
  const result = await db.query(
    `with window_usage as (
       select
         user_id,
         coalesce(sum(case
           when status in ('reserved', 'consumed')
            and reserved_at >= now() - interval '5 hours'
           then request_units else 0 end), 0)::int as used_in_window
       from managed_usage_events
       group by user_id
     ),
     latest_activity as (
       select
         u.id as user_id,
         (
           select max(last_seen) from (
             select u.created_at as last_seen
             union all
             select ct.last_message_at from chat_threads ct where ct.user_id = u.id
             union all
             select sa.updated_at from study_assets sa where sa.user_id = u.id
             union all
             select r.updated_at from reminders r where r.user_id = u.id
             union all
             select mue.reserved_at from managed_usage_events mue where mue.user_id = u.id
           ) activity
         ) as last_active_at
       from users u
     )
     select
       u.id,
       u.email,
       u.full_name,
       u.role,
       u.created_at,
       la.last_active_at,
       coalesce(sp.onboarding_complete, false) as onboarding_complete,
       uup.tier,
       coalesce(uup.billing_mode, 'unknown') as billing_mode,
       coalesce(uup.credits_total, 0)::int as credits_total,
       coalesce(uup.credits_remaining, 0)::int as credits_remaining,
       coalesce(wu.used_in_window, 0)::int as used_in_window,
       uup.provider_selection,
       uup.model_selection
     from users u
     left join student_profiles sp on sp.user_id = u.id
     left join user_usage_profiles uup on uup.user_id = u.id
     left join window_usage wu on wu.user_id = u.id
     left join latest_activity la on la.user_id = u.id
     ${whereSql}
     order by u.created_at desc`,
    values
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    name: row.full_name ? String(row.full_name) : null,
    email: String(row.email),
    role: String(row.role ?? 'student'),
    tier: row.tier ? String(row.tier) : null,
    billingMode: String(row.billing_mode ?? 'unknown'),
    creditsTotal: Number(row.credits_total ?? 0),
    creditsRemaining: Number(row.credits_remaining ?? 0),
    usageInWindow: Number(row.used_in_window ?? 0),
    providerSelection: row.provider_selection ? String(row.provider_selection) : null,
    modelSelection: row.model_selection ? String(row.model_selection) : null,
    onboardingComplete: !!row.onboarding_complete,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
  }));
}

export async function getAdminUserDetail(userId: string) {
  const [userResult, usageAccounts, usageEvents, countsResult, auditEvents] = await Promise.all([
    db.query(
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
         uup.tier,
         coalesce(uup.billing_mode, 'unknown') as billing_mode,
         coalesce(uup.uses_managed_credits, false) as uses_managed_credits,
         coalesce(uup.credits_total, 0)::int as credits_total,
         coalesce(uup.credits_remaining, 0)::int as credits_remaining,
         uup.internal_usage_identity,
         uup.identity_status,
         uup.provider_selection,
         uup.model_selection
       from users u
       left join student_profiles sp on sp.user_id = u.id
       left join user_usage_profiles uup on uup.user_id = u.id
       where u.id = $1
       limit 1`,
      [userId]
    ),
    listManagedUsageAccounts(),
    listManagedUsageEventsForUser(userId, 30),
    db.query(
      `select
         (select count(*)::int from study_assets where user_id = $1) as study_assets,
         (select count(*)::int from flashcard_sets where user_id = $1) as flashcard_sets,
         (select count(*)::int from quizzes where user_id = $1) as quizzes,
         (select count(*)::int from chat_threads where user_id = $1) as conversations,
         (select count(*)::int from reminders where user_id = $1) as reminders`,
      [userId]
    ),
    db.query(
      `select id, event_type, entity_type, summary, metadata_json, created_at
       from admin_audit_events
       where target_user_id = $1 or actor_user_id = $1
       order by created_at desc
       limit 20`,
      [userId]
    ),
  ]);

  const user = userResult.rows[0];
  if (!user) {
    return null;
  }

  const usage = usageAccounts.find((account) => account.userId === userId) ?? null;
  return {
    user: {
      id: String(user.id),
      email: String(user.email),
      fullName: user.full_name ? String(user.full_name) : null,
      role: String(user.role ?? 'student'),
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      onboardingComplete: !!user.onboarding_complete,
      schoolName: user.school_name ? String(user.school_name) : null,
      schoolLevel: user.school_level ? String(user.school_level) : null,
      gradeYear: user.grade_year ? String(user.grade_year) : null,
      major: user.major ? String(user.major) : null,
    },
    usage,
    usageEvents,
    counts: {
      studyAssets: Number(countsResult.rows[0]?.study_assets ?? 0),
      flashcardSets: Number(countsResult.rows[0]?.flashcard_sets ?? 0),
      quizzes: Number(countsResult.rows[0]?.quizzes ?? 0),
      conversations: Number(countsResult.rows[0]?.conversations ?? 0),
      reminders: Number(countsResult.rows[0]?.reminders ?? 0),
    },
    auditEvents: auditEvents.rows.map((row) => ({
      id: String(row.id),
      eventType: String(row.event_type),
      entityType: String(row.entity_type),
      summary: String(row.summary),
      metadata: (row.metadata_json ?? {}) as Record<string, unknown>,
      createdAt: row.created_at,
    })),
  };
}

export async function adjustManagedUsageCredits(input: {
  actorUserId: string;
  targetUserId: string;
  delta: number;
  reason?: string | null;
}) {
  const result = await db.query(
    `insert into user_usage_profiles (
       user_id,
       tier,
       billing_mode,
       credits_total,
       credits_remaining
     ) values ($1, 'tier_1', 'managed', 0, 0)
     on conflict (user_id) do update set
       credits_total = greatest(user_usage_profiles.credits_total + $2, 0),
       credits_remaining = least(
         greatest(user_usage_profiles.credits_remaining + $2, 0),
         greatest(user_usage_profiles.credits_total + $2, 0)
       ),
       updated_at = now()
     returning user_id, credits_total, credits_remaining`,
    [input.targetUserId, input.delta]
  );

  await logAdminAuditEvent({
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    eventType: 'credits_adjusted',
    entityType: 'user_usage_profile',
    entityId: String(result.rows[0]?.user_id ?? input.targetUserId),
    summary: `Adjusted credits by ${input.delta > 0 ? '+' : ''}${input.delta}.`,
    metadata: { delta: input.delta, reason: input.reason ?? null },
  });

  return getAdminUserDetail(input.targetUserId);
}

export async function changeManagedUsageTier(input: {
  actorUserId: string;
  targetUserId: string;
  tier: StudyClawUsageTier;
  resetCredits?: boolean;
}) {
  const snapshot = await updateManagedUsageTier({
    userId: input.targetUserId,
    tier: input.tier,
    resetCredits: input.resetCredits ?? false,
  });

  await logAdminAuditEvent({
    actorUserId: input.actorUserId,
    targetUserId: input.targetUserId,
    eventType: 'tier_changed',
    entityType: 'user_usage_profile',
    entityId: input.targetUserId,
    summary: `Changed usage tier to ${input.tier}.`,
    metadata: { tier: input.tier, resetCredits: input.resetCredits ?? false },
  });

  return snapshot;
}

export async function getProviderOpsSnapshot(adminUserId: string) {
  const [providerConfigsResult, activeModelResult, requestStatsResult, requestTrendResult, providerTrendResult, modelWatchResult, affectedUsersResult, recentFailuresResult, openclawSnapshot] = await Promise.all([
    db.query(
      `select
         provider_id,
         provider_name,
         service_base_url,
         count(*)::int as saved_configs,
         count(*) filter (where is_active = true)::int as active_configs
       from user_saved_model_configs
       group by provider_id, provider_name, service_base_url
       order by active_configs desc, saved_configs desc, provider_name asc`
    ),
    db.query(
      `select
         coalesce(uup.provider_selection, split_part(ap.model_key, '/', 1), 'unknown') as provider_id,
         coalesce(uup.model_selection, ap.model_key, 'unknown') as model_key,
         count(*)::int as users_on_model
       from users u
       left join agent_profiles ap on ap.user_id = u.id
       left join user_usage_profiles uup on uup.user_id = u.id
       where u.role != 'admin'
       group by 1, 2
       order by users_on_model desc, model_key asc`
    ),
    db.query(
      `select
         split_part(model_key, '/', 1) as provider_id,
         model_key,
         count(*) filter (where status = 'consumed')::int as completed,
         count(*) filter (where status = 'failed')::int as failed,
         count(*)::int as total
       from managed_usage_events
       where reserved_at >= now() - interval '7 days'
       group by 1, 2
       order by failed desc, total desc, model_key asc`
    ),
    db.query(
      `select
         to_char(date_trunc('day', reserved_at), 'YYYY-MM-DD') as day,
         count(*) filter (where status = 'consumed')::int as completed,
         count(*) filter (where status = 'failed')::int as failed,
         count(*)::int as total
       from managed_usage_events
       where reserved_at >= now() - interval '7 days'
       group by 1
       order by 1 asc`
    ),
    db.query(
      `select
         split_part(model_key, '/', 1) as provider_id,
         to_char(date_trunc('day', reserved_at), 'YYYY-MM-DD') as day,
         count(*) filter (where status = 'consumed')::int as completed,
         count(*) filter (where status = 'failed')::int as failed,
         count(*)::int as total
       from managed_usage_events
       where reserved_at >= now() - interval '7 days'
       group by 1, 2
       order by provider_id asc, day asc`
    ),
    db.query(
      `select
         split_part(model_key, '/', 1) as provider_id,
         model_key,
         max(reserved_at) as last_seen_at,
         max(case when status = 'failed' then reserved_at end) as last_failed_at,
         count(*) filter (where status = 'failed' and reserved_at >= now() - interval '24 hours')::int as failed_24h,
         count(*) filter (where status = 'consumed' and reserved_at >= now() - interval '24 hours')::int as completed_24h,
         count(*)::int as total_7d
       from managed_usage_events
       where reserved_at >= now() - interval '7 days'
       group by 1, 2
       order by failed_24h desc, last_failed_at desc nulls last, total_7d desc, model_key asc
       limit 12`
    ),
    db.query(
      `select
         split_part(mue.model_key, '/', 1) as provider_id,
         u.id as user_id,
         u.email,
         count(*) filter (where mue.status = 'failed' and mue.reserved_at >= now() - interval '24 hours')::int as failed_24h,
         count(*) filter (where mue.status = 'consumed' and mue.reserved_at >= now() - interval '24 hours')::int as completed_24h,
         max(mue.reserved_at) as last_event_at
       from managed_usage_events mue
       join users u on u.id = mue.user_id
       where mue.reserved_at >= now() - interval '7 days'
       group by 1, 2, 3
       having count(*) filter (where mue.status = 'failed' and mue.reserved_at >= now() - interval '24 hours') > 0
       order by failed_24h desc, last_event_at desc
       limit 12`
    ),
    db.query(
      `select
         mue.id,
         u.id as user_id,
         u.email,
         split_part(mue.model_key, '/', 1) as provider_id,
         mue.model_key,
         mue.feature,
         mue.request_units,
         mue.reserved_at,
         mue.finalized_at,
         mue.metadata_json
       from managed_usage_events mue
       join users u on u.id = mue.user_id
       where mue.status = 'failed'
         and mue.reserved_at >= now() - interval '48 hours'
       order by mue.reserved_at desc
       limit 12`
    ),
    getOpenClawSettingsSnapshot(adminUserId).catch(() => null),
  ]);

  return {
    providers: providerConfigsResult.rows.map((row) => ({
      providerId: String(row.provider_id),
      providerName: String(row.provider_name),
      serviceBaseUrl: String(row.service_base_url),
      savedConfigs: Number(row.saved_configs ?? 0),
      activeConfigs: Number(row.active_configs ?? 0),
    })),
    activeModels: activeModelResult.rows.map((row) => ({
      providerId: String(row.provider_id),
      modelKey: String(row.model_key),
      usersOnModel: Number(row.users_on_model ?? 0),
    })),
    requestStats: requestStatsResult.rows.map((row) => ({
      providerId: String(row.provider_id ?? 'unknown'),
      modelKey: String(row.model_key ?? 'unknown'),
      completed: Number(row.completed ?? 0),
      failed: Number(row.failed ?? 0),
      total: Number(row.total ?? 0),
      fallbackCount: null,
      latencyMsP95: null,
    })),
    requestTrend: requestTrendResult.rows.map((row) => ({
      day: String(row.day),
      completed: Number(row.completed ?? 0),
      failed: Number(row.failed ?? 0),
      total: Number(row.total ?? 0),
    })),
    providerTrend: providerTrendResult.rows.map((row) => ({
      providerId: String(row.provider_id ?? 'unknown'),
      day: String(row.day),
      completed: Number(row.completed ?? 0),
      failed: Number(row.failed ?? 0),
      total: Number(row.total ?? 0),
    })),
    modelWatch: modelWatchResult.rows.map((row) => ({
      providerId: String(row.provider_id ?? 'unknown'),
      modelKey: String(row.model_key ?? 'unknown'),
      lastSeenAt: row.last_seen_at,
      lastFailedAt: row.last_failed_at,
      failed24h: Number(row.failed_24h ?? 0),
      completed24h: Number(row.completed_24h ?? 0),
      total7d: Number(row.total_7d ?? 0),
    })),
    affectedUsers: affectedUsersResult.rows.map((row) => ({
      providerId: String(row.provider_id ?? 'unknown'),
      userId: String(row.user_id),
      email: String(row.email),
      failed24h: Number(row.failed_24h ?? 0),
      completed24h: Number(row.completed_24h ?? 0),
      lastEventAt: row.last_event_at,
    })),
    recentFailures: recentFailuresResult.rows.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      email: String(row.email),
      providerId: String(row.provider_id ?? 'unknown'),
      modelKey: String(row.model_key ?? 'unknown'),
      feature: String(row.feature ?? 'unknown'),
      requestUnits: Number(row.request_units ?? 0),
      reservedAt: row.reserved_at,
      finalizedAt: row.finalized_at,
      failureSummary: extractFailureSummary((row.metadata_json ?? {}) as Record<string, unknown>),
    })),
    diagnostics: openclawSnapshot
      ? {
          sessionsOk: !!openclawSnapshot.diagnostics?.sessionsOk,
          skillsOk: !!openclawSnapshot.diagnostics?.skillsOk,
          channelsProbe: String(openclawSnapshot.diagnostics?.channelsProbe ?? 'Unavailable'),
        }
      : null,
  };
}

export async function getContentOpsSnapshot() {
  const [countsResult, recentAssetsResult, recentStudyArtifactsResult] = await Promise.all([
    db.query(
      `select
         (select count(*)::int from study_assets) as study_assets,
         (select count(*)::int from flashcard_sets) as flashcard_sets,
         (select count(*)::int from quizzes) as quizzes,
         (select count(*)::int from chat_threads) as conversations,
         (select count(*)::int from reminders) as reminders`
    ),
    db.query(
      `select sa.id, sa.title, sa.asset_type, sa.created_at, u.email
       from study_assets sa
       join users u on u.id = sa.user_id
       order by sa.created_at desc
       limit 10`
    ),
    db.query(
      `select * from (
         select fs.id, fs.title, 'flashcard_set'::text as item_type, fs.created_at, u.email
         from flashcard_sets fs
         join users u on u.id = fs.user_id
         union all
         select q.id, q.title, 'quiz'::text as item_type, q.created_at, u.email
         from quizzes q
         join users u on u.id = q.user_id
       ) items
       order by created_at desc
       limit 12`
    ),
  ]);

  return {
    totals: {
      studyAssets: Number(countsResult.rows[0]?.study_assets ?? 0),
      flashcardSets: Number(countsResult.rows[0]?.flashcard_sets ?? 0),
      quizzes: Number(countsResult.rows[0]?.quizzes ?? 0),
      conversations: Number(countsResult.rows[0]?.conversations ?? 0),
      reminders: Number(countsResult.rows[0]?.reminders ?? 0),
    },
    recentAssets: recentAssetsResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      assetType: String(row.asset_type),
      createdAt: row.created_at,
      email: String(row.email),
    })),
    recentStudyArtifacts: recentStudyArtifactsResult.rows.map((row) => ({
      id: String(row.id),
      title: String(row.title),
      itemType: String(row.item_type),
      createdAt: row.created_at,
      email: String(row.email),
    })),
  };
}

export async function getSystemOpsSnapshot(adminUserId: string) {
  const [dbCheck, openclawSnapshot, notices, failedTrendResult, auditTrendResult, recentFailuresResult] = await Promise.all([
    db.query(`select now() as now`),
    getOpenClawSettingsSnapshot(adminUserId).catch(() => null),
    buildSystemNotices(adminUserId),
    db.query(
      `select
         to_char(date_trunc('day', reserved_at), 'YYYY-MM-DD') as day,
         count(*) filter (where status = 'failed')::int as failed_requests,
         count(*)::int as total_requests
       from managed_usage_events
       where reserved_at >= now() - interval '7 days'
       group by 1
       order by 1 asc`
    ),
    db.query(
      `select
         to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
         count(*)::int as audit_events
       from admin_audit_events
       where created_at >= now() - interval '7 days'
       group by 1
       order by 1 asc`
    ),
    db.query(
      `select
         mue.id,
         u.id as user_id,
         u.email,
         split_part(mue.model_key, '/', 1) as provider_id,
         mue.model_key,
         mue.feature,
         mue.reserved_at,
         mue.metadata_json
       from managed_usage_events mue
       join users u on u.id = mue.user_id
       where mue.status = 'failed'
         and mue.reserved_at >= now() - interval '24 hours'
       order by mue.reserved_at desc
       limit 10`
    ),
  ]);

  return {
    dependencies: {
      database: {
        status: dbCheck.rows[0]?.now ? 'healthy' : 'unknown',
        checkedAt: dbCheck.rows[0]?.now ?? new Date().toISOString(),
      },
      minimax: {
        status: process.env.MINIMAX_API_KEY ? 'configured' : 'missing',
      },
      googleOAuth: {
        status:
          process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? 'configured' : 'missing',
      },
      openclaw: openclawSnapshot
        ? {
            status: openclawSnapshot.diagnostics?.sessionsOk ? 'healthy' : 'degraded',
            sessionsOk: !!openclawSnapshot.diagnostics?.sessionsOk,
            skillsOk: !!openclawSnapshot.diagnostics?.skillsOk,
            channelsProbe: String(openclawSnapshot.diagnostics?.channelsProbe ?? 'Unavailable'),
          }
        : {
            status: 'unknown',
            sessionsOk: false,
            skillsOk: false,
            channelsProbe: 'Unavailable',
          },
    },
    featureFlags: {
      managedMiniMaxCredits: true,
      onboardingTestingTiers: true,
      telegramPairing: true,
    },
    incidentTimeline: failedTrendResult.rows.map((row) => {
      const auditMatch = auditTrendResult.rows.find((auditRow) => String(auditRow.day) === String(row.day));
      return {
        day: String(row.day),
        failedRequests: Number(row.failed_requests ?? 0),
        totalRequests: Number(row.total_requests ?? 0),
        auditEvents: Number(auditMatch?.audit_events ?? 0),
      };
    }),
    recentFailures: recentFailuresResult.rows.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      email: String(row.email),
      providerId: String(row.provider_id ?? 'unknown'),
      modelKey: String(row.model_key ?? 'unknown'),
      feature: String(row.feature ?? 'unknown'),
      reservedAt: row.reserved_at,
      failureSummary: extractFailureSummary((row.metadata_json ?? {}) as Record<string, unknown>),
    })),
    notices,
  };
}

function extractFailureSummary(metadata: Record<string, unknown>) {
  const candidates = [
    metadata.error,
    metadata.message,
    metadata.reason,
    metadata.outcome,
  ];

  for (const candidate of candidates) {
    const value = typeof candidate === 'string' ? candidate.trim() : '';
    if (value) {
      return value.length > 180 ? `${value.slice(0, 177)}...` : value;
    }
  }

  return 'No error detail captured';
}

async function buildSystemNotices(adminUserId: string) {
  const [failedUsageResult, adminAgentResult] = await Promise.all([
    db.query(
      `select count(*)::int as failed_count
       from managed_usage_events
       where status = 'failed'
         and reserved_at >= now() - interval '24 hours'`
    ),
    db.query(`select openclaw_agent_id from admin_agents where owner_user_id = $1 limit 1`, [adminUserId]),
  ]);

  const notices: Array<{ level: 'info' | 'warning' | 'critical'; message: string }> = [];
  if (!process.env.MINIMAX_API_KEY) {
    notices.push({ level: 'critical', message: 'MiniMax API key is missing. Managed MiniMax traffic will fail.' });
  }

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    notices.push({ level: 'warning', message: 'Google OAuth is incomplete. Calendar and Google connect flows may fail.' });
  }

  if (!process.env.STUDYCLAW_ADMIN_EMAIL) {
    notices.push({ level: 'warning', message: 'STUDYCLAW_ADMIN_EMAIL is not configured. Admin role assignment may drift.' });
  }

  if (!adminAgentResult.rows[0]?.openclaw_agent_id) {
    notices.push({ level: 'critical', message: 'No admin agent binding was found for the current admin account.' });
  }

  const failedCount = Number(failedUsageResult.rows[0]?.failed_count ?? 0);
  if (failedCount > 0) {
    notices.push({ level: failedCount > 10 ? 'critical' : 'warning', message: `${failedCount} managed provider requests failed in the last 24 hours.` });
  }

  if (!notices.length) {
    notices.push({ level: 'info', message: 'No blocking configuration issues detected.' });
  }

  return notices;
}
