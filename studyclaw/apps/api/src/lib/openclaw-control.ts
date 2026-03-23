import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { buildUserAgentId } from './user-agent';

const execFileAsync = promisify(execFile);
const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? '/home/ubuntu/.openclaw';
const OPENCLAW_CONFIG_PATH = join(OPENCLAW_HOME, 'openclaw.json');
const CRON_JOBS_PATH = join(OPENCLAW_HOME, 'cron', 'jobs.json');
const GATEWAY_LOG_PATH = join(OPENCLAW_HOME, 'gateway.log');

type OpenClawConfig = {
  channels?: Record<string, Record<string, unknown>>;
  agents?: {
    list?: Array<Record<string, unknown>>;
  };
};

type SessionRecord = {
  key?: string;
  updatedAt?: number;
  ageMs?: number;
  sessionId?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  model?: string;
  modelProvider?: string;
  agentId?: string;
  kind?: string;
};

type SessionsResponse = {
  sessions?: SessionRecord[];
};

type CronJobsFile = {
  jobs?: Array<Record<string, unknown>>;
};

function stripAnsi(value: string) {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    ''
  );
}

function normalizeChannelConfig(config: Record<string, unknown> | undefined) {
  if (!config) {
    return {
      enabled: false,
      authConfigured: false,
      settings: [] as Array<{ key: string; value: string }>,
    };
  }

  const safeSettings = Object.entries(config)
    .filter(([key]) => !/(token|secret|password|key|cookie|auth)/i.test(key))
    .map(([key, value]) => ({
      key,
      value: Array.isArray(value) ? value.join(', ') : String(value),
    }));

  const authConfigured = Object.keys(config).some((key) => /(token|secret|password|cookie|auth)/i.test(key));

  return {
    enabled: config.enabled === true,
    authConfigured,
    settings: safeSettings,
  };
}

function getAgentEntry(config: OpenClawConfig, agentId: string) {
  return (config.agents?.list ?? []).find((entry) => entry.id === agentId);
}

function getAgentSkillFilter(config: OpenClawConfig, agentId: string) {
  const entry = getAgentEntry(config, agentId);
  return Array.isArray(entry?.skills) ? entry.skills.map((value) => String(value)) : null;
}

async function runOpenClaw(args: string[]) {
  try {
    const { stdout, stderr } = await execFileAsync('openclaw', args, {
      cwd: OPENCLAW_HOME,
      env: {
        ...process.env,
        NO_COLOR: '1',
        FORCE_COLOR: '0',
      },
      timeout: 12_000,
      maxBuffer: 4 * 1024 * 1024,
    });

    return {
      ok: true,
      stdout: stripAnsi(stdout).trim(),
      stderr: stripAnsi(stderr).trim(),
    };
  } catch (error: any) {
    return {
      ok: false,
      stdout: stripAnsi(error?.stdout ?? '').trim(),
      stderr: stripAnsi(error?.stderr ?? error?.message ?? 'Unknown error').trim(),
    };
  }
}

async function readJsonFile<T>(path: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function parseSkillRows(output: string) {
  const lines = output.split('\n');
  const skillCountMatch = output.match(/Skills \((\d+)\/(\d+) ready\)/);
  const tableRows = lines
    .filter((line) => line.startsWith('│'))
    .map((line) => line.split('│').slice(1, -1).map((part) => part.trim()))
    .filter((parts) => parts.length >= 4);

  const mergedRows: Array<{ status: string; name: string; description: string; source: string }> = [];

  for (const parts of tableRows) {
    const [statusRaw, skillRaw, descriptionRaw, sourceRaw] = parts;

    if (statusRaw === 'Status' || skillRaw === 'Skill') {
      continue;
    }

    if (statusRaw) {
      const status = statusRaw.startsWith('✓') ? 'ready' : statusRaw.startsWith('✗') ? 'missing' : 'unknown';
      mergedRows.push({
        status,
        name: skillRaw,
        description: descriptionRaw,
        source: sourceRaw,
      });
      continue;
    }

    const current = mergedRows[mergedRows.length - 1];
    if (!current) {
      continue;
    }

    if (skillRaw) {
      current.name = `${current.name}${skillRaw}`.trim();
    }

    if (descriptionRaw) {
      current.description = `${current.description} ${descriptionRaw}`.trim();
    }

    if (sourceRaw && !current.source) {
      current.source = sourceRaw;
    }
  }

  const items = mergedRows.map((item) => ({
    ...item,
    name: item.name.replace(/^[^\w]+/, '').trim(),
  }));

  return {
    readyCount: skillCountMatch ? Number(skillCountMatch[1]) : items.filter((item) => item.status === 'ready').length,
    totalCount: skillCountMatch ? Number(skillCountMatch[2]) : items.length,
    items,
  };
}

function summarizeUsage(sessions: SessionRecord[]) {
  const usage = sessions.reduce<{ inputTokens: number; outputTokens: number; totalTokens: number }>(
    (acc, session) => {
      acc.inputTokens += session.inputTokens ?? 0;
      acc.outputTokens += session.outputTokens ?? 0;
      acc.totalTokens += session.totalTokens ?? 0;
      return acc;
    },
    { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  );

  const models = Array.from(
    sessions.reduce((acc, session) => {
      const key = session.model ?? 'unknown';
      const current = acc.get(key) ?? { model: key, sessions: 0, totalTokens: 0 };
      current.sessions += 1;
      current.totalTokens += session.totalTokens ?? 0;
      acc.set(key, current);
      return acc;
    }, new Map<string, { model: string; sessions: number; totalTokens: number }>())
  )
    .map(([, value]) => value)
    .sort((left, right) => right.totalTokens - left.totalTokens)
    .slice(0, 5);

  return {
    ...usage,
    models,
  };
}

function tailLines(value: string, limit: number) {
  return value
    .split('\n')
    .filter(Boolean)
    .slice(-limit);
}

function sanitizeLogLine(line: string) {
  return line
    .replace(/([A-Za-z0-9_-]{20,}:[A-Za-z0-9_-]{20,})/g, '[redacted-token]')
    .replace(/("token"\s*:\s*")[^"]+(")/gi, '$1[redacted]$2')
    .replace(/(token=)[^\s]+/gi, '$1[redacted]');
}

function parseCapabilities(output: string) {
  const supportLine = output.split('\n').find((line) => line.startsWith('Support:'));
  const actionsLine = output.split('\n').find((line) => line.startsWith('Actions:'));
  const probeLine = output.split('\n').find((line) => line.startsWith('Probe:'));
  return {
    support: supportLine ? supportLine.replace(/^Support:\s*/, '').split(/\s+/).filter(Boolean) : [],
    actions: actionsLine ? actionsLine.replace(/^Actions:\s*/, '').split(',').map((value) => value.trim()).filter(Boolean) : [],
    probe: probeLine ? probeLine.replace(/^Probe:\s*/, '').trim() : 'Unavailable',
  };
}

export async function getOpenClawSettingsSnapshot(userId: string) {
  const [config, sessionsResult, skillsResult, cronFile, gatewayLog, capabilitiesResult] = await Promise.all([
    readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH, {}),
    runOpenClaw(['sessions', '--all-agents', '--json']),
    runOpenClaw(['skills', 'list']),
    readJsonFile<CronJobsFile>(CRON_JOBS_PATH, { jobs: [] }),
    readFile(GATEWAY_LOG_PATH, 'utf8').catch(() => ''),
    runOpenClaw(['channels', 'capabilities']),
  ]);

  const agentId = buildUserAgentId(userId);
  const agentSkillFilter = getAgentSkillFilter(config, agentId);
  const sessionsJson = sessionsResult.ok ? (JSON.parse(sessionsResult.stdout || '{}') as SessionsResponse) : { sessions: [] };
  const ownSessions = (sessionsJson.sessions ?? [])
    .filter((session) => session.agentId === agentId)
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const usage = summarizeUsage(ownSessions);
  const skillData = parseSkillRows(skillsResult.stdout);
  const capabilities = parseCapabilities(capabilitiesResult.stdout);

  const channelIds = ['telegram', 'discord', 'whatsapp'];
  const channels = channelIds.map((channelId) => {
    const normalized = normalizeChannelConfig(config.channels?.[channelId]);
    const channelCapabilities = channelId === 'telegram' ? capabilities : { support: [], actions: [], probe: 'Not configured' };
    return {
      id: channelId,
      label: channelId[0].toUpperCase() + channelId.slice(1),
      ...normalized,
      capabilities: channelCapabilities,
    };
  });

  const logs = tailLines(gatewayLog, 60).map((line) => ({ line: sanitizeLogLine(line) }));

  const skills = {
    ...skillData,
    items: skillData.items.map((item) => ({
      ...item,
      enabled: agentSkillFilter ? agentSkillFilter.includes(item.name) : true,
    })),
  };

  return {
    generatedAt: new Date().toISOString(),
    channels,
    sessions: ownSessions,
    usage,
    cron: {
      jobs: cronFile.jobs ?? [],
      status: (cronFile.jobs ?? []).length ? 'Configured' : 'No jobs configured',
    },
    skills,
    logs: {
      source: GATEWAY_LOG_PATH,
      lines: logs,
    },
    diagnostics: {
      sessionsOk: sessionsResult.ok,
      skillsOk: skillsResult.ok,
      channelsProbe: capabilitiesResult.ok ? capabilities.probe : capabilitiesResult.stderr || 'Unavailable',
    },
  };
}

export async function updateOpenClawSkillToggle(input: {
  userId: string;
  skillName: string;
  enabled: boolean;
}) {
  const config = await readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH, {});
  const agentId = buildUserAgentId(input.userId);
  const agentEntries = config.agents?.list ?? [];
  const agentEntry = agentEntries.find((entry) => entry.id === agentId);

  if (!agentEntry) {
    throw new Error(`Personal agent ${agentId} not found`);
  }

  const snapshot = await getOpenClawSettingsSnapshot(input.userId);
  const allSkillNames = snapshot.skills.items.map((item) => item.name);
  if (!allSkillNames.includes(input.skillName)) {
    throw new Error(`Unknown skill: ${input.skillName}`);
  }

  const currentFilter = Array.isArray(agentEntry.skills) ? agentEntry.skills.map((value) => String(value)) : allSkillNames;
  const nextFilter = input.enabled
    ? Array.from(new Set([...currentFilter, input.skillName]))
    : currentFilter.filter((name) => name !== input.skillName);

  agentEntry.skills = nextFilter.sort((left, right) => left.localeCompare(right));

  config.agents = {
    ...(config.agents ?? {}),
    list: agentEntries,
  };

  await writeFile(OPENCLAW_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

  return getOpenClawSettingsSnapshot(input.userId);
}
