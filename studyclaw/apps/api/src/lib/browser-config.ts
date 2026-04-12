export type BrowserConfig = {
  enabled: boolean;
  provider: string;
  baseUrl: string | null;
  embedAllowed: boolean;
  timeoutMinutes: number;
  restrictionsEnabled: boolean;
  unavailableReason?: string;
};

function booleanEnv(key: string, fallback: boolean) {
  const value = process.env[key];
  if (value === undefined) {
    return fallback;
  }
  return ['1', 'true', 'yes'].includes(value.toLowerCase());
}

function numberEnv(key: string, fallback: number) {
  const value = Number(process.env[key]);
  return Number.isFinite(value) ? value : fallback;
}

export function getBrowserConfig(): BrowserConfig {
  const baseUrl = process.env.BROWSER_BASE_URL?.trim();
  const enabled = Boolean(baseUrl);

  return {
    enabled,
    provider: process.env.BROWSER_PROVIDER?.trim() || 'novnc',
    baseUrl: baseUrl ? baseUrl.replace(/\/$/, '') : null,
    embedAllowed: booleanEnv('BROWSER_EMBED_ALLOWED', true),
    timeoutMinutes: numberEnv('BROWSER_TIMEOUT_MINUTES', 30),
    restrictionsEnabled: booleanEnv('BROWSER_RESTRICTIONS_ENABLED', false),
    unavailableReason: enabled ? undefined : 'Browser Access is not configured on this server yet.',
  };
}
