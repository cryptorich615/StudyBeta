import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { buildCoreTraitsMarkdown } from './agent-config';

const OPENCLAW_HOME = process.env.OPENCLAW_HOME ?? '/home/martinez_a_richard/.openclaw';

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
  return join(OPENCLAW_HOME, 'agents', buildAdminAgentId());
}

export function getAdminAgentStateDir() {
  return join(getAdminAgentRoot(), 'agent');
}

async function listAgents(): Promise<AgentListResponse> {
  const configPath = join(OPENCLAW_HOME, 'openclaw.json');
  const raw = await readFile(configPath, 'utf8');
  const config = JSON.parse(raw) as OpenClawConfigFile;
  const list = config.agents?.list ?? [];
  const agents: ListedAgent[] = list.map((item: Record<string, unknown>) => ({
    id: item.id as string,
    agentDir: item.agentDir as string | undefined,
  }));
  return { count: agents.length, agents };
}

async function addAgentToOpenClawConfig(agent: Record<string, unknown>) {
  const configPath = join(OPENCLAW_HOME, 'openclaw.json');
  const raw = await readFile(configPath, 'utf8');
  const config = JSON.parse(raw) as OpenClawConfigFile;
  const list = config.agents?.list ?? [];
  if (!list.find((a) => a.id === agent.id)) {
    list.push(agent);
    config.agents = { ...config.agents, list };
    await writeFile(configPath, JSON.stringify(config, null, 2), 'utf8');
  }
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

function getPersonaIdentity(personaName?: string | null, tone?: string | null) {
  const normalized = personaName?.trim().toLowerCase();

  if (normalized === 'willow') {
    return {
      name: 'Willow',
      creature: 'calm study guide',
      vibe: 'calm, thoughtful, and steady',
      emoji: '🌿',
    };
  }

  if (normalized === 'dixie') {
    return {
      name: 'Dixie',
      creature: 'sprint study coach',
      vibe: 'energetic, direct, and motivating',
      emoji: '⚡',
    };
  }

  return {
    name: personaName?.trim() || 'StudyClaw',
    creature: 'student study coach',
    vibe: tone?.trim() || 'calm, practical, supportive',
    emoji: '📚',
  };
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
  const identity = getPersonaIdentity(options.personaName, options.tone);

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
    [
      '# IDENTITY.md',
      '',
      `Name: ${identity.name}`,
      `Creature: ${identity.creature}`,
      `Vibe: ${identity.vibe}`,
      `Emoji: ${identity.emoji}`,
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(
    join(workspacePath, 'BOOTSTRAP.md'),
    [
      '# BOOTSTRAP.md',
      '',
      `Your identity is already configured. Your name is ${identity.name}.`,
      `Your role is ${identity.creature}.`,
      `Your vibe is ${identity.vibe}.`,
      '',
      'Do not ask the student to decide your name or persona again.',
      'Use the configured identity consistently in every response.',
      'Focus your first conversation on learning the student profile and helping with school work.',
      '',
    ].join('\n'),
    'utf8'
  );

  await writeFile(join(workspacePath, 'CORE_TRAITS.md'), buildCoreTraitsMarkdown(), 'utf8');
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
    // Write agent directly to openclaw.json instead of using the hanging CLI
    await addAgentToOpenClawConfig({
      id: agentId,
      name: agentId,
      workspace: workspacePath,
      agentDir: agentStateDir,
      model: input.modelKey ?? 'minimax/MiniMax-M2.7',
      tools: {
        alsoAllow: [
          'browser',
          'openlibrary_get_book_details',
          'openlibrary_get_cover_url',
          'openlibrary_get_subject_books',
          'openlibrary_search_books',
          'openlibrary_search_inside_book',
        ],
      },
      thinkingDefault: 'off',
      reasoningDefault: 'off',
      skills: ['google-workspace'],
    });
  }

  await ensureEmptyAuthStore(agentStateDir);
  await syncOpenClawAgentModel(agentId, input.modelKey);
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
  const agentStateDir = getAdminAgentStateDir();
  const existing = (await listAgents()).agents?.find((agent) => agent.id === agentId);

  if (!existing) {
    await addAgentToOpenClawConfig({
      id: agentId,
      name: agentId,
      workspace: workspacePath,
      agentDir: agentStateDir,
      model: input.modelKey ?? 'openrouter/auto',
      tools: {
        alsoAllow: [
          'browser',
          'openlibrary_get_book_details',
          'openlibrary_get_cover_url',
          'openlibrary_get_subject_books',
          'openlibrary_search_books',
          'openlibrary_search_inside_book',
        ],
      },
    });
  }

  await mkdir(workspacePath, { recursive: true });
  await mkdir(agentStateDir, { recursive: true });
  await ensureEmptyAuthStore(agentStateDir);
  await writeFile(
    join(workspacePath, 'ADMIN.md'),
    [
      '# ADMIN.md',
      '',
      `Owner email: ${input.email}`,
      `Owner user id: ${input.ownerUserId}`,
      'Role: master StudyClaw admin agent',
      'Boundaries: never share student data across tenants; operate only through admin-approved routes.',
      '',
    ].join('\n'),
    'utf8'
  );
  await writeFile(join(workspacePath, 'CORE_TRAITS.md'), buildCoreTraitsMarkdown(), 'utf8');

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
    usageStats?: Record<string, { errorCount: number; lastUsed?: number }>;
  };

  const profileId = `${input.provider}:default`;

  authData.version = 1;
  authData.profiles = authData.profiles ?? {};
  authData.usageStats = authData.usageStats ?? {};
  authData.profiles[profileId] = {
    type: 'api_key',
    provider: input.provider,
    key: input.apiKey,
  };
  authData.usageStats[profileId] = authData.usageStats[profileId] ?? { errorCount: 0 };

  await writeFile(authProfilesPath, JSON.stringify(authData, null, 2), 'utf8');
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
