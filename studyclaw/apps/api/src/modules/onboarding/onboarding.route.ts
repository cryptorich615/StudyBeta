import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { loadConfiguredOpenClawDefaults, loadOpenClawModels, resolveModelSelection } from '../../lib/openclaw-config';
import { buildBootstrapStudyPrompt } from '../../lib/bootstrap';
import { buildLockedSystemPrompt, mergeAgentConfig, QUICK_START_AGENTS } from '../../lib/agent-config';
import {
  bindUserAgentCredential,
  buildUserAgentId,
  ensurePersonalAgent,
  getUserAgentStateDir,
  getUserWorkspacePath,
  syncUserWorkspaceIdentity,
} from '../../lib/user-agent';
import { getGoogleConnectionStatus } from '../../lib/google-service';
import { ensurePlatformSchema } from '../../lib/platform-schema';
import { saveUserModelSetting, syncUserModelRuntimeConfig } from '../../lib/model-settings';
import {
  assignTestingTier,
  attachByokUsage,
  attachLocalUsage,
  attachManagedMiniMaxUsage,
  getUserUsageSnapshot,
  isManagedMiniMaxModelKey,
} from '../../lib/managed-usage';

export const onboardingRouter = Router();
const LOCAL_PROVIDER_PLACEHOLDER_KEYS: Record<string, string> = {
  ollama: 'local-ollama-no-key-required',
};
const DEFAULT_ONBOARDING_MODELS = [
  {
    key: 'google/gemini-3.1-pro-preview',
    name: 'Gemini 3.1 Pro Preview',
    provider: 'google',
    oauthAvailable: false,
    available: true,
  },
  {
    key: 'openrouter/auto',
    name: 'OpenRouter Auto',
    provider: 'openrouter',
    oauthAvailable: false,
    available: true,
  },
  {
    key: 'openrouter/free',
    name: 'OpenRouter Free',
    provider: 'openrouter',
    oauthAvailable: false,
    available: true,
  },
  {
    key: 'ollama/lfm2.5-thinking:latest',
    name: 'LFM 2.5 Thinking',
    provider: 'ollama',
    oauthAvailable: false,
    available: true,
  },
  {
    key: 'minimax/MiniMax-M2.7',
    name: 'MiniMax M2.7 (configured)',
    provider: 'minimax',
    oauthAvailable: false,
    available: true,
  },
  {
    key: 'minimax/MiniMax-M2.5',
    name: 'MiniMax M2.5 (configured)',
    provider: 'minimax',
    oauthAvailable: false,
    available: true,
  },
  {
    key: 'openai-codex/gpt-5.3-codex',
    name: 'GPT-5.3 Codex',
    provider: 'openai-codex',
    oauthAvailable: false,
    available: true,
  },
] as const;

type AgentType = 'custom' | 'quick_start_1' | 'quick_start_2';

const ADVANCED_PROVIDER_BASE_URLS: Record<string, string> = {
  google: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  gemini: 'https://generativelanguage.googleapis.com/v1beta/openai/',
  openrouter: 'https://openrouter.ai/api/v1',
  minimax: 'https://api.minimax.io/anthropic',
  ollama: 'http://127.0.0.1:11434',
  openai: 'https://api.openai.com/v1',
  'openai-codex': 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com/v1',
  groq: 'https://api.groq.com/openai/v1',
  mistral: 'https://api.mistral.ai/v1',
  xai: 'https://api.x.ai/v1',
};

function normalizeAgentType(value: string | null | undefined): AgentType {
  if (value === 'quick_start_1' || value === 'quick_start_2' || value === 'custom') {
    return value;
  }

  return 'quick_start_2';
}

function normalizeProviderId(value: string | null | undefined) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function buildAdvancedModelKey(providerName: string, modelName: string) {
  const providerId = normalizeProviderId(providerName);
  const trimmedModelName = modelName.trim();
  if (!providerId || !trimmedModelName) {
    return '';
  }

  return `${providerId}/${trimmedModelName}`;
}

function mergeOnboardingModels(models: Awaited<ReturnType<typeof loadOpenClawModels>>) {
  return Array.from(
    [...DEFAULT_ONBOARDING_MODELS, ...models].reduce((acc, model) => {
      if (!acc.has(model.key)) {
        acc.set(model.key, { ...model });
        return acc;
      }

      acc.set(model.key, {
        ...acc.get(model.key),
        ...model,
      });
      return acc;
    }, new Map<string, (typeof models)[number]>())
  ).map(([, model]) => model);
}

async function loadOnboardingModelsFast() {
  try {
    const configuredDefaults = await loadConfiguredOpenClawDefaults();
    const models = await Promise.race([
      loadOpenClawModels(),
      new Promise<Awaited<ReturnType<typeof loadOpenClawModels>>>((resolve) =>
        setTimeout(() => resolve([]), 1500)
      ),
    ]);

    return mergeOnboardingModels([...configuredDefaults, ...models]);
  } catch {
    const configuredDefaults = await loadConfiguredOpenClawDefaults().catch(() => []);
    return mergeOnboardingModels(configuredDefaults);
  }
}

function sortTestingPreferredModels<T extends { key: string; provider?: string; isFree?: boolean; name?: string }>(models: T[]) {
  const priority = new Map<string, number>([
    ['google/gemini-3.1-pro-preview', 0],
    ['openrouter/auto', 1],
    ['minimax/MiniMax-M2.7', 2],
    ['openrouter/free', 3],
    ['minimax/MiniMax-M2.5', 4],
    ['ollama/lfm2.5-thinking:latest', 5],
  ]);

  return [...models].sort((left, right) => {
    const leftPriority = priority.get(left.key) ?? 100;
    const rightPriority = priority.get(right.key) ?? 100;
    if (leftPriority !== rightPriority) {
      return leftPriority - rightPriority;
    }

    if (!!left.isFree !== !!right.isFree) {
      return left.isFree ? -1 : 1;
    }

    return String(left.name ?? left.key).localeCompare(String(right.name ?? right.key));
  });
}

async function ensureAgentProfile(userId: string, modelKey?: string | null, agentType?: AgentType | null) {
  const existingProfileResult = await db.query(
    `select model_key, preset_key
     from agent_profiles
     where user_id = $1
     limit 1`,
    [userId]
  );
  const existingProfile = existingProfileResult.rows[0] as
    | { model_key?: string | null; preset_key?: string | null }
    | undefined;
  const effectiveModelKey =
    modelKey?.trim() ||
    existingProfile?.model_key ||
    process.env.OPENCLAW_DEFAULT_MODEL ||
    'openrouter/auto';
  const normalizedAgentType = normalizeAgentType(agentType ?? existingProfile?.preset_key);
  const agentId = buildUserAgentId(userId);
  const mergedConfig = mergeAgentConfig(normalizedAgentType);
  const systemPrompt = buildLockedSystemPrompt(mergedConfig);

  const result = await db.query(
    `insert into agent_profiles (user_id, openclaw_agent_id, model_key, system_prompt, persona_name, tone, verbosity, teaching_style, reminder_style, preset_key, custom_instructions, core_traits_version)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (user_id) do update set
      model_key = coalesce(excluded.model_key, agent_profiles.model_key),
       preset_key = excluded.preset_key,
       persona_name = excluded.persona_name,
       tone = excluded.tone,
       verbosity = excluded.verbosity,
       teaching_style = excluded.teaching_style,
       reminder_style = excluded.reminder_style,
       system_prompt = excluded.system_prompt,
       custom_instructions = excluded.custom_instructions,
       core_traits_version = excluded.core_traits_version
     returning *`,
    [
      userId,
      agentId,
      effectiveModelKey,
      systemPrompt,
      mergedConfig.personaName,
      mergedConfig.tone,
      mergedConfig.verbosity,
      mergedConfig.teachingStyle,
      mergedConfig.reminderStyle,
      normalizedAgentType,
      mergedConfig.customInstructions,
      mergedConfig.coreTraitsVersion,
    ]
  );

  await db.query(
    `insert into agents (user_id, openclaw_agent_id, name, agent_type, config, status)
     values ($1, $2, $3, $4, $5, 'active')
     on conflict (user_id) do update set
       name = excluded.name,
       agent_type = excluded.agent_type,
       config = excluded.config,
       status = excluded.status,
       updated_at = now()`,
    [userId, agentId, mergedConfig.personaName, normalizedAgentType, JSON.stringify(mergedConfig)]
  );

  await db.query(
    `insert into student_profiles (user_id, onboarding_complete)
     values ($1, false)
     on conflict (user_id) do nothing`,
    [userId]
  );

  return result.rows[0];
}

// ── LOCKED PERSONALITY CONFIGS (cannot be changed by students) ──
const LOCKED_PERSONALITIES: Record<string, {
  personaName: string;
  tone: string;
  verbosity: string;
  teachingStyle: string;
  reminderStyle: string;
  systemPrompt: string;
}> = {
  quick_start_1: {
    personaName: 'Dixie',
    tone: 'energetic',
    verbosity: 'concise',
    teachingStyle: 'active-recall',
    reminderStyle: 'push',
    systemPrompt: `You are Dixie, a high-energy study sprint coach. Your role is to help students crush their coursework with focused, structured sessions. You are direct, motivating, and time-conscious. You break tasks into actionable sprints, push students to stay on track, and celebrate progress. You ONLY help with academic topics — studying, assignments, exams, and learning. You never deviate from your role as a study coach. Core traits: energetic tone, concise responses, active-recall methods, push-style reminders.`,
  },
  quick_start_2: {
    personaName: 'Willow',
    tone: 'calm',
    verbosity: 'thorough',
    teachingStyle: 'conceptual',
    reminderStyle: 'gentle',
    systemPrompt: `You are Willow, a calm and thoughtful study guide. Your role is to help students build deep understanding through patient, conceptual explanations. You guide students toward clarity at their own pace, using analogies, questions, and reflective prompts. You ONLY help with academic topics — studying, assignments, exams, and learning. You never deviate from your role as a study companion. Core traits: calm tone, thorough explanations, conceptual teaching, gentle reminders.`,
  },
};

onboardingRouter.get('/options', requireAuth, async (_req, res) => {
  await ensurePlatformSchema();
  const models = await loadOnboardingModelsFast();
  const FREE_MODEL_KEYS = new Set(['google/gemini-3.1-pro-preview', 'ollama/lfm2.5-thinking:latest', 'openrouter/auto', 'openrouter/free']);
  const taggedModels = (models as any[]).map((m: any) => ({
    ...m,
    isFree: FREE_MODEL_KEYS.has(m.key),
  }));
  res.json({
    models: sortTestingPreferredModels(taggedModels),
    oauthAvailable: models.some((model) => model.oauthAvailable),
    agentPresets: Object.values(QUICK_START_AGENTS).map((preset) => ({
      key: preset.key,
      name: preset.name,
      description: preset.description,
    })),
  });
});

onboardingRouter.get('/status', requireAuth, async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const [profileResult, agentResult, credentialResult, studentAgentResult, googleStatus, usageProfile] = await Promise.all([
    db.query(`select * from student_profiles where user_id = $1`, [req.user!.id]),
    db.query(`select * from agent_profiles where user_id = $1`, [req.user!.id]),
    db.query(`select * from agents where user_id = $1`, [req.user!.id]),
    db.query(`select provider_id, oauth_connected, api_key from user_model_credentials where user_id = $1`, [req.user!.id]),
    getGoogleConnectionStatus(req.user!.id),
    getUserUsageSnapshot(req.user!.id),
  ]);

  const credential = credentialResult.rows[0]
    ? {
        providerId: credentialResult.rows[0].provider_id,
        oauthConnected: credentialResult.rows[0].oauth_connected,
        hasApiKey: !!credentialResult.rows[0].api_key,
      }
    : null;

  res.json({
    onboardingComplete: !!profileResult.rows[0]?.onboarding_complete,
    profile: profileResult.rows[0] ?? null,
    agent: agentResult.rows[0] ?? null,
    studentAgent: studentAgentResult.rows[0] ?? null,
    credentials: credential,
    usageProfile,
    google: googleStatus,
    workspace: {
      agentId: buildUserAgentId(req.user!.id),
      workspacePath: getUserWorkspacePath(req.user!.id),
      agentStateDir: getUserAgentStateDir(req.user!.id),
    },
  });
});

onboardingRouter.post('/testing-tier', requireAuth, async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  const tier = String(req.body?.tier ?? '').trim() as 'tier_1' | 'tier_2' | 'tier_3';
  if (!['tier_1', 'tier_2', 'tier_3'].includes(tier)) {
    return res.status(400).json({
      error: 'bad_request',
      message: 'tier must be one of tier_1, tier_2, or tier_3',
    });
  }

  const usageProfile = await assignTestingTier({
    userId: req.user!.id,
    tier,
  });

  return res.json({
    ok: true,
    usageProfile,
  });
});

onboardingRouter.post('/model-config', requireAuth, async (req: AuthedRequest, res) => {
  try {
    await ensurePlatformSchema();

    const { modelKey, apiKey, agentPreset, usageMode, customProviderName, customModelName, customServiceBaseUrl } = req.body as {
      modelKey?: string;
      apiKey?: string;
      agentPreset?: AgentType;
      usageMode?: 'managed' | 'byok';
      customProviderName?: string;
      customModelName?: string;
      customServiceBaseUrl?: string;
    };
    const usingAdvancedProvider =
      !!String(customProviderName ?? '').trim() ||
      !!String(customModelName ?? '').trim() ||
      !!String(customServiceBaseUrl ?? '').trim();

    if (!modelKey && !usingAdvancedProvider) {
      return res.status(400).json({ error: 'bad_request', message: 'modelKey is required' });
    }

    if (agentPreset && agentPreset !== 'quick_start_1' && agentPreset !== 'quick_start_2') {
      return res.status(400).json({ error: 'bad_request', message: 'Agent must be Dixie (quick_start_1) or Willow (quick_start_2)' });
    }

    const normalizedAgentPreset = normalizeAgentType(agentPreset);

    if (usingAdvancedProvider) {
      const providerName = String(customProviderName ?? '').trim();
      const providerId = normalizeProviderId(providerName);
      const advancedModelName = String(customModelName ?? '').trim();
      const serviceBaseUrl =
        String(customServiceBaseUrl ?? '').trim() ||
        ADVANCED_PROVIDER_BASE_URLS[providerId] ||
        '';

      if (!providerName || !advancedModelName) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'customProviderName and customModelName are required for advanced onboarding setup',
        });
      }

      if (!serviceBaseUrl) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'This advanced provider is not supported in onboarding yet',
        });
      }

      const effectiveModelKey = buildAdvancedModelKey(providerName, advancedModelName);
      if (!effectiveModelKey) {
        return res.status(400).json({
          error: 'bad_request',
          message: 'Failed to build the advanced model selection',
        });
      }

      await saveUserModelSetting({
        userId: req.user!.id,
        email: req.user!.email ?? `${req.user!.id}@local.invalid`,
        providerName,
        serviceBaseUrl,
        apiKey: apiKey?.trim(),
        modelName: advancedModelName,
        activate: true,
      });

      const agent = await ensureAgentProfile(req.user!.id, effectiveModelKey, normalizedAgentPreset);
      await syncUserWorkspaceIdentity({
        userId: req.user!.id,
        email: req.user!.email ?? `${req.user!.id}@local.invalid`,
        personaName: agent.persona_name,
        tone: agent.tone,
      });
      await db.query(`update student_profiles set onboarding_complete = true where user_id = $1`, [req.user!.id]);
      const refreshedUsageProfile = await getUserUsageSnapshot(req.user!.id);

      return res.json({
        ok: true,
        oauthAvailable: false,
        agentId: agent.openclaw_agent_id,
        usageProfile: refreshedUsageProfile,
      });
    }

    const model = resolveModelSelection(modelKey!, await loadOnboardingModelsFast());
    if (!model) {
      return res.status(400).json({ error: 'bad_request', message: 'Unsupported model selection' });
    }

    await ensurePersonalAgent({
      userId: req.user!.id,
      email: req.user!.email ?? `${req.user!.id}@local.invalid`,
      modelKey: model.key,
    });
    const agent = await ensureAgentProfile(req.user!.id, modelKey, normalizedAgentPreset);
    await syncUserWorkspaceIdentity({
      userId: req.user!.id,
      email: req.user!.email ?? `${req.user!.id}@local.invalid`,
      personaName: agent.persona_name,
      tone: agent.tone,
    });
    const managedConfiguredMiniMax = model.provider === 'minimax' && isManagedMiniMaxModelKey(model.key) && usageMode !== 'byok';
    const usageSnapshot = managedConfiguredMiniMax ? await getUserUsageSnapshot(req.user!.id) : null;
    const existingCredential = managedConfiguredMiniMax
      ? { rows: [] }
      : await db.query(`select api_key from user_model_credentials where user_id = $1`, [req.user!.id]);
    const nextApiKey =
      managedConfiguredMiniMax
        ? null
        : apiKey?.trim() ||
          existingCredential.rows[0]?.api_key ||
          LOCAL_PROVIDER_PLACEHOLDER_KEYS[model.provider] ||
          null;

    if (managedConfiguredMiniMax) {
      await attachManagedMiniMaxUsage({
        userId: req.user!.id,
        modelKey: model.key,
        tier: ['tier_1', 'tier_2', 'tier_3'].includes(String(usageSnapshot?.tier ?? ''))
          ? (usageSnapshot?.tier as 'tier_1' | 'tier_2' | 'tier_3')
          : undefined,
      });
      await db.query(
        `insert into user_model_credentials (user_id, provider_id, api_key, oauth_connected, updated_at)
         values ($1, $2, null, false, now())
         on conflict (user_id) do update set
           provider_id = excluded.provider_id,
           api_key = excluded.api_key,
           oauth_connected = excluded.oauth_connected,
           updated_at = now()`,
        [req.user!.id, model.provider]
      );
    } else {
      if (!nextApiKey) {
        return res.status(400).json({ error: 'bad_request', message: 'apiKey is required for the first model setup' });
      }

      if (model.provider === 'ollama') {
        await attachLocalUsage({
          userId: req.user!.id,
          providerId: model.provider,
          modelKey: model.key,
        });
      } else {
        await attachByokUsage({
          userId: req.user!.id,
          providerId: model.provider,
          modelKey: model.key,
        });
      }

      await db.query(
        `insert into user_model_credentials (user_id, provider_id, api_key, oauth_connected, updated_at)
         values ($1, $2, $3, false, now())
         on conflict (user_id) do update set
           provider_id = excluded.provider_id,
           api_key = excluded.api_key,
           oauth_connected = excluded.oauth_connected,
           updated_at = now()`,
        [req.user!.id, model.provider, nextApiKey]
      );
      await bindUserAgentCredential({ userId: req.user!.id, provider: model.provider, apiKey: nextApiKey });
    }
    await syncUserModelRuntimeConfig({
      userId: req.user!.id,
      email: req.user!.email ?? `${req.user!.id}@local.invalid`,
      modelKey: model.key,
    });

    await db.query(`update agent_profiles set model_key = $2 where user_id = $1`, [req.user!.id, modelKey]);
    await db.query(`update student_profiles set onboarding_complete = true where user_id = $1`, [req.user!.id]);
    const refreshedUsageProfile = await getUserUsageSnapshot(req.user!.id);

    res.json({
      ok: true,
      oauthAvailable: model.oauthAvailable,
      agentId: agent.openclaw_agent_id,
      usageProfile: refreshedUsageProfile,
    });
  } catch (error) {
    console.error('Onboarding model-config failed:', error);
    res.status(500).json({
      error: 'model_config_failed',
      message: error instanceof Error ? error.message : 'Failed to launch your agent',
    });
  }
});

onboardingRouter.post('/bootstrap/start', requireAuth, async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  await ensurePersonalAgent({ userId: req.user!.id, email: req.user!.email ?? `${req.user!.id}@local.invalid` });
  const agent = await ensureAgentProfile(req.user!.id);
  const existingThread = await db.query(
    `select * from chat_threads where user_id = $1 order by created_at asc limit 1`,
    [req.user!.id]
  );

  if (existingThread.rows[0]) {
    const messages = await db.query(`select * from chat_messages where thread_id = $1 order by created_at asc`, [
      existingThread.rows[0].id,
    ]);
    return res.json({ thread: existingThread.rows[0], messages: messages.rows });
  }

  const thread = await db.query(
    `insert into chat_threads (user_id, openclaw_session_id, title)
     values ($1, $2, $3)
     returning *`,
    [req.user!.id, `bootstrap_${Date.now()}`, 'Bootstrap conversation']
  );

  const introMessages: Record<string, string> = {
    quick_start_1: `LFG! I'm Dixie, your sprint coach. I'm here to help you crush your classes and reclaim your time. First things first: what's your name, and where are you studying?`,
    quick_start_2: `Hi there. I'm Willow. I'll guide you toward a calmer, deeper study rhythm. To get started, tell me your name and which school you're attending.`,
    custom: `Hey! I'm StudyClaw. I'm here to help you stay organized and on top of your coursework. Let's start with the basics: what's your name and what school are you at?`,
  };
  const intro = introMessages[(agent.preset_key as AgentType | null) ?? 'custom'] || introMessages.custom;

  const assistantMessage = [
    buildBootstrapStudyPrompt({
      personaName: agent.persona_name ?? 'StudyClaw',
      tone: agent.tone ?? 'supportive',
      teachingStyle: agent.teaching_style ?? 'step-by-step',
    }),
    '',
    intro,
  ].join('\n');

  await db.query(
    `insert into chat_messages (thread_id, role, content, metadata_json)
     values ($1, 'assistant', $2, $3)`,
    [thread.rows[0].id, assistantMessage, JSON.stringify({ bootstrap: true })]
  );

  const messages = await db.query(`select * from chat_messages where thread_id = $1 order by created_at asc`, [
    thread.rows[0].id,
  ]);

  res.json({ thread: thread.rows[0], messages: messages.rows });
});
