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
  const { stdout } = await execFileAsync('openclaw', ['models', 'list', '--all', '--json'], {
    maxBuffer: 16 * 1024 * 1024,
  });
  const payload = JSON.parse(stdout) as {
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
        if (left.provider !== right.provider) {
          return left.provider.localeCompare(right.provider);
        }
        return left.name.localeCompare(right.name);
      });

  const mapped = (payload.models ?? [])
    .map((model) => {
      const provider = model.key.split('/')[0] ?? 'unknown';
      const oauthAvailable = Object.values(config.auth?.profiles ?? {}).some(
        (profile) => profile.provider === provider && profile.mode === 'oauth'
      );

      return {
        key: model.key,
        name: model.name ?? modelNameFromKey(model.key, config),
        provider,
        oauthAvailable,
        available: !!model.available,
      };
    })
    .filter((model) => {
      if (preferredKeys.has(model.key)) {
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

  return mapped.length
    ? finalizeModels(mapped)
    : finalizeModels(
        (payload.models ?? []).map((model) => {
          const provider = model.key.split('/')[0] ?? 'unknown';
          const oauthAvailable = Object.values(config.auth?.profiles ?? {}).some(
            (profile) => profile.provider === provider && profile.mode === 'oauth'
          );

          return {
            key: model.key,
            name: model.name ?? modelNameFromKey(model.key, config),
            provider,
            oauthAvailable,
            available: !!model.available,
          };
        })
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
