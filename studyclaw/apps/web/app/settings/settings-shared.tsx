'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Bell, Bot, BrainCircuit, ChartColumn, Clock3 } from 'lucide-react';
import PageHero from '../components/page-hero';
import StatusBanner from '../components/status-banner';
import { apiFetch, beginGoogleConnect } from '../../lib/api';

export type ChannelItem = {
  id: string;
  label: string;
  enabled: boolean;
  authConfigured: boolean;
  settings: Array<{ key: string; value: string }>;
  capabilities: {
    support: string[];
    actions: string[];
    probe: string;
  };
};

export type SessionItem = {
  key?: string;
  updatedAt?: number;
  sessionId?: string;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  model?: string;
  modelProvider?: string;
  kind?: string;
};

export type SettingsSnapshot = {
  generatedAt: string;
  channels: ChannelItem[];
  sessions: SessionItem[];
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    models: Array<{ model: string; sessions: number; totalTokens: number }>;
  };
  cron: {
    status: string;
    jobs: CronJobItem[];
  };
  skills: {
    readyCount: number;
    totalCount: number;
    items: Array<{ status: string; name: string; description: string; source: string; enabled: boolean }>;
  };
  logs: {
    source: string;
    lines: Array<{ line: string }>;
  };
  diagnostics: {
    sessionsOk: boolean;
    skillsOk: boolean;
    channelsProbe: string;
  };
};

type SavedModelConfig = {
  id: string;
  providerId: string;
  providerName: string;
  serviceBaseUrl: string;
  hasApiKey: boolean;
  modelName: string;
  modelKey: string;
  maxContextWindow: number | null;
  maxOutputTokens: number | null;
  isActive: boolean;
  isFunctional: boolean;
  label: string;
  createdAt: string;
  updatedAt: string;
};

type ModelSettingsPayload = {
  currentModelKey: string | null;
  activeConfigId: string | null;
  selectedConfigId?: string | null;
  configs: SavedModelConfig[];
};

type TelegramSettingsPayload = {
  available: boolean;
  message?: string;
  personaKey?: string;
  personaName?: string;
  accountId?: string;
  botUsername?: string;
  channelEnabled?: boolean;
  accountConfigured?: boolean;
  dmPolicy?: string;
  paired?: boolean;
  boundPeerId?: string;
};

type CronJobItem = {
  id?: string;
  jobId?: string;
  name?: string;
  schedule?: {
    kind?: 'at' | 'cron' | 'every';
    at?: string;
    everyMs?: number;
    expr?: string;
  };
};

export const settingsSections = [
  {
    slug: 'model',
    title: 'Model Settings',
    description: 'Model provider, model usage, and account-level AI setup.',
    icon: BrainCircuit,
  },
  {
    slug: 'notifications',
    title: 'Notification Settings',
    description: 'Messaging channels, calendar connections, and alert delivery surfaces.',
    icon: Bell,
  },
  {
    slug: 'usage',
    title: 'Usage Overview',
    description: 'Token totals, sessions, and model consumption history.',
    icon: ChartColumn,
  },
  {
    slug: 'scheduled-jobs',
    title: 'Scheduled Jobs',
    description: 'Create, review, and delete automated jobs for your agent.',
    icon: Clock3,
  },
  {
    slug: 'agent',
    title: 'Agent Settings',
    description: 'Skill toggles, readiness, and OpenClaw agent controls.',
    icon: Bot,
  },
] as const;

export type SettingsSectionSlug = (typeof settingsSections)[number]['slug'];

export function formatTime(value?: number) {
  if (!value) {
    return 'Unknown';
  }

  return new Date(value).toLocaleString();
}

export function formatNumber(value?: number | null) {
  return new Intl.NumberFormat().format(value ?? 0);
}

export function findSettingsSection(slug: string) {
  return settingsSections.find((section) => section.slug === slug);
}

export function SettingsIndexPage() {
  return (
    <>
      <PageHero
        badge="Settings"
        title="Choose a settings category to open its detail screen."
        description="This top-level screen stays lightweight and scrollable. Each row routes into a dedicated settings page for that category."
        meta={
          <>
            <span className="insight-chip">Model Settings</span>
            <span className="insight-chip">Notification Settings</span>
            <span className="insight-chip">Usage Overview</span>
            <span className="insight-chip">Scheduled Jobs</span>
            <span className="insight-chip">Agent Settings</span>
          </>
        }
      />

      <section className="settings-index-list" aria-label="Settings categories">
        {settingsSections.map((section) => {
          const Icon = section.icon;

          return (
            <Link key={section.slug} href={`/settings/${section.slug}`} className="settings-nav-row">
              <div className="settings-nav-row__icon">
                <Icon className="h-5 w-5" />
              </div>
              <div className="settings-nav-row__copy">
                <strong>{section.title}</strong>
                <p>{section.description}</p>
              </div>
              <ChevronRight className="settings-nav-row__chevron h-5 w-5" />
            </Link>
          );
        })}
      </section>
    </>
  );
}

function SettingsDetailShell({
  badge,
  title,
  description,
  children,
}: {
  badge: string;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <PageHero
        badge={badge}
        title={title}
        description={description}
        actions={
          <Link href="/settings" className="settings-back-link">
            <ChevronLeft className="h-4 w-4" />
            Back to Settings
          </Link>
        }
      />
      {children}
    </>
  );
}

function useSettingsSnapshot() {
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);

  useEffect(() => {
    void loadSettings();
  }, []);

  async function loadSettings() {
    setLoading(true);
    const response = await apiFetch('/api/openclaw/settings');
    const data = await response.json();

    if (!response.ok) {
      setStatus(data.message || 'Failed to load OpenClaw settings');
      setLoading(false);
      return;
    }

    setSnapshot(data);
    setStatus('');
    setLoading(false);
  }

  return {
    loading,
    snapshot,
    status,
    setSnapshot,
    setStatus,
  };
}

function SettingsStatus({
  status,
  probe,
}: {
  status: string;
  probe?: string;
}) {
  return (
    <>
      {status ? <StatusBanner tone="danger">{status}</StatusBanner> : null}
      {probe && probe !== 'Not configured' ? (
        <StatusBanner tone={probe.toLowerCase().includes('failed') ? 'warning' : 'neutral'}>
          Channel probe: {probe}
        </StatusBanner>
      ) : null}
    </>
  );
}

export function ModelSettingsDetail() {
  const { loading, snapshot, status } = useSettingsSnapshot();
  const [modelStatus, setModelStatus] = useState('');
  const [modelSettings, setModelSettings] = useState<ModelSettingsPayload | null>(null);
  const [selectedConfigId, setSelectedConfigId] = useState('');
  const [savingModel, setSavingModel] = useState('');
  const [providerName, setProviderName] = useState('');
  const [serviceBaseUrl, setServiceBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [modelName, setModelName] = useState('');
  const [maxContextWindow, setMaxContextWindow] = useState('');
  const [maxOutputTokens, setMaxOutputTokens] = useState('');

  useEffect(() => {
    void loadModelSettings();
  }, []);

  function populateForm(config: SavedModelConfig | null) {
    if (!config) {
      return;
    }

    setSelectedConfigId(config.id);
    setProviderName(config.providerName);
    setServiceBaseUrl(config.serviceBaseUrl);
    setApiKey('');
    setModelName(config.modelName);
    setMaxContextWindow(config.maxContextWindow ? String(config.maxContextWindow) : '');
    setMaxOutputTokens(config.maxOutputTokens ? String(config.maxOutputTokens) : '');
  }

  function seedNewModelForm(source?: SavedModelConfig | null) {
    setSelectedConfigId('');
    setProviderName(source?.providerName ?? '');
    setServiceBaseUrl(source?.serviceBaseUrl ?? '');
    setApiKey('');
    setModelName('');
    setMaxContextWindow(source?.maxContextWindow ? String(source.maxContextWindow) : '');
    setMaxOutputTokens(source?.maxOutputTokens ? String(source.maxOutputTokens) : '');
  }

  async function loadModelSettings(nextSelectedId?: string) {
    const response = await apiFetch('/api/openclaw/model-settings');
    const data = await response.json();

    if (!response.ok) {
      setModelStatus(data.message || 'Failed to load model settings');
      return;
    }

    setModelSettings(data);
    setModelStatus('');

    const targetId = nextSelectedId ?? data.selectedConfigId ?? data.activeConfigId ?? data.configs[0]?.id ?? '';
    const targetConfig = data.configs.find((config: SavedModelConfig) => config.id === targetId) ?? data.configs[0] ?? null;

    if (targetConfig) {
      populateForm(targetConfig);
    } else {
      seedNewModelForm();
    }
  }

  async function saveModelConfig(activate: boolean) {
    if (!providerName.trim() || !serviceBaseUrl.trim() || !modelName.trim()) {
      setModelStatus('Provider name, Service Base URL, and model name are required.');
      return;
    }

    setSavingModel(activate ? 'activate' : 'save');
    const response = await apiFetch('/api/openclaw/model-settings', {
      method: 'POST',
      body: JSON.stringify({
        configId: selectedConfigId || undefined,
        providerName: providerName.trim(),
        serviceBaseUrl: serviceBaseUrl.trim(),
        apiKey: apiKey.trim() || undefined,
        modelName: modelName.trim(),
        maxContextWindow: maxContextWindow.trim() || undefined,
        maxOutputTokens: maxOutputTokens.trim() || undefined,
        activate,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setModelStatus(data.message || 'Failed to save model settings');
      setSavingModel('');
      return;
    }

    setApiKey('');
    setModelSettings(data);
    setModelStatus(activate ? 'Model settings saved and loaded.' : 'Model settings saved.');
    const targetId = data.selectedConfigId ?? data.activeConfigId ?? selectedConfigId ?? data.configs[0]?.id ?? '';
    const targetConfig = data.configs.find((config: SavedModelConfig) => config.id === targetId) ?? data.configs[0] ?? null;
    if (targetConfig) {
      populateForm(targetConfig);
    }
    setSavingModel('');
  }

  async function activateSelectedConfig() {
    if (!selectedConfigId) {
      setModelStatus('Select a saved model before loading it.');
      return;
    }

    setSavingModel('load');
    const response = await apiFetch(`/api/openclaw/model-settings/${encodeURIComponent(selectedConfigId)}/activate`, {
      method: 'POST',
    });
    const data = await response.json();

    if (!response.ok) {
      setModelStatus(data.message || 'Failed to load saved model');
      setSavingModel('');
      return;
    }

    setApiKey('');
    setModelSettings(data);
    setModelStatus('Saved model loaded.');
    const targetConfig = data.configs.find((config: SavedModelConfig) => config.id === (data.selectedConfigId ?? data.activeConfigId ?? selectedConfigId)) ?? null;
    if (targetConfig) {
      populateForm(targetConfig);
    }
    setSavingModel('');
  }

  return (
    <SettingsDetailShell
      badge="Model Settings"
      title="Manage the model setup behind your StudyClaw agent."
      description="This page holds provider-level setup and the model-specific usage summary that was previously mixed into the main settings screen."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />
      {modelStatus ? <StatusBanner tone={modelStatus.toLowerCase().includes('failed') ? 'danger' : 'neutral'}>{modelStatus}</StatusBanner> : null}

      <div className="card-grid">
        <section className="secondary-card">
          <p className="eyebrow">Saved model configs</p>
          <div className="form-field" style={{ marginTop: 12 }}>
            <label htmlFor="saved-model-config">Previously saved provider/model</label>
            <select
              id="saved-model-config"
              value={selectedConfigId}
              onChange={(event) => {
                const nextId = event.target.value;
                const nextConfig = modelSettings?.configs.find((config) => config.id === nextId) ?? null;
                if (nextConfig) {
                  populateForm(nextConfig);
                } else {
                  seedNewModelForm(modelSettings?.configs.find((config) => config.isActive) ?? null);
                }
              }}
            >
              <option value="">Select a saved model</option>
              {(modelSettings?.configs ?? []).map((config) => (
                <option key={config.id} value={config.id}>
                  {config.label}{config.isActive ? ' (active)' : ''}{!config.isFunctional ? ' (needs key)' : ''}
                </option>
              ))}
            </select>
          </div>
          <p className="muted-copy" style={{ marginTop: 10 }}>
            Loading a saved config prefills the form below so the user can keep the suggested values or customize them before saving again.
          </p>
          <div className="actions">
            <button type="button" onClick={() => void activateSelectedConfig()} disabled={!selectedConfigId || savingModel === 'load'}>
              {savingModel === 'load' ? 'Loading...' : 'Load selected model'}
            </button>
            <button
              type="button"
              className="ghost-button"
              onClick={() => seedNewModelForm(modelSettings?.configs.find((config) => config.isActive) ?? null)}
            >
              Add new model
            </button>
          </div>
        </section>

        <section className="secondary-card">
          <p className="eyebrow">Usage snapshot</p>
          <div className="metrics-grid" style={{ marginTop: 12 }}>
            <div className="metric-panel">
              <strong>{loading ? '...' : formatNumber(snapshot?.usage.inputTokens)}</strong>
              <span>Input tokens</span>
            </div>
            <div className="metric-panel">
              <strong>{loading ? '...' : formatNumber(snapshot?.usage.outputTokens)}</strong>
              <span>Output tokens</span>
            </div>
            <div className="metric-panel">
              <strong>{loading ? '...' : formatNumber(snapshot?.usage.totalTokens)}</strong>
              <span>Total tokens</span>
            </div>
            <div className="metric-panel">
              <strong>{loading ? '...' : snapshot?.usage.models.length ?? 0}</strong>
              <span>Models used</span>
            </div>
          </div>
        </section>
      </div>

      <section className="secondary-card">
        <p className="eyebrow">Provider and model form</p>
        <div className="form-grid">
          <div className="form-field">
            <label htmlFor="provider-name">Provider name</label>
            <input
              id="provider-name"
              value={providerName}
              onChange={(event) => setProviderName(event.target.value)}
              placeholder="OpenRouter"
            />
          </div>
          <div className="form-field">
            <label htmlFor="service-base-url">Service Base URL</label>
            <input
              id="service-base-url"
              value={serviceBaseUrl}
              onChange={(event) => setServiceBaseUrl(event.target.value)}
              placeholder="https://openrouter.ai/api/v1"
            />
          </div>
          <div className="form-field">
            <label htmlFor="api-key">API Key</label>
            <input
              id="api-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Leave blank to keep a stored key for this provider"
            />
          </div>
          <div className="form-field">
            <label htmlFor="model-name">Model name</label>
            <input
              id="model-name"
              value={modelName}
              onChange={(event) => setModelName(event.target.value)}
              placeholder="auto"
            />
          </div>
          <div className="form-field">
            <label htmlFor="max-context-window">Max Context Window</label>
            <input
              id="max-context-window"
              inputMode="numeric"
              value={maxContextWindow}
              onChange={(event) => setMaxContextWindow(event.target.value)}
              placeholder="200000"
            />
          </div>
          <div className="form-field">
            <label htmlFor="max-output-tokens">Max Output Tokens</label>
            <input
              id="max-output-tokens"
              inputMode="numeric"
              value={maxOutputTokens}
              onChange={(event) => setMaxOutputTokens(event.target.value)}
              placeholder="8192"
            />
          </div>
        </div>
        <p className="muted-copy" style={{ marginTop: 14 }}>
          Required: provider name, Service Base URL, and model name. API key is optional here and will be reused automatically for the same provider when one is already stored.
        </p>
        {selectedConfigId && modelSettings?.configs.find((config) => config.id === selectedConfigId)?.hasApiKey ? (
          <p className="muted-copy" style={{ marginTop: 8 }}>
            A stored API key already exists for this saved config. Leave the API key field blank to keep it.
          </p>
        ) : null}
        <div className="actions">
          <button type="button" onClick={() => void saveModelConfig(false)} disabled={savingModel === 'save' || savingModel === 'activate'}>
            {savingModel === 'save' ? 'Saving...' : selectedConfigId ? 'Save changes' : 'Save model'}
          </button>
          <button type="button" onClick={() => void saveModelConfig(true)} disabled={savingModel === 'save' || savingModel === 'activate'}>
            {savingModel === 'activate' ? 'Saving and loading...' : 'Save and load'}
          </button>
          <a href="/onboarding" className="ghost-button">Open onboarding</a>
        </div>
      </section>

      <section className="secondary-card">
        <p className="eyebrow">Model usage</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {(snapshot?.usage.models ?? []).length ? (
            snapshot?.usage.models.map((item) => (
              <div className="settings-row" key={item.model}>
                <div>
                  <strong>{item.model}</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                    {item.sessions} session{item.sessions === 1 ? '' : 's'}
                  </p>
                </div>
                <span className="settings-badge">{formatNumber(item.totalTokens)} tokens</span>
              </div>
            ))
          ) : (
            <p className="muted-copy">No session usage has been recorded for this personal agent yet.</p>
          )}
        </div>
      </section>
    </SettingsDetailShell>
  );
}

export function NotificationSettingsDetail() {
  const { snapshot, status } = useSettingsSnapshot();
  const [connectStatus, setConnectStatus] = useState('');
  const [telegramStatus, setTelegramStatus] = useState('');
  const [telegramCode, setTelegramCode] = useState('');
  const [telegramLoading, setTelegramLoading] = useState(true);
  const [telegramSaving, setTelegramSaving] = useState(false);
  const [telegramSettings, setTelegramSettings] = useState<TelegramSettingsPayload | null>(null);

  useEffect(() => {
    void loadTelegramSettings();
  }, []);

  async function loadTelegramSettings() {
    setTelegramLoading(true);
    const response = await apiFetch('/api/openclaw/telegram');
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setTelegramSettings(null);
      setTelegramStatus(data.message || 'Failed to load Telegram settings');
      setTelegramLoading(false);
      return;
    }

    setTelegramSettings(data);
    setTelegramStatus('');
    setTelegramLoading(false);
  }

  async function handleGoogleConnect() {
    try {
      setConnectStatus('');
      await beginGoogleConnect('/settings/notifications');
    } catch (error) {
      setConnectStatus(error instanceof Error ? error.message : 'Failed to start Google connection');
    }
  }

  async function handleTelegramApprove() {
    if (!telegramCode.trim()) {
      setTelegramStatus('Paste the pairing code from Telegram first.');
      return;
    }

    setTelegramSaving(true);
    const response = await apiFetch('/api/openclaw/telegram/approve', {
      method: 'POST',
      body: JSON.stringify({
        code: telegramCode.trim(),
      }),
    });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      setTelegramStatus(data.message || 'Failed to approve Telegram pairing');
      setTelegramSaving(false);
      return;
    }

    setTelegramSettings(data);
    setTelegramCode('');
    setTelegramStatus('Telegram is now linked to your StudyClaw agent.');
    setTelegramSaving(false);
  }

  return (
    <SettingsDetailShell
      badge="Notification Settings"
      title="Control where your agent can reach you."
      description="This screen covers messaging and calendar-connected notification surfaces so the top-level Settings page stays focused on navigation."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />
      {connectStatus ? <StatusBanner tone="danger">{connectStatus}</StatusBanner> : null}
      {telegramStatus ? (
        <StatusBanner tone={telegramStatus.toLowerCase().includes('failed') || telegramStatus.toLowerCase().includes('required') ? 'danger' : 'neutral'}>
          {telegramStatus}
        </StatusBanner>
      ) : null}

      <section className="secondary-card">
        <p className="eyebrow">Connected services</p>
        <p className="muted-copy" style={{ marginTop: 10 }}>
          Use onboarding to update your base model access, and connect Google services if you want reminders and schedule-aware workflows.
        </p>
        <div className="actions" style={{ marginTop: 14 }}>
          <a href="/onboarding" className="ghost-button">Change model or API key</a>
          <button type="button" className="ghost-button" onClick={() => void handleGoogleConnect()}>
            Connect Google Calendar/Drive
          </button>
        </div>
      </section>

      <section className="secondary-card">
        <p className="eyebrow">Telegram pairing</p>
        {telegramLoading ? (
          <p className="muted-copy" style={{ marginTop: 12 }}>Loading Telegram settings...</p>
        ) : !telegramSettings?.available ? (
          <p className="muted-copy" style={{ marginTop: 12 }}>
            {telegramSettings?.message || 'Choose Dixie or Willow during onboarding to unlock Telegram access.'}
          </p>
        ) : (
          <>
            <div className="settings-row" style={{ marginTop: 14 }}>
              <div>
                <strong>{telegramSettings.personaName} on Telegram</strong>
                <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                  Message <strong>{telegramSettings.botUsername}</strong> to continue talking to your agent outside the app.
                </p>
              </div>
              <span className={`settings-badge ${telegramSettings.paired ? 'is-live' : ''}`}>
                {telegramSettings.paired ? 'Paired' : 'Needs pairing'}
              </span>
            </div>

            <div className="settings-stack compact" style={{ marginTop: 14 }}>
              <div className="settings-row">
                <span className="muted-copy">Telegram channel</span>
                <strong>{telegramSettings.channelEnabled ? 'Enabled' : 'Disabled'}</strong>
              </div>
              <div className="settings-row">
                <span className="muted-copy">Bot account</span>
                <strong>{telegramSettings.accountConfigured ? 'Configured' : 'Missing token/config'}</strong>
              </div>
              <div className="settings-row">
                <span className="muted-copy">DM policy</span>
                <strong>{telegramSettings.dmPolicy || 'pairing'}</strong>
              </div>
              {telegramSettings.paired && telegramSettings.boundPeerId ? (
                <div className="settings-row">
                  <span className="muted-copy">Linked Telegram peer</span>
                  <strong>{telegramSettings.boundPeerId}</strong>
                </div>
              ) : null}
            </div>

            <div className="form-grid" style={{ marginTop: 18 }}>
              <div className="form-field">
                <label htmlFor="telegram-pairing-code">Telegram pairing code</label>
                <input
                  id="telegram-pairing-code"
                  value={telegramCode}
                  onChange={(event) => setTelegramCode(event.target.value.toUpperCase())}
                  placeholder="ABCD1234"
                />
              </div>
            </div>

            <p className="muted-copy" style={{ marginTop: 12 }}>
              1. Open Telegram and message {telegramSettings.botUsername}.
              {' '}
              2. Send any message or <strong>/start</strong>.
              {' '}
              3. Paste the pairing code you receive here.
              {' '}
              4. After approval, your Telegram DMs will route to your own StudyClaw agent.
            </p>

            <div className="actions" style={{ marginTop: 14 }}>
              <button
                type="button"
                onClick={() => void handleTelegramApprove()}
                disabled={telegramSaving || !telegramSettings.channelEnabled || !telegramSettings.accountConfigured}
              >
                {telegramSaving ? 'Approving...' : telegramSettings.paired ? 'Update Telegram link' : 'Approve Telegram'}
              </button>
              <button type="button" className="ghost-button" onClick={() => void loadTelegramSettings()}>
                Refresh Telegram status
              </button>
            </div>
          </>
        )}
      </section>

      <section className="secondary-card">
        <p className="eyebrow">Messaging channels</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {(snapshot?.channels ?? []).filter((channel) => channel.id !== 'whatsapp').map((channel) => (
            <article className="gateway-channel-card" key={channel.id}>
              <div className="gateway-channel-head">
                <div>
                  <h3 style={{ margin: 0 }}>{channel.label}</h3>
                  <p className="muted-copy" style={{ margin: '6px 0 0' }}>
                    {channel.enabled ? 'Enabled' : 'Disabled'}
                    {' · '}
                    Auth: {channel.authConfigured ? 'Configured' : 'Missing'}
                    {' · '}
                    Probe: {channel.capabilities.probe}
                  </p>
                </div>
                <span className={`settings-badge ${channel.enabled ? 'is-live' : ''}`}>
                  {channel.enabled ? 'Live' : 'Off'}
                </span>
              </div>

              <div className="settings-pill-row">
                {channel.capabilities.support.length ? (
                  channel.capabilities.support.slice(0, 8).map((item) => (
                    <span className="settings-pill" key={`${channel.id}-support-${item}`}>
                      {item}
                    </span>
                  ))
                ) : (
                  <span className="settings-pill muted">No live capability data</span>
                )}
              </div>

              <div className="settings-stack compact">
                {channel.settings.length ? (
                  channel.settings.map((setting) => (
                    <div className="settings-row" key={`${channel.id}-${setting.key}`}>
                      <span className="muted-copy">{setting.key}</span>
                      <strong>{setting.value}</strong>
                    </div>
                  ))
                ) : (
                  <p className="muted-copy">No safe settings are configured for this channel yet.</p>
                )}
              </div>

              <p className="muted-copy" style={{ margin: '12px 0 0' }}>
                Actions: {channel.capabilities.actions.length ? channel.capabilities.actions.join(', ') : 'Unavailable'}
              </p>
            </article>
          ))}
        </div>
      </section>
    </SettingsDetailShell>
  );
}

export function UsageOverviewDetail() {
  const { loading, snapshot, status } = useSettingsSnapshot();

  return (
    <SettingsDetailShell
      badge="Usage Overview"
      title="Review token usage and session activity."
      description="This page keeps the account-wide usage numbers and session history together as a dedicated detail view."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />

      <section className="secondary-card">
        <p className="eyebrow">Usage</p>
        <div className="metrics-grid" style={{ marginTop: 12 }}>
          <div className="metric-panel">
            <strong>{loading ? '...' : formatNumber(snapshot?.usage.inputTokens)}</strong>
            <span>Input tokens</span>
          </div>
          <div className="metric-panel">
            <strong>{loading ? '...' : formatNumber(snapshot?.usage.outputTokens)}</strong>
            <span>Output tokens</span>
          </div>
          <div className="metric-panel">
            <strong>{loading ? '...' : formatNumber(snapshot?.usage.totalTokens)}</strong>
            <span>Total tokens</span>
          </div>
          <div className="metric-panel">
            <strong>{loading ? '...' : snapshot?.sessions.length ?? 0}</strong>
            <span>Sessions</span>
          </div>
        </div>
      </section>

      <section className="secondary-card">
        <p className="eyebrow">Sessions</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {(snapshot?.sessions ?? []).length ? (
            snapshot?.sessions.map((session) => (
              <div className="settings-row session-row" key={session.sessionId ?? session.key}>
                <div>
                  <strong>{session.model ?? 'Unknown model'}</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                    {session.kind ?? 'direct'}
                    {' · '}
                    {session.modelProvider ?? 'unknown provider'}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <strong>{formatNumber(session.totalTokens)} tokens</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>{formatTime(session.updatedAt)}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="muted-copy">No sessions found for this user agent yet.</p>
          )}
        </div>
      </section>
    </SettingsDetailShell>
  );
}

export function ScheduledJobsDetail() {
  const { snapshot, status, setSnapshot, setStatus } = useSettingsSnapshot();
  const [cronName, setCronName] = useState('');
  const [cronMessage, setCronMessage] = useState('');
  const [cronScheduleKind, setCronScheduleKind] = useState<'at' | 'cron' | 'every'>('at');
  const [cronScheduleValue, setCronScheduleValue] = useState('');
  const [cronTimezone, setCronTimezone] = useState('America/New_York');
  const [updatingCron, setUpdatingCron] = useState('');

  async function createCronJob() {
    if (!cronName.trim() || !cronMessage.trim() || !cronScheduleValue.trim()) {
      setStatus('Cron name, prompt, and schedule are required.');
      return;
    }

    setUpdatingCron('create');
    const response = await apiFetch('/api/openclaw/cron', {
      method: 'POST',
      body: JSON.stringify({
        name: cronName.trim(),
        message: cronMessage.trim(),
        scheduleKind: cronScheduleKind,
        scheduleValue: cronScheduleValue.trim(),
        timezone: cronScheduleKind === 'cron' ? cronTimezone.trim() : undefined,
      }),
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(data.message || 'Failed to create cron job');
      setUpdatingCron('');
      return;
    }

    setSnapshot(data);
    setStatus('');
    setCronName('');
    setCronMessage('');
    setCronScheduleValue('');
    setUpdatingCron('');
  }

  async function deleteCronJob(jobId: string) {
    setUpdatingCron(jobId);
    const response = await apiFetch(`/api/openclaw/cron/${encodeURIComponent(jobId)}`, {
      method: 'DELETE',
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(data.message || 'Failed to delete cron job');
      setUpdatingCron('');
      return;
    }

    setSnapshot(data);
    setStatus('');
    setUpdatingCron('');
  }

  return (
    <SettingsDetailShell
      badge="Scheduled Jobs"
      title="Set up repeatable agent work."
      description="The cron editor and job list now live on their own detail page instead of competing with every other settings area."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />

      <div className="card-grid">
        <section className="secondary-card">
          <p className="eyebrow">Create job</p>
          <div className="form-field">
            <label htmlFor="cron-name">Job name</label>
            <input id="cron-name" value={cronName} onChange={(event) => setCronName(event.target.value)} placeholder="Daily study check-in" />
          </div>
          <div className="form-field">
            <label htmlFor="cron-message">Job prompt</label>
            <textarea
              id="cron-message"
              rows={4}
              value={cronMessage}
              onChange={(event) => setCronMessage(event.target.value)}
              placeholder="Tell your agent what to do when this cron job runs."
            />
          </div>
          <div className="form-field">
            <label htmlFor="cron-kind">Schedule type</label>
            <select id="cron-kind" value={cronScheduleKind} onChange={(event) => setCronScheduleKind(event.target.value as 'at' | 'cron' | 'every')}>
              <option value="at">Run once</option>
              <option value="cron">Cron expression</option>
              <option value="every">Repeat every</option>
            </select>
          </div>
          <div className="form-field">
            <label htmlFor="cron-value">{cronScheduleKind === 'at' ? 'When (ISO or +duration)' : cronScheduleKind === 'cron' ? 'Cron expression' : 'Repeat every duration'}</label>
            <input
              id="cron-value"
              value={cronScheduleValue}
              onChange={(event) => setCronScheduleValue(event.target.value)}
              placeholder={cronScheduleKind === 'at' ? '2026-03-25T13:03:00-04:00 or +20m' : cronScheduleKind === 'cron' ? '0 13 * * *' : '1h'}
            />
          </div>
          {cronScheduleKind === 'cron' ? (
            <div className="form-field">
              <label htmlFor="cron-timezone">Timezone</label>
              <input id="cron-timezone" value={cronTimezone} onChange={(event) => setCronTimezone(event.target.value)} placeholder="America/New_York" />
            </div>
          ) : null}
          <div className="actions">
            <button type="button" onClick={() => void createCronJob()} disabled={updatingCron === 'create'}>
              {updatingCron === 'create' ? 'Creating...' : 'Create cron job'}
            </button>
          </div>
        </section>

        <section className="secondary-card">
          <p className="eyebrow">System status</p>
          <div className="settings-stack" style={{ marginTop: 14 }}>
            <div className="settings-row">
              <div>
                <strong>Cron service</strong>
                <p className="muted-copy" style={{ margin: '4px 0 0' }}>{snapshot?.cron.status ?? 'Loading...'}</p>
              </div>
              <span className="settings-badge">{snapshot?.cron.jobs?.length ?? 0} jobs</span>
            </div>
          </div>
        </section>
      </div>

      <section className="secondary-card">
        <p className="eyebrow">Your jobs</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {(snapshot?.cron.jobs ?? []).length ? (
            snapshot?.cron.jobs.map((job) => {
              const jobId = String(job.jobId ?? job.id ?? '');
              const scheduleLabel =
                job.schedule?.kind === 'at'
                  ? job.schedule?.at
                  : job.schedule?.kind === 'every'
                    ? `${job.schedule?.everyMs ?? 'unknown'} ms`
                    : job.schedule?.expr ?? 'Unknown schedule';

              return (
                <div className="settings-row" key={jobId}>
                  <div>
                    <strong>{String(job.name ?? jobId)}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>{String(scheduleLabel)}</p>
                  </div>
                  <button
                    type="button"
                    className="chat-mini-button"
                    onClick={() => void deleteCronJob(jobId)}
                    disabled={updatingCron === jobId}
                  >
                    {updatingCron === jobId ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              );
            })
          ) : (
            <p className="muted-copy">No cron jobs created for this StudyClaw user yet.</p>
          )}
        </div>
      </section>
    </SettingsDetailShell>
  );
}

export function AgentSettingsDetail() {
  const { snapshot, status, setSnapshot, setStatus } = useSettingsSnapshot();
  const [skillQuery, setSkillQuery] = useState('');
  const [updatingSkill, setUpdatingSkill] = useState('');

  async function toggleSkill(skillName: string, enabled: boolean) {
    setUpdatingSkill(skillName);
    const response = await apiFetch(`/api/openclaw/skills/${encodeURIComponent(skillName)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    const data = await response.json();

    if (!response.ok) {
      setStatus(data.message || 'Failed to update skill');
      setUpdatingSkill('');
      return;
    }

    setSnapshot(data);
    setStatus('');
    setUpdatingSkill('');
  }

  const filteredSkills = useMemo(() => {
    return (snapshot?.skills.items ?? []).filter((skill) => {
      const query = skillQuery.trim().toLowerCase();
      if (!query) {
        return true;
      }

      return (
        skill.name.toLowerCase().includes(query) ||
        skill.description.toLowerCase().includes(query) ||
        skill.status.toLowerCase().includes(query)
      );
    });
  }, [skillQuery, snapshot?.skills.items]);

  return (
    <SettingsDetailShell
      badge="Agent Settings"
      title="Manage OpenClaw-specific agent controls."
      description="This page holds skill readiness and agent-level controls while the top-level Settings screen stays navigation-first."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />

      <div className="card-grid">
        <section className="secondary-card">
          <p className="eyebrow">System details</p>
          <div className="settings-stack" style={{ marginTop: 14 }}>
            <div className="settings-row">
              <div>
                <strong>Skill coverage</strong>
                <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                  Ready: {snapshot?.skills.readyCount ?? 0} / {snapshot?.skills.totalCount ?? 0}
                </p>
              </div>
              <span className="settings-badge">{filteredSkills.length} visible</span>
            </div>
            <div className="settings-row">
              <div>
                <strong>Sessions health</strong>
                <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                  {snapshot?.diagnostics.sessionsOk ? 'Session files look healthy.' : 'Session diagnostics need attention.'}
                </p>
              </div>
              <span className={`settings-badge ${snapshot?.diagnostics.sessionsOk ? 'is-live' : ''}`}>
                {snapshot?.diagnostics.sessionsOk ? 'OK' : 'Check'}
              </span>
            </div>
          </div>
        </section>

        <section className="secondary-card">
          <p className="eyebrow">Search skills</p>
          <div className="form-field" style={{ marginTop: 12 }}>
            <label htmlFor="skill-query">Filter by name, description, or status</label>
            <input
              id="skill-query"
              value={skillQuery}
              onChange={(event) => setSkillQuery(event.target.value)}
              placeholder="Search skills"
            />
          </div>
        </section>
      </div>

      <section className="secondary-card">
        <p className="eyebrow">Skills</p>
        <div className="settings-stack" style={{ marginTop: 14 }}>
          {filteredSkills.length ? (
            filteredSkills.map((skill) => (
              <div className="settings-row" key={skill.name}>
                <div>
                  <strong>{skill.name}</strong>
                  <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                    {skill.description}
                    {' · '}
                    {skill.status}
                    {' · '}
                    {skill.source}
                  </p>
                </div>
                <button
                  type="button"
                  className={`toggle-chip ${skill.enabled ? 'is-on' : ''}`}
                  onClick={() => void toggleSkill(skill.name, !skill.enabled)}
                  disabled={updatingSkill === skill.name}
                >
                  {updatingSkill === skill.name ? 'Updating...' : skill.enabled ? 'Enabled' : 'Disabled'}
                </button>
              </div>
            ))
          ) : (
            <p className="muted-copy">No skills match your current filter.</p>
          )}
        </div>
      </section>
    </SettingsDetailShell>
  );
}
