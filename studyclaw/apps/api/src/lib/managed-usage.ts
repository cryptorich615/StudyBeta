import crypto from 'node:crypto';
import { db } from './db';

export const MANAGED_MINIMAX_MODEL_KEYS = ['minimax/MiniMax-M2.5', 'minimax/MiniMax-M2.7'] as const;
export const MANAGED_MINIMAX_PROVIDER_ID = 'minimax';
export const MANAGED_USAGE_WINDOW_HOURS = 5;

export const STUDYCLAW_TIER_LIMITS = {
  tier_1: 100,
  tier_2: 300,
  tier_3: 500,
} as const;

export const STUDYCLAW_TIER_STARTING_CREDITS = {
  tier_1: 1000,
  tier_2: 3000,
  tier_3: 5000,
} as const;

export type StudyClawUsageTier = keyof typeof STUDYCLAW_TIER_LIMITS;
export type StudyClawBillingMode = 'managed' | 'byok' | 'local' | 'admin' | 'unknown';
export type ManagedUsageEventStatus = 'reserved' | 'consumed' | 'failed';

type UserUsageProfileRow = {
  user_id: string;
  tier: StudyClawUsageTier;
  billing_mode: StudyClawBillingMode;
  provider_selection: string | null;
  model_selection: string | null;
  uses_managed_credits: boolean;
  credits_total: number;
  credits_remaining: number;
  managed_provider_id: string | null;
  managed_model_key: string | null;
  byok_provider_id: string | null;
  internal_usage_identity: string | null;
  identity_status: string;
  created_at: string;
  updated_at: string;
};

type ManagedUsageEventRow = {
  id: string;
  user_id: string;
  usage_identity: string | null;
  provider_id: string;
  model_key: string;
  feature: string;
  event_key: string;
  status: ManagedUsageEventStatus;
  request_units: number;
  metadata_json: Record<string, unknown> | null;
  reserved_at: string;
  finalized_at: string | null;
  created_at: string;
  updated_at: string;
};

export type UsageSnapshot = {
  role: string;
  tier: StudyClawUsageTier | null;
  billingMode: StudyClawBillingMode;
  providerSelection: string | null;
  modelSelection: string | null;
  usesManagedCredits: boolean;
  isByok: boolean;
  isManaged: boolean;
  creditsTotal: number | null;
  creditsRemaining: number | null;
  internalUsageIdentity: string | null;
  identityStatus: string | null;
  windowHours: number;
  windowLimit: number | null;
  usedInWindow: number;
  remainingInWindow: number | null;
  resetsAt: string | null;
  recentEvents: Array<{
    id: string;
    feature: string;
    modelKey: string;
    status: ManagedUsageEventStatus;
    reservedAt: string;
    finalizedAt: string | null;
    metadata: Record<string, unknown>;
  }>;
};

export class ManagedUsageLimitError extends Error {
  readonly code = 'managed_usage_limit_reached';
  readonly statusCode = 429;

  constructor(
    readonly detail: {
      tier: StudyClawUsageTier;
      usedInWindow: number;
      windowLimit: number;
      remainingInWindow: number;
      resetsAt: string | null;
      creditsRemaining?: number;
    }
  ) {
    super(
      detail.creditsRemaining !== undefined
        ? `StudyClaw managed credits exhausted (${detail.creditsRemaining} remaining).`
        : `StudyClaw managed MiniMax quota reached (${detail.usedInWindow}/${detail.windowLimit} messages in the last ${MANAGED_USAGE_WINDOW_HOURS} hours).`
    );
  }
}

export function getTierLimit(tier: StudyClawUsageTier) {
  return STUDYCLAW_TIER_LIMITS[tier];
}

export function getTierStartingCredits(tier: StudyClawUsageTier) {
  return STUDYCLAW_TIER_STARTING_CREDITS[tier];
}

export function isManagedMiniMaxModelKey(modelKey: string | null | undefined) {
  return MANAGED_MINIMAX_MODEL_KEYS.includes(String(modelKey ?? '').trim() as (typeof MANAGED_MINIMAX_MODEL_KEYS)[number]);
}

export function splitManagedModelKey(modelKey: string) {
  const [providerId = 'unknown', ...rest] = String(modelKey ?? '').split('/');
  return {
    providerId,
    modelId: rest.join('/') || modelKey,
  };
}

export function getManagedMiniMaxProxyBaseUrl() {
  return (
    process.env.STUDYCLAW_MANAGED_MINIMAX_PROXY_BASE_URL?.trim() ||
    `http://127.0.0.1:${process.env.PORT ?? '4000'}/api/provider-proxy/minimax`
  );
}

function getManagedUsageSecret() {
  return process.env.STUDYCLAW_MANAGED_USAGE_SECRET || process.env.JWT_SECRET || 'studyclaw-managed-usage-secret';
}

function signUsageIdentity(identity: string) {
  return crypto.createHmac('sha256', getManagedUsageSecret()).update(identity).digest('base64url');
}

function buildUsageIdentity() {
  return `scu_${crypto.randomBytes(12).toString('hex')}`;
}

export function buildManagedVirtualApiKey(identity: string) {
  return `scvm_${identity}.${signUsageIdentity(identity)}`;
}

export function verifyManagedVirtualApiKey(token: string | null | undefined) {
  const raw = String(token ?? '').trim();
  const prefix = 'scvm_';
  if (!raw.startsWith(prefix)) {
    return null;
  }

  const payload = raw.slice(prefix.length);
  const separatorIndex = payload.lastIndexOf('.');
  if (separatorIndex < 1) {
    return null;
  }

  const identity = payload.slice(0, separatorIndex);
  const signature = payload.slice(separatorIndex + 1);
  const expected = signUsageIdentity(identity);

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) {
      return null;
    }
  } catch {
    return null;
  }

  return identity;
}

function mapUsageProfile(row: UserUsageProfileRow | undefined | null) {
  if (!row) {
    return null;
  }

  return {
    userId: row.user_id,
    tier: row.tier,
    billingMode: row.billing_mode,
    providerSelection: row.provider_selection,
    modelSelection: row.model_selection,
    usesManagedCredits: row.uses_managed_credits,
    creditsTotal: Number(row.credits_total ?? 0),
    creditsRemaining: Number(row.credits_remaining ?? 0),
    managedProviderId: row.managed_provider_id,
    managedModelKey: row.managed_model_key,
    byokProviderId: row.byok_provider_id,
    internalUsageIdentity: row.internal_usage_identity,
    identityStatus: row.identity_status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getUserUsageProfile(userId: string) {
  const result = await db.query(`select * from user_usage_profiles where user_id = $1 limit 1`, [userId]);
  return mapUsageProfile(result.rows[0] as UserUsageProfileRow | undefined);
}

export async function attachManagedMiniMaxUsage(input: {
  userId: string;
  modelKey: string;
  tier?: StudyClawUsageTier;
  resetCredits?: boolean;
}) {
  const existing = await getUserUsageProfile(input.userId);
  const identity = existing?.internalUsageIdentity || buildUsageIdentity();
  const tier = input.tier || existing?.tier || 'tier_1';
  const startingCredits = getTierStartingCredits(tier);
  const shouldResetCredits = input.resetCredits ?? false;

  await db.query(
    `insert into user_usage_profiles (
       user_id,
       tier,
       billing_mode,
       provider_selection,
       model_selection,
       uses_managed_credits,
       credits_total,
       credits_remaining,
       managed_provider_id,
       managed_model_key,
       byok_provider_id,
       internal_usage_identity,
       identity_status
     )
     values ($1, $2, 'managed', $3, $4, true, $5, $6, $7, $8, null, $9, 'active')
     on conflict (user_id) do update set
       tier = excluded.tier,
       billing_mode = 'managed',
       provider_selection = excluded.provider_selection,
       model_selection = excluded.model_selection,
       uses_managed_credits = true,
       credits_total = case
         when $10::boolean then excluded.credits_total
         when user_usage_profiles.credits_total > 0 then user_usage_profiles.credits_total
         else excluded.credits_total
       end,
       credits_remaining = case
         when $10::boolean then excluded.credits_remaining
         when user_usage_profiles.credits_remaining > 0 then user_usage_profiles.credits_remaining
         else excluded.credits_remaining
       end,
       managed_provider_id = excluded.managed_provider_id,
       managed_model_key = excluded.managed_model_key,
       byok_provider_id = null,
       internal_usage_identity = coalesce(user_usage_profiles.internal_usage_identity, excluded.internal_usage_identity),
       identity_status = 'active',
       updated_at = now()`,
    [
      input.userId,
      tier,
      MANAGED_MINIMAX_PROVIDER_ID,
      input.modelKey,
      startingCredits,
      startingCredits,
      MANAGED_MINIMAX_PROVIDER_ID,
      input.modelKey,
      identity,
      shouldResetCredits,
    ]
  );

  return {
    ...(await getUserUsageProfile(input.userId)),
    virtualApiKey: buildManagedVirtualApiKey(identity),
  };
}

export async function attachByokUsage(input: {
  userId: string;
  providerId: string;
  modelKey: string;
}) {
  await db.query(
    `insert into user_usage_profiles (
       user_id,
       billing_mode,
       provider_selection,
       model_selection,
       uses_managed_credits,
       credits_total,
       credits_remaining,
       managed_provider_id,
       managed_model_key,
       byok_provider_id,
       identity_status
     )
     values ($1, 'byok', $2, $3, false, 0, 0, null, null, $2, 'inactive')
     on conflict (user_id) do update set
       billing_mode = 'byok',
       provider_selection = excluded.provider_selection,
       model_selection = excluded.model_selection,
       uses_managed_credits = false,
       credits_total = 0,
       credits_remaining = 0,
       managed_provider_id = null,
       managed_model_key = null,
       byok_provider_id = excluded.byok_provider_id,
       identity_status = case when user_usage_profiles.internal_usage_identity is null then 'unassigned' else 'inactive' end,
       updated_at = now()`,
    [input.userId, input.providerId, input.modelKey]
  );

  return getUserUsageProfile(input.userId);
}

export async function attachLocalUsage(input: {
  userId: string;
  providerId: string;
  modelKey: string;
}) {
  await db.query(
    `insert into user_usage_profiles (
       user_id,
       billing_mode,
       provider_selection,
       model_selection,
       uses_managed_credits,
       credits_total,
       credits_remaining,
       managed_provider_id,
       managed_model_key,
       byok_provider_id,
       identity_status
     )
     values ($1, 'local', $2, $3, false, 0, 0, null, null, null, 'inactive')
     on conflict (user_id) do update set
       billing_mode = 'local',
       provider_selection = excluded.provider_selection,
       model_selection = excluded.model_selection,
       uses_managed_credits = false,
       credits_total = 0,
       credits_remaining = 0,
       managed_provider_id = null,
       managed_model_key = null,
       byok_provider_id = null,
       identity_status = case when user_usage_profiles.internal_usage_identity is null then 'unassigned' else 'inactive' end,
       updated_at = now()`,
    [input.userId, input.providerId, input.modelKey]
  );

  return getUserUsageProfile(input.userId);
}

async function fetchWindowUsage(userId: string) {
  const [usageResult, earliestResult, recentResult] = await Promise.all([
    db.query(
      `select coalesce(sum(request_units), 0)::int as used
       from managed_usage_events
       where user_id = $1
         and status in ('reserved', 'consumed')
         and reserved_at >= now() - interval '5 hours'`,
      [userId]
    ),
    db.query(
      `select reserved_at
       from managed_usage_events
       where user_id = $1
         and status in ('reserved', 'consumed')
         and reserved_at >= now() - interval '5 hours'
       order by reserved_at asc
       limit 1`,
      [userId]
    ),
    db.query(
      `select id,
              feature,
              model_key,
              status,
              reserved_at,
              finalized_at,
              metadata_json
       from managed_usage_events
       where user_id = $1
       order by reserved_at desc
       limit 15`,
      [userId]
    ),
  ]);

  const earliest = earliestResult.rows[0]?.reserved_at
    ? new Date(earliestResult.rows[0].reserved_at)
    : null;

  return {
    usedInWindow: Number(usageResult.rows[0]?.used ?? 0),
    resetsAt: earliest ? new Date(earliest.getTime() + MANAGED_USAGE_WINDOW_HOURS * 60 * 60 * 1000).toISOString() : null,
    recentEvents: recentResult.rows.map((row) => ({
      id: row.id,
      feature: row.feature,
      modelKey: row.model_key,
      status: row.status as ManagedUsageEventStatus,
      reservedAt: row.reserved_at,
      finalizedAt: row.finalized_at,
      metadata: (row.metadata_json ?? {}) as Record<string, unknown>,
    })),
  };
}

export async function getUserUsageSnapshot(userId: string) {
  const [userResult, profile] = await Promise.all([
    db.query(`select role from users where id = $1 limit 1`, [userId]),
    getUserUsageProfile(userId),
  ]);
  const role = String(userResult.rows[0]?.role ?? 'student');
  const window = await fetchWindowUsage(userId);
  const windowLimit = profile?.billingMode === 'managed' && profile?.tier ? getTierLimit(profile.tier) : null;
  const remaining = windowLimit === null ? null : Math.max(windowLimit - window.usedInWindow, 0);

  return {
    role,
    tier: profile?.tier ?? null,
    billingMode: role === 'admin' ? 'admin' : profile?.billingMode ?? 'unknown',
    providerSelection: profile?.providerSelection ?? null,
    modelSelection: profile?.modelSelection ?? null,
    usesManagedCredits: role !== 'admin' && !!profile?.usesManagedCredits,
    isByok: profile?.billingMode === 'byok',
    isManaged: role !== 'admin' && profile?.billingMode === 'managed' && !!profile?.usesManagedCredits,
    creditsTotal: role === 'admin' ? null : profile?.creditsTotal ?? 0,
    creditsRemaining: role === 'admin' ? null : profile?.creditsRemaining ?? 0,
    internalUsageIdentity: role === 'admin' ? null : profile?.internalUsageIdentity ?? null,
    identityStatus: role === 'admin' ? 'admin' : profile?.identityStatus ?? null,
    windowHours: MANAGED_USAGE_WINDOW_HOURS,
    windowLimit,
    usedInWindow: window.usedInWindow,
    remainingInWindow: remaining,
    resetsAt: window.resetsAt,
    recentEvents: window.recentEvents,
  } satisfies UsageSnapshot;
}

export async function reserveManagedUsageEvent(input: {
  userId: string;
  feature: string;
  modelKey: string;
  requestUnits?: number;
  eventKey: string;
  metadata?: Record<string, unknown>;
}) {
  const userResult = await db.query(`select role from users where id = $1 limit 1`, [input.userId]);
  const role = String(userResult.rows[0]?.role ?? 'student');
  if (role === 'admin') {
    return {
      enforced: false,
      reason: 'admin',
      eventId: null,
    } as const;
  }

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(`select pg_advisory_xact_lock(hashtext($1))`, [`managed-usage:${input.userId}`]);

    const profileResult = await client.query(`select * from user_usage_profiles where user_id = $1 limit 1`, [input.userId]);
    const profile = mapUsageProfile(profileResult.rows[0] as UserUsageProfileRow | undefined);
    if (!profile || profile.billingMode !== 'managed' || !profile.usesManagedCredits || !profile.internalUsageIdentity) {
      await client.query('commit');
      return {
        enforced: false,
        reason: 'not_managed',
        eventId: null,
      } as const;
    }

    const existingResult = await client.query(
      `select id, status
       from managed_usage_events
       where user_id = $1
         and event_key = $2
       limit 1`,
      [input.userId, input.eventKey]
    );
    if (existingResult.rows[0] && existingResult.rows[0].status !== 'failed') {
      await client.query('commit');
      return {
        enforced: true,
        eventId: existingResult.rows[0].id as string,
        duplicate: true,
        snapshot: await getUserUsageSnapshot(input.userId),
      } as const;
    }

    const currentUsageResult = await client.query(
      `select coalesce(sum(request_units), 0)::int as used
       from managed_usage_events
       where user_id = $1
         and status in ('reserved', 'consumed')
         and reserved_at >= now() - interval '5 hours'`,
      [input.userId]
    );
    const usedInWindow = Number(currentUsageResult.rows[0]?.used ?? 0);
    const requestUnits = Math.max(1, Math.floor(input.requestUnits ?? 1));
    const windowLimit = getTierLimit(profile.tier ?? 'tier_1');
    const creditsRemaining = Math.max(0, Number(profile.creditsRemaining ?? 0));

    if (usedInWindow + requestUnits > windowLimit) {
      const earliestResult = await client.query(
        `select reserved_at
         from managed_usage_events
         where user_id = $1
           and status in ('reserved', 'consumed')
           and reserved_at >= now() - interval '5 hours'
         order by reserved_at asc
         limit 1`,
        [input.userId]
      );
      const resetsAt = earliestResult.rows[0]?.reserved_at
        ? new Date(new Date(earliestResult.rows[0].reserved_at).getTime() + MANAGED_USAGE_WINDOW_HOURS * 60 * 60 * 1000).toISOString()
        : null;

      throw new ManagedUsageLimitError({
        tier: profile.tier ?? 'tier_1',
        usedInWindow,
        windowLimit,
        remainingInWindow: Math.max(windowLimit - usedInWindow, 0),
        resetsAt,
      });
    }

    if (creditsRemaining < requestUnits) {
      throw new ManagedUsageLimitError({
        tier: profile.tier ?? 'tier_1',
        usedInWindow,
        windowLimit,
        remainingInWindow: Math.max(windowLimit - usedInWindow, 0),
        resetsAt: null,
        creditsRemaining,
      });
    }

    const inserted = await client.query(
      `insert into managed_usage_events (
         user_id,
         usage_identity,
         provider_id,
         model_key,
         feature,
         event_key,
         status,
         request_units,
         metadata_json
       )
       values ($1, $2, $3, $4, $5, $6, 'reserved', $7, $8)
       returning id`,
      [
        input.userId,
        profile.internalUsageIdentity,
        MANAGED_MINIMAX_PROVIDER_ID,
        input.modelKey,
        input.feature,
        input.eventKey,
        requestUnits,
        JSON.stringify(input.metadata ?? {}),
      ]
    );

    await client.query(
      `update user_usage_profiles
       set credits_remaining = greatest(credits_remaining - $2, 0),
           updated_at = now()
       where user_id = $1`,
      [input.userId, requestUnits]
    );

    await client.query('commit');
    return {
      enforced: true,
      eventId: inserted.rows[0]?.id as string,
      duplicate: false,
      snapshot: await getUserUsageSnapshot(input.userId),
    } as const;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function finalizeManagedUsageEvent(input: {
  eventId: string | null;
  success: boolean;
  metadata?: Record<string, unknown>;
}) {
  if (!input.eventId) {
    return;
  }

  const client = await db.connect();
  try {
    await client.query('begin');

    const eventResult = await client.query(
      `select user_id, request_units, status
       from managed_usage_events
       where id = $1
       limit 1`,
      [input.eventId]
    );
    const event = eventResult.rows[0] as { user_id: string; request_units: number; status: ManagedUsageEventStatus } | undefined;
    if (!event) {
      await client.query('commit');
      return;
    }

    if (!input.success && event.status === 'reserved') {
      await client.query(
        `update user_usage_profiles
         set credits_remaining = credits_remaining + $2,
             updated_at = now()
         where user_id = $1`,
        [event.user_id, Number(event.request_units ?? 1)]
      );
    }

    await client.query(
      `update managed_usage_events
       set status = $2,
           finalized_at = now(),
           metadata_json = metadata_json || $3::jsonb,
           updated_at = now()
       where id = $1`,
      [
        input.eventId,
        input.success ? 'consumed' : 'failed',
        JSON.stringify(input.metadata ?? {}),
      ]
    );

    await client.query('commit');
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function getManagedUsageProfileByIdentity(identity: string) {
  const result = await db.query(
    `select uup.*, u.role, u.email
     from user_usage_profiles uup
     join users u on u.id = uup.user_id
     where uup.internal_usage_identity = $1
     limit 1`,
    [identity]
  );

  const row = result.rows[0];
  if (!row) {
    return null;
  }

  return {
    ...mapUsageProfile(row as UserUsageProfileRow)!,
    role: String(row.role ?? 'student'),
    email: String(row.email ?? ''),
  };
}

export async function listManagedUsageAccounts() {
  const result = await db.query(
    `select u.id as user_id,
            u.email,
            u.role,
            uup.tier,
            uup.billing_mode,
            uup.provider_selection,
            uup.model_selection,
            uup.uses_managed_credits,
            uup.credits_total,
            uup.credits_remaining,
            uup.internal_usage_identity,
            uup.identity_status,
            coalesce(sum(case
              when mue.status in ('reserved', 'consumed')
               and mue.reserved_at >= now() - interval '5 hours'
              then mue.request_units else 0 end), 0)::int as used_in_window,
            max(mue.reserved_at) filter (
              where mue.status in ('reserved', 'consumed')
                and mue.reserved_at >= now() - interval '5 hours'
            ) as latest_window_event_at
     from users u
     left join user_usage_profiles uup on uup.user_id = u.id
     left join managed_usage_events mue on mue.user_id = u.id
     group by u.id, u.email, u.role, uup.tier, uup.billing_mode, uup.provider_selection, uup.model_selection, uup.uses_managed_credits, uup.credits_total, uup.credits_remaining, uup.internal_usage_identity, uup.identity_status
     order by u.created_at desc`
  );

  return result.rows.map((row) => {
    const tier = (row.tier ?? null) as StudyClawUsageTier | null;
    const windowLimit = tier ? getTierLimit(tier) : null;
    const usedInWindow = Number(row.used_in_window ?? 0);
    return {
      userId: row.user_id,
      email: row.email,
      role: row.role,
      tier,
      billingMode: row.billing_mode ?? 'unknown',
      providerSelection: row.provider_selection ?? null,
      modelSelection: row.model_selection ?? null,
      usesManagedCredits: !!row.uses_managed_credits,
      creditsTotal: Number(row.credits_total ?? 0),
      creditsRemaining: Number(row.credits_remaining ?? 0),
      internalUsageIdentity: row.internal_usage_identity ?? null,
      identityStatus: row.identity_status ?? null,
      usedInWindow,
      windowLimit,
      remainingInWindow: windowLimit === null ? null : Math.max(windowLimit - usedInWindow, 0),
      latestWindowEventAt: row.latest_window_event_at ?? null,
    };
  });
}

export async function listManagedUsageEventsForUser(userId: string, limit = 25) {
  const result = await db.query(
    `select id, feature, model_key, status, request_units, reserved_at, finalized_at, metadata_json
     from managed_usage_events
     where user_id = $1
     order by reserved_at desc
     limit $2`,
    [userId, limit]
  );

  return result.rows.map((row) => ({
    id: row.id,
    feature: row.feature,
    modelKey: row.model_key,
    status: row.status as ManagedUsageEventStatus,
    requestUnits: Number(row.request_units ?? 1),
    reservedAt: row.reserved_at,
    finalizedAt: row.finalized_at,
    metadata: (row.metadata_json ?? {}) as Record<string, unknown>,
  }));
}

export async function updateManagedUsageTier(input: {
  userId: string;
  tier: StudyClawUsageTier;
  resetCredits?: boolean;
}) {
  const startingCredits = getTierStartingCredits(input.tier);
  await db.query(
    `insert into user_usage_profiles (user_id, tier, credits_total, credits_remaining)
     values ($1, $2, $3, $4)
     on conflict (user_id) do update set
       tier = excluded.tier,
       credits_total = case
         when $5::boolean then excluded.credits_total
         when user_usage_profiles.credits_total > 0 then user_usage_profiles.credits_total
         else excluded.credits_total
       end,
       credits_remaining = case
         when $5::boolean then excluded.credits_remaining
         when user_usage_profiles.credits_remaining > 0 then user_usage_profiles.credits_remaining
         else excluded.credits_remaining
       end,
       updated_at = now()`,
    [input.userId, input.tier, startingCredits, startingCredits, input.resetCredits ?? false]
  );

  return getUserUsageSnapshot(input.userId);
}

export async function assignTestingTier(input: {
  userId: string;
  tier: StudyClawUsageTier;
}) {
  return updateManagedUsageTier({
    userId: input.userId,
    tier: input.tier,
    resetCredits: true,
  });
}

export async function resolveManagedRuntimeCredential(input: {
  userId: string;
  modelKey: string;
}) {
  const profile = await getUserUsageProfile(input.userId);
  if (!profile || profile.billingMode !== 'managed' || !profile.usesManagedCredits || !profile.internalUsageIdentity) {
    return null;
  }

  if (!isManagedMiniMaxModelKey(input.modelKey)) {
    return null;
  }

  return {
    identity: profile.internalUsageIdentity,
    apiKey: buildManagedVirtualApiKey(profile.internalUsageIdentity),
    baseUrl: getManagedMiniMaxProxyBaseUrl(),
    providerId: MANAGED_MINIMAX_PROVIDER_ID,
  };
}

export function summarizeUsageWindow(input: {
  tier: StudyClawUsageTier;
  now: Date;
  events: Array<{ status: ManagedUsageEventStatus; reservedAt: string | Date; requestUnits?: number }>;
}) {
  const windowStart = input.now.getTime() - MANAGED_USAGE_WINDOW_HOURS * 60 * 60 * 1000;
  const activeEvents = input.events.filter((event) => {
    const reservedAt = new Date(event.reservedAt).getTime();
    return reservedAt >= windowStart && (event.status === 'reserved' || event.status === 'consumed');
  });
  const usedInWindow = activeEvents.reduce((sum, event) => sum + Math.max(1, event.requestUnits ?? 1), 0);
  const windowLimit = getTierLimit(input.tier);
  const earliest = activeEvents
    .map((event) => new Date(event.reservedAt).getTime())
    .sort((left, right) => left - right)[0];

  return {
    usedInWindow,
    windowLimit,
    remainingInWindow: Math.max(windowLimit - usedInWindow, 0),
    resetsAt: earliest ? new Date(earliest + MANAGED_USAGE_WINDOW_HOURS * 60 * 60 * 1000).toISOString() : null,
  };
}
