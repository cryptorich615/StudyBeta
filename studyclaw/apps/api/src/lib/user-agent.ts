import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import {
  buildCoreTraitsMarkdown,
  buildIdentityMarkdown,
  getBootstrapIntro,
  mergeAgentConfig,
  resolveAgentPresetFromPersonaName,
} from './agent-config';

const execFileAsync = promisify(execFile);

const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? '/home/ubuntu/.openclaw';

type ListedAgent = {
  id: string;
  workspace?: string;
  agentDir?: string;
};

type AgentListResponse = {
  count?: number;
  agents?: ListedAgent[];
};

type OpenClawConfigFile = {
  agents?: {
    list?: Array<Record<string, unknown>>;
  };
};

type UserAgentModelsFile = {
  providers?: Record<
    string,
    {
      baseUrl?: string;
      api?: string;
      authHeader?: boolean;
      apiKey?: string;
      models?: Array<{
        id: string;
        name?: string;
        reasoning?: boolean;
        input?: string[];
        cost?: {
          input?: number;
          output?: number;
          cacheRead?: number;
          cacheWrite?: number;
        };
        contextWindow?: number;
        maxTokens?: number;
      }>;
    }
  >;
};

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

export function buildUserAgentId(userId: string) {
  return `student_${userId.replace(/-/g, '').slice(0, 12)}`;
}

export function getUserWorkspacePath(userId: string) {
  return join(OPENCLAW_HOME, `workspace-${buildUserAgentId(userId)}`);
}

export function getUserAgentRoot(userId: string) {
  return join(OPENCLAW_HOME, 'agents', buildUserAgentId(userId));
}

export function getUserAgentStateDir(userId: string) {
  return join(getUserAgentRoot(userId), 'agent');
}

export function buildAdminAgentId() {
  return process.env.STUDYCLAW_ADMIN_AGENT_ID ?? 'studyclaw_admin';
}

export function getAdminWorkspacePath() {
  return join(OPENCLAW_HOME, `workspace-${buildAdminAgentId()}`);
}

export function getAdminAgentRoot() {
  return getAdminWorkspacePath();
}

export function getAdminAgentStateDir() {
  return getAdminWorkspacePath();
}

async function listAgents() {
  const { stdout } = await execFileAsync('openclaw', ['agents', 'list', '--json'], {
    maxBuffer: 4 * 1024 * 1024,
  });
  return JSON.parse(extractJsonPayload(stdout)) as AgentListResponse;
}

async function syncOpenClawAgentModel(agentId: string, modelKey?: string) {
  if (!modelKey) {
    return;
  }

  const configPath = join(OPENCLAW_HOME, 'openclaw.json');
  const raw = await readFile(configPath, 'utf8');
  const config = JSON.parse(raw) as OpenClawConfigFile;
  const agents = config.agents?.list ?? [];
  const entry = agents.find((item) => item.id === agentId);

  if (!entry || entry.model === modelKey) {
    return;
  }

  entry.model = modelKey;
  config.agents = {
    ...(config.agents ?? {}),
    list: agents,
  };

  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

async function ensureWorkspaceBrowserSkill(workspacePath: string) {
  const skillPath = join(workspacePath, 'skills', 'openclaw-agent-browser');

  try {
    await readFile(join(skillPath, 'SKILL.md'), 'utf8');
    return;
  } catch {
    // install below
  }

  await mkdir(workspacePath, { recursive: true });

  try {
    await execFileAsync(
      'openclaw',
      ['skills', 'install', 'openclaw-agent-browser'],
      {
        cwd: workspacePath,
        maxBuffer: 8 * 1024 * 1024,
      }
    );
  } catch (error: any) {
    const message = String(error?.stderr ?? error?.message ?? '');
    if (!message.toLowerCase().includes('already exists')) {
      throw error;
    }
  }
}

async function syncStudentAgentBrowserAccess(agentId: string) {
  const configPath = join(OPENCLAW_HOME, 'openclaw.json');
  const raw = await readFile(configPath, 'utf8');
  const config = JSON.parse(raw) as OpenClawConfigFile;
  const agents = config.agents?.list ?? [];
  const entry = agents.find((item) => item.id === agentId) as
    | (Record<string, unknown> & {
        tools?: { alsoAllow?: unknown[] };
      })
    | undefined;

  if (!entry) {
    return;
  }

  const currentTools = Array.isArray(entry.tools?.alsoAllow)
    ? entry.tools!.alsoAllow.map((value) => String(value))
    : [];

  const nextTools = Array.from(new Set([...currentTools, 'browser']));
  entry.tools = {
    ...(entry.tools ?? {}),
    alsoAllow: nextTools.sort((left, right) => left.localeCompare(right)),
  };

  config.agents = {
    ...(config.agents ?? {}),
    list: agents,
  };

  await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
}

async function writeWorkspaceFiles(
  userId: string,
  email: string,
  options: {
    personaName?: string | null;
    tone?: string | null;
  } = {}
) {
  const workspacePath = getUserWorkspacePath(userId);
  const agentType = resolveAgentPresetFromPersonaName(options.personaName);
  const resolvedConfig = mergeAgentConfig(agentType, {
    personaName: options.personaName,
    tone: options.tone,
  });

  await mkdir(workspacePath, { recursive: true });
  await writeFile(
    join(workspacePath, 'USER.md'),
    [
      '# USER.md',
      '',
      `Primary email: ${email}`,
      `Internal StudyClaw user id: ${userId}`,
      'Preferred name: unknown until bootstrap chat',
      'School: unknown until bootstrap chat',
      'Timezone: unknown until bootstrap chat',
      '',
      'Bootstrap status: gather profile in the first chat naturally.',
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    join(workspacePath, 'IDENTITY.md'),
    buildIdentityMarkdown(resolvedConfig),
    'utf8'
  );

  await writeFile(
    join(workspacePath, 'BOOTSTRAP.md'),
    [
      '# BOOTSTRAP.md',
      '',
      `Your identity is already configured. Your name is ${resolvedConfig.personaName}.`,
      'Use the following voice as your opening anchor when the student first engages:',
      '',
      getBootstrapIntro(agentType),
      '',
      'Do not ask the student to decide your name or persona again.',
      'Use the configured identity consistently in every response.',
      'Focus your first conversation on understanding the student profile, immediate workload, and how to help with school work.',
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(join(workspacePath, 'CORE_TRAITS.md'), buildCoreTraitsMarkdown(), 'utf8');
}

async function writeAdminWorkspaceFiles(input: {
  workspacePath: string;
  ownerUserId: string;
  email: string;
}) {
  const adminIdentity = {
    personaName: 'StudyClaw Admin',
    role: 'Master platform administrator and policy authority',
    tone: 'precise, authoritative, security-aware, and operationally calm',
    mission: 'Protect platform integrity, keep student workspaces healthy, and enforce platform policy.',
    powers: [
      'Inspect platform-wide health, configuration, and recent system activity',
      'Bootstrap, repair, and reset student agents when the platform allows it',
      'Manage templates, policies, prompts, runtime defaults, and admin-approved automation',
      'Debug onboarding, auth, model routing, calendar integration, and workspace state',
      'Operate with cross-platform visibility that student agents never receive',
    ],
    rules: [
      'Admin is the only agent with full platform powers.',
      'Admin may inspect platform state across the system, but should expose student-specific data only when operationally necessary and explicitly relevant.',
      'Admin should prefer repair, rollback-safe changes, and auditability over risky intervention.',
      'Admin should think like an operator: identify root cause, blast radius, fix, verification, and follow-up.',
      'Admin must never act like a student coach unless explicitly helping diagnose the coaching stack.',
    ],
  };

  await mkdir(input.workspacePath, { recursive: true });

  await writeFile(
    join(input.workspacePath, 'IDENTITY.md'),
    [
      '# IDENTITY.md',
      '',
      `Name: ${adminIdentity.personaName}`,
      `Role: ${adminIdentity.role}`,
      `Tone: ${adminIdentity.tone}`,
      `Mission: ${adminIdentity.mission}`,
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    join(input.workspacePath, 'ADMIN.md'),
    [
      '# ADMIN.md',
      '',
      `Owner email: ${input.email}`,
      `Owner user id: ${input.ownerUserId}`,
      'Authority level: full platform administrator',
      'Scope: the complete StudyClaw platform and all admin-approved maintenance actions',
      '',
      '## Platform Powers',
      ...adminIdentity.powers.map((power) => `- ${power}`),
      '',
      '## Operating Rules',
      ...adminIdentity.rules.map((rule) => `- ${rule}`),
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    join(input.workspacePath, 'BOOTSTRAP.md'),
    [
      '# BOOTSTRAP.md',
      '',
      'You are already configured as the master StudyClaw admin agent.',
      'Do not ask anyone to choose your persona or authority level.',
      'Operate as the platform owner’s administrative agent with full system powers.',
      'Default to operational clarity: summarize the issue, diagnose the root cause, apply the safest fix, and verify the result.',
      'When reporting, prioritize: system status, root cause, impacted surface area, action taken, and any residual risk.',
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    join(input.workspacePath, 'OPERATIONS.md'),
    [
      '# OPERATIONS.md',
      '',
      '## Admin Priorities',
      '- Keep auth, onboarding, chat, study tools, calendar, and reminders operational.',
      '- Preserve student isolation and never leak data casually across users.',
      '- Treat migrations, model settings, and workspace state as production-sensitive surfaces.',
      '',
      '## Response Pattern',
      '- Triage the failure mode quickly.',
      '- Name the likely root cause and affected subsystem.',
      '- Prefer deterministic fixes and verifiable checks.',
      '- Report what changed and what still needs attention.',
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    join(input.workspacePath, 'POWERS.md'),
    [
      '# POWERS.md',
      '',
      'Admin is the only agent with all platform powers.',
      '',
      '## Allowed Powers',
      '- Cross-system operational visibility',
      '- Agent bootstrap and reset authority',
      '- Policy, template, and prompt governance',
      '- Runtime and model configuration maintenance',
      '- Platform debugging and incident response',
      '',
      '## Non-Negotiable Restraints',
      '- Do not abuse admin authority for non-educational or non-operational work.',
      '- Do not expose sensitive student data unless required for a real operational task.',
      '- Do not fabricate state, metrics, or outcomes. Verify before claiming.',
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(join(input.workspacePath, 'CORE_TRAITS.md'), buildCoreTraitsMarkdown(), 'utf8');
}

async function ensureEmptyAuthStore(agentStateDir: string) {
  await mkdir(agentStateDir, { recursive: true });

  const authProfilesPath = join(agentStateDir, 'auth-profiles.json');
  const modelsPath = join(agentStateDir, 'models.json');

  try {
    await readFile(authProfilesPath, 'utf8');
  } catch {
    await writeFile(
      authProfilesPath,
      JSON.stringify({ version: 1, profiles: {}, usageStats: {} }, null, 2),
      'utf8'
    );
  }

  try {
    await readFile(modelsPath, 'utf8');
  } catch {
    await writeFile(modelsPath, JSON.stringify({ providers: {} }, null, 2), 'utf8');
  }
}

export async function ensurePersonalAgent(input: {
  userId: string;
  email: string;
  modelKey?: string;
  personaName?: string | null;
  tone?: string | null;
}) {
  const agentId = buildUserAgentId(input.userId);
  const workspacePath = getUserWorkspacePath(input.userId);
  const agentStateDir = getUserAgentStateDir(input.userId);
  const existing = (await listAgents()).agents?.find((agent) => agent.id === agentId);

  if (!existing) {
    try {
      await execFileAsync(
        'openclaw',
        [
          'agents',
          'add',
          agentId,
          '--workspace',
          workspacePath,
          '--agent-dir',
          agentStateDir,
          '--model',
          input.modelKey ?? process.env.OPENCLAW_DEFAULT_MODEL ?? 'openrouter/auto',
          '--non-interactive',
          '--json',
        ],
        { maxBuffer: 4 * 1024 * 1024 }
      );
    } catch (error: any) {
      const message = error?.stderr ?? error?.message ?? '';
      if (!String(message).includes('already exists')) {
        throw error;
      }
    }
  }

  await ensureEmptyAuthStore(agentStateDir);
  await ensureWorkspaceBrowserSkill(workspacePath);
  await syncOpenClawAgentModel(agentId, input.modelKey);
  await syncStudentAgentBrowserAccess(agentId);
  await writeWorkspaceFiles(input.userId, input.email, {
    personaName: input.personaName,
    tone: input.tone,
  });

  return {
    agentId,
    workspacePath,
    agentStateDir,
  };
}

export async function ensureAdminAgent(input: {
  ownerUserId: string;
  email: string;
  modelKey?: string;
}) {
  const agentId = buildAdminAgentId();
  const workspacePath = getAdminWorkspacePath();
  const agentStateDir = workspacePath;
  const existing = (await listAgents()).agents?.find((agent) => agent.id === agentId);

  if (!existing) {
    try {
      await execFileAsync(
        'openclaw',
        [
          'agents',
          'add',
          agentId,
          '--workspace',
          workspacePath,
          '--agent-dir',
          workspacePath,
          '--model',
          input.modelKey ?? process.env.OPENCLAW_DEFAULT_MODEL ?? 'openrouter/auto',
          '--non-interactive',
          '--json',
        ],
        { maxBuffer: 4 * 1024 * 1024 }
      );
    } catch (error: any) {
      const message = error?.stderr ?? error?.message ?? '';
      if (!String(message).includes('already exists')) {
        throw error;
      }
    }
  }

  await syncOpenClawAgentModel(agentId, input.modelKey);
  await mkdir(workspacePath, { recursive: true });
  await ensureEmptyAuthStore(agentStateDir);
  await writeAdminWorkspaceFiles({
    workspacePath,
    ownerUserId: input.ownerUserId,
    email: input.email,
  });

  return {
    openclawAgentId: agentId,
    workspacePath,
    agentStateDir,
  };
}

export async function bindUserAgentCredential(input: {
  userId: string;
  provider: string;
  apiKey: string;
}) {
  const authProfilesPath = join(getUserAgentStateDir(input.userId), 'auth-profiles.json');
  const authRaw = await readFile(authProfilesPath, 'utf8');
  const authData = JSON.parse(authRaw) as {
    version?: number;
    profiles?: Record<string, { type: string; provider: string; key: string }>;
    lastGood?: Record<string, string>;
    usageStats?: Record<string, { errorCount: number; lastUsed?: number }>;
  };

  const profileId = `${input.provider}:default`;

  authData.version = 1;
  authData.profiles = authData.profiles ?? {};
  authData.lastGood = authData.lastGood ?? {};
  authData.usageStats = authData.usageStats ?? {};
  authData.profiles[profileId] = {
    type: 'api_key',
    provider: input.provider,
    key: input.apiKey,
  };
  authData.lastGood[input.provider] = profileId;
  authData.usageStats[profileId] = authData.usageStats[profileId] ?? { errorCount: 0 };

  await writeFile(authProfilesPath, JSON.stringify(authData, null, 2), 'utf8');
}

export async function upsertUserAgentModelProvider(input: {
  userId: string;
  provider: string;
  baseUrl: string;
  apiType: string;
  authHeader?: boolean;
  apiKey?: string | null;
  modelName: string;
  maxContextWindow?: number | null;
  maxOutputTokens?: number | null;
}) {
  const modelsPath = join(getUserAgentStateDir(input.userId), 'models.json');
  const modelsRaw = await readFile(modelsPath, 'utf8');
  const modelsData = JSON.parse(modelsRaw) as UserAgentModelsFile;
  const providerEntry = modelsData.providers?.[input.provider] ?? {};
  const existingModels = providerEntry.models ?? [];
  const nextModel = {
    id: input.modelName,
    name: input.modelName,
    reasoning: false,
    input: ['text'],
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    },
    contextWindow: input.maxContextWindow ?? 128000,
    maxTokens: input.maxOutputTokens ?? 8192,
  };

  const nextModels = [
    nextModel,
    ...existingModels.filter((model) => model.id !== input.modelName),
  ];

  modelsData.providers = modelsData.providers ?? {};
  modelsData.providers[input.provider] = {
    ...providerEntry,
    baseUrl: input.baseUrl,
    api: input.apiType,
    ...(input.authHeader ? { authHeader: true } : {}),
    ...(input.apiKey ? { apiKey: input.apiKey } : {}),
    models: nextModels,
  };

  await writeFile(modelsPath, JSON.stringify(modelsData, null, 2), 'utf8');
}

export async function syncUserWorkspaceProfile(input: {
  userId: string;
  email: string;
  studentName?: string | null;
  schoolName?: string | null;
  gradeYear?: string | null;
  timezone?: string | null;
  learningStyle?: string | null;
  subjects?: string[];
}) {
  const workspacePath = getUserWorkspacePath(input.userId);
  await mkdir(workspacePath, { recursive: true });

  await writeFile(
    join(workspacePath, 'USER.md'),
    [
      '# USER.md',
      '',
      `Preferred name: ${input.studentName ?? 'unknown'}`,
      `Primary email: ${input.email}`,
      `School: ${input.schoolName ?? 'unknown'}`,
      `Grade / year: ${input.gradeYear ?? 'unknown'}`,
      `Timezone: ${input.timezone ?? 'unknown'}`,
      `Learning style: ${input.learningStyle ?? 'unknown'}`,
      `Courses: ${(input.subjects ?? []).length ? input.subjects!.join(', ') : 'unknown'}`,
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    join(workspacePath, 'SOUL.md'),
    [
      '# SOUL.md',
      '',
      'Role: personal StudyClaw agent for one student only.',
      'Boundaries:',
      '- Stay isolated to this student workspace.',
      '- Do not mix another student\'s data or memory into this agent.',
      '- Personalize advice using the user profile and course list in this workspace.',
      '',
      'Current student context:',
      `- Student: ${input.studentName ?? 'unknown'}`,
      `- School: ${input.schoolName ?? 'unknown'}`,
      `- Grade / year: ${input.gradeYear ?? 'unknown'}`,
      `- Courses: ${(input.subjects ?? []).length ? input.subjects!.join(', ') : 'unknown'}`,
      '',
    ].join('\n'),
    'utf8'
  );
}

export async function syncUserWorkspaceIdentity(input: {
  userId: string;
  email: string;
  personaName?: string | null;
  tone?: string | null;
}) {
  await writeWorkspaceFiles(input.userId, input.email, {
    personaName: input.personaName,
    tone: input.tone,
  });
}
