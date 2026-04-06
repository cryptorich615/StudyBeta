import { db } from './db';
import { buildBrowserProvider } from './browser-provider';
import { getBrowserConfig } from './browser-config';

export type BrowserSessionRecord = {
  id: string;
  userId: string;
  status: 'active' | 'ended';
  remoteUrl: string;
  launchUrl: string;
  embedUrl?: string | null;
  policySnapshot: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  endedAt: string | null;
};

export type BrowserCapabilityStatus = {
  enabled: boolean;
  available: boolean;
  canLaunch: boolean;
  provider: string;
  embedAllowed: boolean;
  timeoutMinutes: number;
  restrictionsEnabled: boolean;
  unavailableReason: string | null;
  activeSession: BrowserSessionRecord | null;
};

type BrowserSessionRow = {
  id: string;
  user_id: string;
  status: 'active' | 'ended';
  remote_url: string;
  embed_url: string | null;
  launch_url: string;
  policy_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  ended_at: string | null;
};

function mapSessionRow(row: BrowserSessionRow): BrowserSessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    status: row.status,
    remoteUrl: row.remote_url,
    embedUrl: row.embed_url ?? undefined,
    launchUrl: row.launch_url,
    policySnapshot: row.policy_snapshot ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    endedAt: row.ended_at,
  };
}

export function buildBrowserPolicy(userId: string) {
  const config = getBrowserConfig();
  // TODO: admin controls
  // TODO: audit logging
  const policy = {
    allowEmbed: config.embedAllowed,
    timeoutMinutes: config.timeoutMinutes,
    restrictionsEnabled: config.restrictionsEnabled,
  };
  return policy;
}

export function canUserLaunchBrowser(userId: string) {
  const config = getBrowserConfig();
  // TODO: browser restrictions
  if (!config.enabled) {
    return false;
  }
  return !config.restrictionsEnabled || true;
}

export async function enforceBrowserPolicy(sessionId: string, policy: Record<string, unknown>) {
  // TODO: website allowlist/blocklist
  return { permitted: true, policy };
}

export async function getActiveBrowserSession(userId: string): Promise<BrowserSessionRecord | null> {
  const result = await db.query(
    `select * from browser_sessions where user_id = $1 and status = 'active' order by created_at desc limit 1`,
    [userId]
  );
  const row = result.rows[0] as BrowserSessionRow | undefined;
  return row ? mapSessionRow(row) : null;
}

export async function startBrowserSession(userId: string) {
  const config = getBrowserConfig();
  if (!config.enabled || !config.baseUrl) {
    throw new Error(config.unavailableReason || 'Browser Access is unavailable.');
  }

  const provider = buildBrowserProvider(config);
  const policy = buildBrowserPolicy(userId);
  const sessionId = `browser-${Date.now()}`;
  const sessionInfo = await provider.buildSession(userId, sessionId, config);
  const result = await db.query(
    `insert into browser_sessions (user_id, status, remote_url, embed_url, launch_url, policy_snapshot)
     values ($1, 'active', $2, $3, $4, $5)
     returning *`,
    [userId, sessionInfo.remoteUrl, sessionInfo.embedUrl ?? null, sessionInfo.launchUrl, JSON.stringify(policy)]
  );
  const row = result.rows[0] as BrowserSessionRow;
  return {
    ...sessionInfo,
    ...mapSessionRow(row),
    policySnapshot: policy,
  };
}

export async function getOrCreateBrowserSession(userId: string) {
  const config = getBrowserConfig();
  if (!config.enabled) {
    throw new Error(config.unavailableReason || 'Browser Access is unavailable.');
  }

  const active = await getActiveBrowserSession(userId);
  if (active) {
    return active;
  }

  return startBrowserSession(userId);
}

export async function getBrowserCapabilityStatus(userId: string): Promise<BrowserCapabilityStatus> {
  const config = getBrowserConfig();
  const activeSession = config.enabled ? await getActiveBrowserSession(userId) : null;
  const canLaunch = config.enabled && canUserLaunchBrowser(userId);

  return {
    enabled: config.enabled,
    available: config.enabled && canLaunch,
    canLaunch,
    provider: config.provider,
    embedAllowed: config.embedAllowed,
    timeoutMinutes: config.timeoutMinutes,
    restrictionsEnabled: config.restrictionsEnabled,
    unavailableReason: config.enabled ? null : config.unavailableReason || 'Browser Access is not configured on this server yet.',
    activeSession,
  };
}
