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
  bindings?: Array<Record<string, unknown>>;
  agents?: {
    list?: Array<Record<string, unknown>>;
  };
};

type TelegramPersonaKey = 'quick_start_1' | 'quick_start_2';

type TelegramPersonaBinding = {
  personaKey: TelegramPersonaKey;
  personaName: string;
  accountId: 'dixie' | 'willow';
  botUsername: string;
};

type PairingRequestRecord = {
  id?: string;
  code?: string;
  createdAt?: string;
  lastSeenAt?: string;
  meta?: Record<string, string>;
};

type PairingListResponse = {
  requests?: PairingRequestRecord[];
};

type RoutingBinding = {
  type?: string;
  agentId?: string;
  match?: {
    channel?: string;
    accountId?: string;
    peer?: {
      kind?: string;
      id?: string;
    };
  };
};

const TELEGRAM_PERSONA_BINDINGS: Record<TelegramPersonaKey, TelegramPersonaBinding> = {
  quick_start_1: {
    personaKey: 'quick_start_1',
    personaName: 'Dixie',
    accountId: 'dixie',
    botUsername: '@DixieGirlBot',
  },
  quick_start_2: {
    personaKey: 'quick_start_2',
    personaName: 'Willow',
    accountId: 'willow',
    botUsername: '@WillieWillowBot',
  },
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

type CronJobRecord = Record<string, any> & {
  id?: string;
  jobId?: string;
  agentId?: string;
};

type CronListResponse = {
  jobs?: CronJobRecord[];
};

const SKILL_PRESENTATION_MAP: Record<string, { label: string; description?: string }> = {
  'study-library': {
    label: 'Student library',
    description: 'Book discovery, textbook lookup, and reading-oriented research using Open Library first.',
  },
  'grade-tracker': {
    label: 'Grade tracker',
    description: 'Estimated grades, target-score math, and wrong-answer review grounded in saved class data.',
  },
  'class-scheduler': {
    label: 'Class scheduler',
    description: 'Current class, next class, room, teacher, and schedule-aware tutoring context.',
  },
  'study-habits': {
    label: 'Study habits',
    description: 'Routine, focus, and consistency coaching tied to the student’s real workload.',
  },
  'study-buddy-ai': {
    label: 'Study buddy AI',
    description: 'General-purpose study companion behavior that turns conversation into useful actions.',
  },
  'study-tutor': {
    label: 'Study tutor',
    description: 'Step-by-step explanations, examples, misconceptions, and guided practice.',
  },
  'course-study': {
    label: 'Course study',
    description: 'Course-specific study planning using grades, assignments, schedule, and weak-topic context.',
  },
  'study-buddy': {
    label: 'Study buddy',
    description: 'Short, practical accountability support to keep students moving through work.',
  },
  'study-revision-planner': {
    label: 'Revision planner',
    description: 'Exam and revision plans built from real deadlines, weak topics, and available time.',
  },
  'learn-cog': {
    label: 'Learn cog',
    description: 'Multi-angle teaching with analogies, examples, and layered explanations.',
  },
  exam: {
    label: 'Exam prep',
    description: 'Exam-focused prioritization, last-minute review plans, and risk-aware prep advice.',
  },
  'learning-optimizer': {
    label: 'Learning optimizer',
    description: 'Uses saved student data to improve study order, time use, and review strategy.',
  },
  'google-workspace': {
    label: 'Google workspace',
    description: 'Uses StudyClaw’s connected Google account for calendar, Drive, Docs, Sheets, and Slides context.',
  },
};

function stripAnsi(value: string) {
  return value.replace(
    // eslint-disable-next-line no-control-regex
    /\u001b\[[0-9;]*m/g,
    ''
  );
}

function extractJsonPayload(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('OpenClaw returned an empty response');
  }

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char !== '{' && char !== '[') {
      continue;
    }

    if (char === '[' && trimmed.slice(index, index + 9) === '[plugins]') {
      continue;
    }

    const candidate = extractBalancedJson(trimmed, index);
    if (!candidate) {
      continue;
    }

    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  throw new Error('OpenClaw did not return parsable JSON');
}

function extractBalancedJson(value: string, startIndex: number) {
  const opener = value[startIndex];
  const closer = opener === '{' ? '}' : opener === '[' ? ']' : null;
  if (!closer) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === opener) {
      depth += 1;
      continue;
    }

    if (char === closer) {
      depth -= 1;
      if (depth === 0) {
        return value.slice(startIndex, index + 1);
      }
    }
  }

  return null;
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

function getRoutingBindings(config: OpenClawConfig) {
  return Array.isArray(config.bindings) ? (config.bindings as RoutingBinding[]) : [];
}

function getAgentSkillFilter(config: OpenClawConfig, agentId: string) {
  const entry = getAgentEntry(config, agentId);
  return Array.isArray(entry?.skills) ? entry.skills.map((value) => String(value)) : null;
}

async function runOpenClaw(args: string[]) {
  const commandEnv = { ...process.env };
  delete commandEnv.NODE_TLS_REJECT_UNAUTHORIZED;

  try {
    const { stdout, stderr } = await execFileAsync('openclaw', args, {
      cwd: OPENCLAW_HOME,
      env: {
        ...commandEnv,
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

async function runOpenClawOrThrow(args: string[]) {
  const result = await runOpenClaw(args);
  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || 'OpenClaw command failed');
  }

  return result;
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
  })).map((item) => {
    const presentation = SKILL_PRESENTATION_MAP[item.name];
    return {
      ...item,
      displayName: presentation?.label ?? item.name,
      description: presentation?.description ?? item.description,
    };
  });

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

export function resolveTelegramPersonaBinding(agentPreset?: string | null) {
  if (agentPreset === 'quick_start_1' || agentPreset === 'quick_start_2') {
    return TELEGRAM_PERSONA_BINDINGS[agentPreset];
  }

  return null;
}

function listTelegramBindingsForAgent(config: OpenClawConfig, agentId: string, accountId: string) {
  return getRoutingBindings(config).filter((binding) => {
    const type = String(binding.type ?? 'route');
    const peer = binding.match?.peer;

    return (
      type === 'route' &&
      binding.agentId === agentId &&
      binding.match?.channel === 'telegram' &&
      String(binding.match?.accountId ?? '') === accountId &&
      peer?.kind === 'direct' &&
      !!peer.id
    );
  });
}

async function validateAndWriteOpenClawConfig(nextConfig: OpenClawConfig, previousRaw?: string) {
  const serialized = `${JSON.stringify(nextConfig, null, 2)}\n`;
  await writeFile(OPENCLAW_CONFIG_PATH, serialized, 'utf8');

  const validation = await runOpenClaw(['config', 'validate']);
  if (!validation.ok) {
    if (typeof previousRaw === 'string') {
      await writeFile(OPENCLAW_CONFIG_PATH, previousRaw, 'utf8');
    }
    throw new Error(validation.stderr || validation.stdout || 'OpenClaw config validation failed');
  }
}

async function upsertTelegramPeerBinding(input: {
  userId: string;
  accountId: 'dixie' | 'willow';
  peerId: string;
}) {
  const agentId = buildUserAgentId(input.userId);
  const previousRaw = await readFile(OPENCLAW_CONFIG_PATH, 'utf8');
  const config = JSON.parse(previousRaw) as OpenClawConfig;
  const existingBindings = getRoutingBindings(config);

  const keptBindings = existingBindings.filter((binding) => {
    const type = String(binding.type ?? 'route');
    if (type !== 'route') {
      return true;
    }

    if (binding.match?.channel !== 'telegram' || binding.match?.peer?.kind !== 'direct') {
      return true;
    }

    const bindingPeerId = String(binding.match?.peer?.id ?? '');
    const bindingAccountId = String(binding.match?.accountId ?? '');
    const bindingAgentId = String(binding.agentId ?? '');

    if (bindingAgentId === agentId) {
      return false;
    }

    if (bindingAccountId === input.accountId && bindingPeerId === input.peerId) {
      return false;
    }

    return true;
  });

  config.bindings = [
    {
      agentId,
      match: {
        channel: 'telegram',
        accountId: input.accountId,
        peer: {
          kind: 'direct',
          id: input.peerId,
        },
      },
    },
    ...keptBindings,
  ];

  await validateAndWriteOpenClawConfig(config, previousRaw);
}

export async function getUserTelegramSettings(input: {
  userId: string;
  agentPreset?: string | null;
}) {
  const personaBinding = resolveTelegramPersonaBinding(input.agentPreset);
  if (!personaBinding) {
    return {
      available: false,
      message: 'Telegram pairing is available after choosing Dixie or Willow.',
    };
  }

  const agentId = buildUserAgentId(input.userId);
  const config = await readJsonFile<OpenClawConfig>(OPENCLAW_CONFIG_PATH, {});
  const telegramChannel = (config.channels?.telegram ?? {}) as Record<string, unknown>;
  const telegramAccounts = (telegramChannel.accounts ?? {}) as Record<string, Record<string, unknown>>;
  const accountConfig = telegramAccounts[personaBinding.accountId] ?? {};
  const bindings = listTelegramBindingsForAgent(config, agentId, personaBinding.accountId);

  return {
    available: true,
    personaKey: personaBinding.personaKey,
    personaName: personaBinding.personaName,
    accountId: personaBinding.accountId,
    botUsername: personaBinding.botUsername,
    channelEnabled: telegramChannel.enabled === true,
    accountConfigured: Boolean(accountConfig.botToken),
    dmPolicy: String(accountConfig.dmPolicy ?? telegramChannel.dmPolicy ?? 'pairing'),
    paired: bindings.length > 0,
    boundPeerId: String(bindings[0]?.match?.peer?.id ?? ''),
  };
}

export async function approveUserTelegramPairing(input: {
  userId: string;
  agentPreset?: string | null;
  code: string;
}) {
  const personaBinding = resolveTelegramPersonaBinding(input.agentPreset);
  if (!personaBinding) {
    throw new Error('Telegram pairing is only available for Dixie or Willow.');
  }

  const normalizedCode = input.code.trim().toUpperCase();
  if (!normalizedCode) {
    throw new Error('Pairing code is required.');
  }

  const pendingResult = await runOpenClawOrThrow([
    'pairing',
    'list',
    'telegram',
    '--account',
    personaBinding.accountId,
    '--json',
  ]);
  const pending = JSON.parse(extractJsonPayload(pendingResult.stdout || '{}')) as PairingListResponse;
  const request = (pending.requests ?? []).find(
    (entry) => String(entry.code ?? '').trim().toUpperCase() === normalizedCode
  );

  if (!request?.id) {
    throw new Error('That Telegram pairing code was not found or has expired.');
  }

  await runOpenClawOrThrow([
    'pairing',
    'approve',
    'telegram',
    normalizedCode,
    '--account',
    personaBinding.accountId,
    '--notify',
  ]);

  await upsertTelegramPeerBinding({
    userId: input.userId,
    accountId: personaBinding.accountId,
    peerId: String(request.id),
  });

  return getUserTelegramSettings(input);
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
  const sessionsJson = sessionsResult.ok ? (JSON.parse(extractJsonPayload(sessionsResult.stdout || '{}')) as SessionsResponse) : { sessions: [] };
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

  const ownCronJobs = (cronFile.jobs ?? []).filter((job: CronJobRecord) => {
    if (!job?.agentId) {
      return true;
    }

    return job.agentId === agentId;
  });

  return {
    generatedAt: new Date().toISOString(),
    channels,
    sessions: ownSessions,
    usage,
    cron: {
      jobs: ownCronJobs,
      status: ownCronJobs.length ? 'Configured' : 'No jobs configured',
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

export async function createOpenClawCronJob(input: {
  userId: string;
  name: string;
  message: string;
  scheduleKind: 'at' | 'cron' | 'every';
  scheduleValue: string;
  timezone?: string;
}) {
  const args = ['cron', 'add', '--json', '--agent', buildUserAgentId(input.userId), '--session', 'isolated', '--no-deliver', '--name', input.name, '--message', input.message];

  if (input.scheduleKind === 'at') {
    args.push('--at', input.scheduleValue);
  } else if (input.scheduleKind === 'every') {
    args.push('--every', input.scheduleValue);
  } else {
    args.push('--cron', input.scheduleValue);
    if (input.timezone?.trim()) {
      args.push('--tz', input.timezone.trim());
    }
  }

  await runOpenClawOrThrow(args);

  return getOpenClawSettingsSnapshot(input.userId);
}

export async function deleteOpenClawCronJob(input: { userId: string; jobId: string }) {
  const listResult = await runOpenClawOrThrow(['cron', 'list', '--json']);
  const parsed = JSON.parse(extractJsonPayload(listResult.stdout || '{}')) as CronListResponse;
  const ownAgentId = buildUserAgentId(input.userId);
  const targetJob = (parsed.jobs ?? []).find((job) => {
    const jobId = String(job.jobId ?? job.id ?? '');
    if (jobId !== input.jobId) {
      return false;
    }

    return !job.agentId || job.agentId === ownAgentId;
  });

  if (!targetJob) {
    throw new Error(`Cron job ${input.jobId} not found for this user`);
  }

  await runOpenClawOrThrow(['cron', 'rm', '--json', input.jobId]);

  return getOpenClawSettingsSnapshot(input.userId);
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
