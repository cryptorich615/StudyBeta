import { readFile } from 'node:fs/promises';

type OpenClawConfig = {
  auth?: {
    profiles?: Record<string, { provider?: string; mode?: string }>;
  };
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
        fallbacks?: string[];
      };
      models?: Record<string, { alias?: string }>;
    };
  };
  models?: {
    providers?: Record<
      string,
      {
        models?: Array<{ id: string; name?: string }>;
      }
    >;
  };
};

export type OpenClawModelOption = {
  key: string;
  name: string;
  provider: string;
  oauthAvailable: boolean;
  available: boolean;
};

const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH ?? '/home/martinez_a_richard/.openclaw/openclaw.json';

function modelNameFromKey(key: string, config: OpenClawConfig) {
  const provider = key.split('/')[0] ?? 'unknown';
  const modelId = key.split('/').slice(1).join('/');

  const providerModel = config.models?.providers?.[provider]?.models?.find((model) => model.id === modelId);
  if (providerModel?.name) {
    return providerModel.name;
  }

  const configuredAlias = config.agents?.defaults?.models?.[key]?.alias;
  if (configuredAlias) {
    return configuredAlias;
  }

  return modelId || key;
}

export async function loadOpenClawModels(): Promise<OpenClawModelOption[]> {
  const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw) as OpenClawConfig;
  const authProviders = new Set(
    Object.values(config.auth?.profiles ?? {})
      .map((profile) => profile.provider)
      .filter((provider): provider is string => !!provider)
  );
  const preferredKeys = new Set(
    [
      config.agents?.defaults?.model?.primary,
      ...(config.agents?.defaults?.model?.fallbacks ?? []),
      ...Object.keys(config.agents?.defaults?.models ?? {}),
    ].filter((key): key is string => !!key)
  );

  // Build models from config instead of calling the hanging CLI
  const configModels = config.agents?.defaults?.models ?? {};
  const mapped: OpenClawModelOption[] = Object.entries(configModels).map(([key, cfg]) => {
    const provider = key.split('/')[0] ?? 'unknown';
    const oauthAvailable = Object.values(config.auth?.profiles ?? {}).some(
      (profile) => profile.provider === provider && profile.mode === 'oauth'
    );
    return {
      key,
      name: cfg?.alias ?? modelNameFromKey(key, config),
      provider,
      oauthAvailable,
      available: authProviders.has(provider) || preferredKeys.has(key),
    };
  });

  const finalizeModels = (models: OpenClawModelOption[]) =>
    Array.from(
      models.reduce((acc, model) => {
        if (!acc.has(model.key)) {
          acc.set(model.key, model);
        }
        return acc;
      }, new Map<string, OpenClawModelOption>())
    )
      .map(([, model]) => model)
      .sort((left, right) => {
        if (left.available !== right.available) {
          return left.available ? -1 : 1;
        }
        if (left.provider !== right.provider) {
          return left.provider.localeCompare(right.provider);
        }
        return left.name.localeCompare(right.name);
      });

  return finalizeModels(mapped);
}

export function resolveModelSelection(
  selectedKey: string | undefined,
  models: OpenClawModelOption[]
): OpenClawModelOption | null {
  if (!selectedKey) {
    return null;
  }

  const exact = models.find((model) => model.key === selectedKey);
  if (exact) {
    return exact;
  }

  const normalized = selectedKey.trim().toLowerCase();
  const alias = models.find((model) => {
    const modelKey = model.key.toLowerCase();
    return (
      modelKey === normalized ||
      modelKey.endsWith(`/${normalized}`) ||
      modelKey.replace(/^openrouter\//, '') === normalized
    );
  });

  return alias ?? null;
}
