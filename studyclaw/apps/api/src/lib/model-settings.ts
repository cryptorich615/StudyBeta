import { readFile } from 'node:fs/promises';
import { db } from './db';
import { bindUserAgentCredential, ensurePersonalAgent, upsertUserAgentModelProvider } from './user-agent';

type SavedModelConfigRow = {
  id: string;
  user_id: string;
  provider_id: string;
  provider_name: string;
  service_base_url: string;
  api_key: string | null;
  model_name: string;
  model_key: string;
  max_context_window: number | null;
  max_output_tokens: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

type GlobalOpenClawConfig = {
  models?: {
    providers?: Record<
      string,
      {
        baseUrl?: string;
        api?: string;
        authHeader?: boolean;
        models?: Array<{
          id: string;
          name?: string;
          contextWindow?: number;
          maxTokens?: number;
        }>;
      }
    >;
  };
};

const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH ?? '/home/ubuntu/.openclaw/openclaw.json';
const LOCAL_PROVIDER_PLACEHOLDER_KEYS: Record<string, string> = {
  ollama: 'local-ollama-no-key-required',
};

function normalizeProviderId(providerName: string) {
  const normalized = providerName.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return normalized || 'custom-provider';
}

function titleizeProviderId(providerId: string) {
  return providerId
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function parseOptionalNumber(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Math.floor(parsed);
}

function splitModelKey(modelKey: string) {
  const [providerId = 'unknown', ...rest] = modelKey.split('/');
  return {
    providerId,
    modelName: rest.join('/') || modelKey,
  };
}

async function readGlobalOpenClawConfig() {
  try {
    const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf8');
    return JSON.parse(raw) as GlobalOpenClawConfig;
  } catch {
    return {} as GlobalOpenClawConfig;
  }
}

function getProviderDefaults(
  providerId: string,
  serviceBaseUrl?: string | null,
  config?: GlobalOpenClawConfig
) {
  const configuredProvider = config?.models?.providers?.[providerId];
  const baseUrl =
    serviceBaseUrl?.trim() ||
    configuredProvider?.baseUrl ||
    (providerId === 'ollama' ? 'http://127.0.0.1:11434' : providerId === 'openrouter' ? 'https://openrouter.ai/api/v1' : '');
  const apiType =
    configuredProvider?.api ||
    (providerId === 'ollama'
      ? 'ollama'
      : providerId === 'minimax' || baseUrl.includes('/anthropic')
        ? 'anthropic-messages'
        : 'openai-completions');
  const authHeader = configuredProvider?.authHeader || providerId === 'minimax';

  return {
    baseUrl,
    apiType,
    authHeader,
  };
}

function getModelDefaults(modelKey: string, config?: GlobalOpenClawConfig) {
  const { providerId, modelName } = splitModelKey(modelKey);
  const provider = config?.models?.providers?.[providerId];
  const model = provider?.models?.find((item) => item.id === modelName || `${providerId}/${item.id}` === modelKey);

  return {
    maxContextWindow: model?.contextWindow ?? null,
    maxOutputTokens: model?.maxTokens ?? null,
  };
}

async function resolveReusableApiKey(userId: string, providerId: string, configId?: string) {
  const [savedResult, credentialResult] = await Promise.all([
    db.query(
      `select api_key
       from user_saved_model_configs
       where user_id = $1
         and provider_id = $2
         and api_key is not null
         and ($3::uuid is null or id <> $3::uuid)
       order by is_active desc, updated_at desc
       limit 1`,
      [userId, providerId, configId ?? null]
    ),
    db.query(
      `select api_key
       from user_model_credentials
       where user_id = $1
         and provider_id = $2
       limit 1`,
      [userId, providerId]
    ),
  ]);

  return savedResult.rows[0]?.api_key ?? credentialResult.rows[0]?.api_key ?? null;
}

async function ensureActiveSavedModelConfig(userId: string) {
  const [profileResult, credentialResult, config] = await Promise.all([
    db.query(`select model_key from agent_profiles where user_id = $1 limit 1`, [userId]),
    db.query(`select provider_id, api_key from user_model_credentials where user_id = $1 limit 1`, [userId]),
    readGlobalOpenClawConfig(),
  ]);

  const modelKey = String(profileResult.rows[0]?.model_key ?? '').trim();
  if (!modelKey) {
    return;
  }

  const { providerId, modelName } = splitModelKey(modelKey);
  const providerDefaults = getProviderDefaults(providerId, null, config);
  const modelDefaults = getModelDefaults(modelKey, config);
  const credentialApiKey =
    credentialResult.rows[0]?.provider_id === providerId ? credentialResult.rows[0]?.api_key ?? null : null;

  const upsertResult = await db.query(
    `insert into user_saved_model_configs (
       user_id,
       provider_id,
       provider_name,
       service_base_url,
       api_key,
       model_name,
       model_key,
       max_context_window,
       max_output_tokens,
       is_active
     )
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
     on conflict (user_id, provider_id, model_name, service_base_url) do update set
       provider_name = excluded.provider_name,
       api_key = coalesce(excluded.api_key, user_saved_model_configs.api_key),
       model_key = excluded.model_key,
       max_context_window = coalesce(excluded.max_context_window, user_saved_model_configs.max_context_window),
       max_output_tokens = coalesce(excluded.max_output_tokens, user_saved_model_configs.max_output_tokens),
       is_active = true,
       updated_at = now()
     returning id`,
    [
      userId,
      providerId,
      titleizeProviderId(providerId),
      providerDefaults.baseUrl,
      credentialApiKey,
      modelName,
      modelKey,
      modelDefaults.maxContextWindow,
      modelDefaults.maxOutputTokens,
    ]
  );

  const activeId = upsertResult.rows[0]?.id;
  if (activeId) {
    await db.query(`update user_saved_model_configs set is_active = false where user_id = $1 and id <> $2`, [userId, activeId]);
  }
}

function mapSavedModelConfig(row: SavedModelConfigRow) {
  return {
    id: row.id,
    providerId: row.provider_id,
    providerName: row.provider_name,
    serviceBaseUrl: row.service_base_url,
    hasApiKey: !!row.api_key,
    modelName: row.model_name,
    modelKey: row.model_key,
    maxContextWindow: row.max_context_window,
    maxOutputTokens: row.max_output_tokens,
    isActive: row.is_active,
    isFunctional: row.provider_id === 'ollama' || !!row.api_key,
    label: `${row.provider_name} / ${row.model_name}`,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getUserModelSettings(userId: string) {
  await ensureActiveSavedModelConfig(userId);

  const [savedResult, profileResult] = await Promise.all([
    db.query(
      `select *
       from user_saved_model_configs
       where user_id = $1
       order by is_active desc, updated_at desc, created_at desc`,
      [userId]
    ),
    db.query(`select model_key from agent_profiles where user_id = $1 limit 1`, [userId]),
  ]);

  const configs = savedResult.rows.map((row) => mapSavedModelConfig(row as SavedModelConfigRow));

  return {
    currentModelKey: profileResult.rows[0]?.model_key ?? null,
    activeConfigId: configs.find((config) => config.isActive)?.id ?? null,
    selectedConfigId: configs.find((config) => config.isActive)?.id ?? null,
    configs,
  };
}

export async function syncUserModelRuntimeConfig(input: {
  userId: string;
  email: string;
  modelKey: string;
}) {
  const { providerId, modelName } = splitModelKey(input.modelKey);
  const [config, credentialResult] = await Promise.all([
    readGlobalOpenClawConfig(),
    db.query(`select provider_id, api_key from user_model_credentials where user_id = $1 limit 1`, [input.userId]),
  ]);

  const providerDefaults = getProviderDefaults(providerId, null, config);
  const modelDefaults = getModelDefaults(input.modelKey, config);
  const credential =
    credentialResult.rows[0]?.provider_id === providerId
      ? credentialResult.rows[0]
      : null;
  const resolvedApiKey =
    credential?.api_key ||
    (await resolveReusableApiKey(input.userId, providerId)) ||
    LOCAL_PROVIDER_PLACEHOLDER_KEYS[providerId] ||
    null;

  await ensurePersonalAgent({
    userId: input.userId,
    email: input.email,
    modelKey: input.modelKey,
  });

  await upsertUserAgentModelProvider({
    userId: input.userId,
    provider: providerId,
    baseUrl: providerDefaults.baseUrl,
    apiType: providerDefaults.apiType,
    authHeader: providerDefaults.authHeader,
    apiKey: resolvedApiKey,
    modelName,
    maxContextWindow: modelDefaults.maxContextWindow,
    maxOutputTokens: modelDefaults.maxOutputTokens,
  });

  if (resolvedApiKey) {
    await bindUserAgentCredential({
      userId: input.userId,
      provider: providerId,
      apiKey: resolvedApiKey,
    });
  }
}

export async function activateUserModelSetting(input: {
  userId: string;
  email: string;
  configId: string;
}) {
  const configResult = await db.query(
    `select *
     from user_saved_model_configs
     where user_id = $1
       and id = $2
     limit 1`,
    [input.userId, input.configId]
  );

  const row = configResult.rows[0] as SavedModelConfigRow | undefined;
  if (!row) {
    throw new Error('Saved model configuration not found');
  }

  const resolvedApiKey =
    row.api_key ||
    (await resolveReusableApiKey(input.userId, row.provider_id, row.id)) ||
    LOCAL_PROVIDER_PLACEHOLDER_KEYS[row.provider_id] ||
    null;

  if (row.provider_id !== 'ollama' && !resolvedApiKey) {
    throw new Error('An API key is required before this provider can be activated');
  }

  const providerDefaults = getProviderDefaults(row.provider_id, row.service_base_url);

  await ensurePersonalAgent({
    userId: input.userId,
    email: input.email,
    modelKey: row.model_key,
  });

  await upsertUserAgentModelProvider({
    userId: input.userId,
    provider: row.provider_id,
    baseUrl: row.service_base_url,
    apiType: providerDefaults.apiType,
    authHeader: providerDefaults.authHeader,
    apiKey: resolvedApiKey,
    modelName: row.model_name,
    maxContextWindow: row.max_context_window,
    maxOutputTokens: row.max_output_tokens,
  });

  if (resolvedApiKey) {
    await bindUserAgentCredential({
      userId: input.userId,
      provider: row.provider_id,
      apiKey: resolvedApiKey,
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
    [input.userId, row.provider_id, resolvedApiKey]
  );

  await db.query(`update user_saved_model_configs set is_active = (id = $2), api_key = coalesce(api_key, $3), updated_at = now() where user_id = $1`, [
    input.userId,
    row.id,
    resolvedApiKey,
  ]);
  await db.query(`update agent_profiles set model_key = $2 where user_id = $1`, [input.userId, row.model_key]);

  return {
    ...(await getUserModelSettings(input.userId)),
    selectedConfigId: row.id,
  };
}

export async function saveUserModelSetting(input: {
  userId: string;
  email: string;
  configId?: string;
  providerName: string;
  serviceBaseUrl: string;
  apiKey?: string;
  modelName: string;
  maxContextWindow?: number | string | null;
  maxOutputTokens?: number | string | null;
  activate?: boolean;
}) {
  const providerName = input.providerName.trim();
  const serviceBaseUrl = input.serviceBaseUrl.trim();
  const modelName = input.modelName.trim();

  if (!providerName) {
    throw new Error('Provider name is required');
  }
  if (!serviceBaseUrl) {
    throw new Error('Service Base URL is required');
  }
  if (!modelName) {
    throw new Error('Model name is required');
  }

  const providerId = normalizeProviderId(providerName);
  const modelKey = `${providerId}/${modelName}`;
  const maxContextWindow = parseOptionalNumber(input.maxContextWindow);
  const maxOutputTokens = parseOptionalNumber(input.maxOutputTokens);
  const existingApiKey = await resolveReusableApiKey(input.userId, providerId, input.configId);
  const resolvedApiKey =
    input.apiKey?.trim() ||
    existingApiKey ||
    LOCAL_PROVIDER_PLACEHOLDER_KEYS[providerId] ||
    null;

  let configId = input.configId;

  if (configId) {
    const updateResult = await db.query(
      `update user_saved_model_configs
       set provider_id = $3,
           provider_name = $4,
           service_base_url = $5,
           api_key = coalesce($6, api_key),
           model_name = $7,
           model_key = $8,
           max_context_window = $9,
           max_output_tokens = $10,
           updated_at = now()
       where user_id = $1
         and id = $2
       returning id`,
      [
        input.userId,
        configId,
        providerId,
        providerName,
        serviceBaseUrl,
        resolvedApiKey,
        modelName,
        modelKey,
        maxContextWindow,
        maxOutputTokens,
      ]
    );

    configId = updateResult.rows[0]?.id;
  } else {
    const insertResult = await db.query(
      `insert into user_saved_model_configs (
         user_id,
         provider_id,
         provider_name,
         service_base_url,
         api_key,
         model_name,
         model_key,
         max_context_window,
         max_output_tokens,
         is_active
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, false)
       on conflict (user_id, provider_id, model_name, service_base_url) do update set
         provider_name = excluded.provider_name,
         api_key = coalesce(excluded.api_key, user_saved_model_configs.api_key),
         max_context_window = coalesce(excluded.max_context_window, user_saved_model_configs.max_context_window),
         max_output_tokens = coalesce(excluded.max_output_tokens, user_saved_model_configs.max_output_tokens),
         updated_at = now()
       returning id`,
      [
        input.userId,
        providerId,
        providerName,
        serviceBaseUrl,
        resolvedApiKey,
        modelName,
        modelKey,
        maxContextWindow,
        maxOutputTokens,
      ]
    );

    configId = insertResult.rows[0]?.id;
  }

  if (!configId) {
    throw new Error('Failed to save model configuration');
  }

  if (input.activate) {
    return activateUserModelSetting({
      userId: input.userId,
      email: input.email,
      configId,
    });
  }

  return {
    ...(await getUserModelSettings(input.userId)),
    selectedConfigId: configId,
  };
}
