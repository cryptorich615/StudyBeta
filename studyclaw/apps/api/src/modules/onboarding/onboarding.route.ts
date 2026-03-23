import { Router } from 'express';
import { db } from '../../lib/db';
import { requireAuth, type AuthedRequest } from '../../lib/auth';
import { loadOpenClawModels, resolveModelSelection } from '../../lib/openclaw-config';
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

export const onboardingRouter = Router();
const LOCAL_PROVIDER_PLACEHOLDER_KEYS: Record<string, string> = {
  ollama: 'local-ollama-no-key-required',
};

async function ensureUserModelConfigsTable() {
  await db.query(`
    create table if not exists user_model_credentials (
      user_id uuid primary key references users(id) on delete cascade,
      provider_id text not null,
      api_key text,
      oauth_connected boolean not null default false,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    )
  `);
}

type AgentType = 'custom' | 'quick_start_1' | 'quick_start_2';

async function ensureAgentProfile(userId: string, modelKey?: string, agentType: AgentType = 'custom') {
  const agentId = buildUserAgentId(userId);
  const mergedConfig = mergeAgentConfig(agentType);
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
      modelKey ?? process.env.OPENCLAW_DEFAULT_MODEL ?? 'openrouter/auto', 
      systemPrompt, 
      mergedConfig.personaName,
      mergedConfig.tone,
      mergedConfig.verbosity,
      mergedConfig.teachingStyle,
      mergedConfig.reminderStyle,
      agentType,
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
    [userId, agentId, mergedConfig.personaName, agentType, JSON.stringify(mergedConfig)]
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
  await ensureUserModelConfigsTable();
  const models = await loadOpenClawModels();
  const FREE_MODEL_KEYS = new Set(['ollama/lfm2.5-thinking:latest', 'openrouter/auto', 'openrouter/free']);
  const taggedModels = (models as any[]).map((m: any) => ({
    ...m,
    isFree: FREE_MODEL_KEYS.has(m.key),
  })).sort((a: any, b: any) => {
    if (a.isFree && !b.isFree) return -1;
    if (!a.isFree && b.isFree) return 1;
    return 0;
  });
  res.json({
    models: taggedModels,
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
  await ensureUserModelConfigsTable();
  await ensurePersonalAgent({ userId: req.user!.id, email: req.user!.email ?? `${req.user!.id}@local.invalid` });
  const [profileResult, agentResult, credentialResult, studentAgentResult, googleStatus] = await Promise.all([
    db.query(`select * from student_profiles where user_id = $1`, [req.user!.id]),
    db.query(`select * from agent_profiles where user_id = $1`, [req.user!.id]),
    db.query(`select * from agents where user_id = $1`, [req.user!.id]),
    db.query(`select provider_id, oauth_connected, api_key from user_model_credentials where user_id = $1`, [req.user!.id]),
    getGoogleConnectionStatus(req.user!.id),
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
    google: googleStatus,
    workspace: {
      agentId: buildUserAgentId(req.user!.id),
      workspacePath: getUserWorkspacePath(req.user!.id),
      agentStateDir: getUserAgentStateDir(req.user!.id),
    },
  });
});

onboardingRouter.post('/model-config', requireAuth, async (req: AuthedRequest, res) => {
  await ensurePlatformSchema();
  await ensureUserModelConfigsTable();

  const { modelKey, apiKey, agentPreset } = req.body as { modelKey?: string; apiKey?: string; agentPreset?: AgentType };
  if (!modelKey) {
    return res.status(400).json({ error: 'bad_request', message: 'modelKey is required' });
  }

  const model = resolveModelSelection(modelKey, await loadOpenClawModels());
  if (!model) {
    return res.status(400).json({ error: 'bad_request', message: 'Unsupported model selection' });
  }

  await ensurePersonalAgent({
    userId: req.user!.id,
    email: req.user!.email ?? `${req.user!.id}@local.invalid`,
    modelKey: model.key,
  });
  const agent = await ensureAgentProfile(req.user!.id, modelKey, agentPreset ?? 'quick_start_2');
  await syncUserWorkspaceIdentity({
    userId: req.user!.id,
    email: req.user!.email ?? `${req.user!.id}@local.invalid`,
    personaName: agent.persona_name,
    tone: agent.tone,
  });
  const existingCredential = await db.query(`select api_key from user_model_credentials where user_id = $1`, [req.user!.id]);
  const nextApiKey =
    apiKey?.trim() ||
    existingCredential.rows[0]?.api_key ||
    LOCAL_PROVIDER_PLACEHOLDER_KEYS[model.provider] ||
    null;

  if (!nextApiKey) {
    return res.status(400).json({ error: 'bad_request', message: 'apiKey is required for the first model setup' });
  }

  // Enforce: only Dixie (quick_start_1) or Willow (quick_start_2) are allowed
  if (agentPreset && agentPreset !== 'quick_start_1' && agentPreset !== 'quick_start_2') {
    return res.status(400).json({ error: 'bad_request', message: 'Agent must be Dixie (quick_start_1) or Willow (quick_start_2)' });
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

  await db.query(`update agent_profiles set model_key = $2 where user_id = $1`, [req.user!.id, modelKey]);
  await db.query(`update student_profiles set onboarding_complete = true where user_id = $1`, [req.user!.id]);

  res.json({
    ok: true,
    oauthAvailable: model.oauthAvailable,
    agentId: agent.openclaw_agent_id,
  });
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
