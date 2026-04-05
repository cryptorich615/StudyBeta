import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';

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

const OPENCLAW_CONFIG_PATH = process.env.OPENCLAW_CONFIG_PATH ?? '/home/ubuntu/.openclaw/openclaw.json';
const execFileAsync = promisify(execFile);
const REQUIRED_DEFAULT_MODEL_KEYS = [
  'openrouter/auto',
  'minimax/MiniMax-M2.7',
  'openrouter/free',
  'ollama/lfm2.5-thinking:latest',
] as const;

function providerFromKey(key: string) {
  return key.split('/')[0] ?? 'unknown';
}

function oauthAvailableForProvider(provider: string, config: OpenClawConfig) {
  return Object.values(config.auth?.profiles ?? {}).some(
    (profile) => profile.provider === provider && profile.mode === 'oauth'
  );
}

function buildModelOption(
  key: string,
  config: OpenClawConfig,
  overrides: Partial<OpenClawModelOption> = {}
): OpenClawModelOption {
  const provider = providerFromKey(key);

  return {
    key,
    name: overrides.name ?? modelNameFromKey(key, config),
    provider,
    oauthAvailable: overrides.oauthAvailable ?? oauthAvailableForProvider(provider, config),
    available: overrides.available ?? true,
  };
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

function modelNameFromKey(key: string, config: OpenClawConfig) {
  const provider = providerFromKey(key);
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

function getPreferredModelKeys(config: OpenClawConfig) {
  return new Set(
    [
      config.agents?.defaults?.model?.primary,
      ...(config.agents?.defaults?.model?.fallbacks ?? []),
      ...Object.keys(config.agents?.defaults?.models ?? {}),
    ].filter((key): key is string => !!key)
  );
}

async function readOpenClawConfig() {
  const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf8');
  return JSON.parse(raw) as OpenClawConfig;
}

export async function loadConfiguredOpenClawDefaults(): Promise<OpenClawModelOption[]> {
  const config = await readOpenClawConfig();
  const preferredKeys = new Set<string>([
    ...REQUIRED_DEFAULT_MODEL_KEYS,
    ...getPreferredModelKeys(config),
  ]);

  return Array.from(preferredKeys).map((key) =>
    buildModelOption(key, config, {
      name: modelNameFromKey(key, config),
      available: true,
    })
  );
}

export async function loadOpenClawModels(): Promise<OpenClawModelOption[]> {
  const config = await readOpenClawConfig();
  const authProviders = new Set(
    Object.values(config.auth?.profiles ?? {})
      .map((profile) => profile.provider)
      .filter((provider): provider is string => !!provider)
  );
  const preferredKeys = getPreferredModelKeys(config);
  const { stdout } = await execFileAsync('openclaw', ['models', 'list', '--all', '--json'], {
    timeout: 12_000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const payload = JSON.parse(extractJsonPayload(stdout)) as {
    models?: Array<{ key: string; name?: string; available?: boolean }>;
  };

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
        if (REQUIRED_DEFAULT_MODEL_KEYS.includes(left.key as (typeof REQUIRED_DEFAULT_MODEL_KEYS)[number]) !== REQUIRED_DEFAULT_MODEL_KEYS.includes(right.key as (typeof REQUIRED_DEFAULT_MODEL_KEYS)[number])) {
          return REQUIRED_DEFAULT_MODEL_KEYS.includes(left.key as (typeof REQUIRED_DEFAULT_MODEL_KEYS)[number]) ? -1 : 1;
        }
        if (left.provider !== right.provider) {
          return left.provider.localeCompare(right.provider);
        }
        return left.name.localeCompare(right.name);
      });

  const guaranteedKeys = new Set<string>([
    ...REQUIRED_DEFAULT_MODEL_KEYS,
    ...preferredKeys,
  ]);

  const mapped = (payload.models ?? [])
    .map((model) => {
      return buildModelOption(model.key, config, {
        name: model.name ?? modelNameFromKey(model.key, config),
        available: !!model.available,
      });
    })
    .filter((model) => {
      if (guaranteedKeys.has(model.key)) {
        return true;
      }

      if (model.provider === 'ollama' && model.available) {
        return true;
      }

      if (model.provider !== 'openrouter' && authProviders.has(model.provider) && model.available) {
        return true;
      }

      return false;
    });

  const fallbackModels = Array.from(guaranteedKeys).map((key) => {
    const discovered = (payload.models ?? []).find((model) => model.key === key);
    return buildModelOption(key, config, {
      name: discovered?.name ?? modelNameFromKey(key, config),
      available: discovered?.available ?? true,
    });
  });

  return mapped.length
    ? finalizeModels([...fallbackModels, ...mapped])
    : finalizeModels(
        [
          ...fallbackModels,
          ...(payload.models ?? []).map((model) =>
            buildModelOption(model.key, config, {
              name: model.name ?? modelNameFromKey(model.key, config),
              available: !!model.available,
            })
          ),
        ]
      );
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
