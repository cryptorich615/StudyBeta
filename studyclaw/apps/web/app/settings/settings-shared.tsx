'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Bell, Bot, BrainCircuit, ChartColumn, Clock3 } from 'lucide-react';
import StatusBanner from '../components/status-banner';
import { apiFetch, beginGoogleConnect } from '../../lib/api';
import { readStoredSession } from '../../lib/session';

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
  accessProfile?: UsageAccessProfile;
  managedMiniMaxModelKeys?: string[];
};

type UsageAccessProfile = {
  role: string;
  tier: 'tier_1' | 'tier_2' | 'tier_3' | null;
  billingMode: 'managed' | 'byok' | 'local' | 'admin' | 'unknown';
  providerSelection: string | null;
  modelSelection: string | null;
  usesManagedCredits: boolean;
  isByok: boolean;
  isManaged: boolean;
  creditsTotal: number | null;
  creditsRemaining: number | null;
  internalUsageIdentity: string | null;
  identityStatus: string | null;
  windowHours: number;
  windowLimit: number | null;
  usedInWindow: number;
  remainingInWindow: number | null;
  resetsAt: string | null;
  recentEvents: Array<{
    id: string;
    feature: string;
    modelKey: string;
    status: 'reserved' | 'consumed' | 'failed';
    reservedAt: string;
    finalizedAt: string | null;
    metadata: Record<string, unknown>;
  }>;
};

type ManagedUsageAccountSummary = {
  userId: string;
  email: string;
  role: string;
  tier: 'tier_1' | 'tier_2' | 'tier_3' | null;
  billingMode: 'managed' | 'byok' | 'local' | 'admin' | 'unknown';
  providerSelection: string | null;
  modelSelection: string | null;
  usesManagedCredits: boolean;
  creditsTotal: number;
  creditsRemaining: number;
  internalUsageIdentity: string | null;
  identityStatus: string | null;
  usedInWindow: number;
  windowLimit: number | null;
  remainingInWindow: number | null;
  latestWindowEventAt: string | null;
};

type ManagedUsageEventItem = {
  id: string;
  feature: string;
  modelKey: string;
  status: 'reserved' | 'consumed' | 'failed';
  requestUnits: number;
  reservedAt: string;
  finalizedAt: string | null;
  metadata: Record<string, unknown>;
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

function formatCountdown(targetIso: string | null, nowMs: number) {
  if (!targetIso) {
    return 'No active reset window';
  }

  const diff = Math.max(new Date(targetIso).getTime() - nowMs, 0);
  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return `${hours}h ${minutes}m ${seconds}s`;
}

function SettingsUsageRail() {
  const [accessProfile, setAccessProfile] = useState<UsageAccessProfile | null>(null);
  const [railStatus, setRailStatus] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    let active = true;

    const loadAccessProfile = async () => {
      const response = await apiFetch('/api/openclaw/model-settings');
      const data = await response.json().catch(() => ({}));

      if (!active) {
        return;
      }

      if (!response.ok) {
        setRailStatus(data.message || 'Failed to load usage');
        return;
      }

      setAccessProfile(data.accessProfile ?? null);
      setRailStatus('');
    };

    void loadAccessProfile();
    const pollId = window.setInterval(() => {
      void loadAccessProfile();
    }, 10000);
    const tickId = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => {
      active = false;
      window.clearInterval(pollId);
      window.clearInterval(tickId);
    };
  }, []);

  if (railStatus) {
    return <StatusBanner tone="warning">{railStatus}</StatusBanner>;
  }

  if (!accessProfile) {
    return null;
  }

  const windowLimit = accessProfile.windowLimit ?? 0;
  const usedInWindow = accessProfile.usedInWindow ?? 0;
  const remainingWindow = accessProfile.remainingInWindow ?? 0;
  const progressRatio =
    windowLimit > 0
      ? Math.min(Math.max(remainingWindow / windowLimit, 0), 1)
      : 1;
  const progressPercent = Math.round(progressRatio * 100);
  const railToneClass =
    progressRatio <= 0.2 ? 'is-critical' : progressRatio <= 0.45 ? 'is-warning' : 'is-healthy';

  return (
    <section className="settings-usage-rail" aria-label="Usage and reset window">
      <div className="settings-usage-rail__head">
        <div>
          <p className="eyebrow">Usage window</p>
          <h3 style={{ margin: '6px 0 0' }}>
            {accessProfile.windowLimit === null
              ? accessProfile.billingMode === 'admin'
                ? 'Admin account is exempt from managed limits'
                : 'This account is not on StudyClaw-managed 5-hour limits'
              : `${progressPercent}% window capacity remaining`}
          </h3>
        </div>
        <div className="settings-usage-rail__stats">
          <span className="settings-badge">{accessProfile.tier ?? accessProfile.billingMode}</span>
          {accessProfile.creditsRemaining !== null ? (
            <span className="settings-badge">{accessProfile.creditsRemaining} credits left</span>
          ) : null}
        </div>
      </div>

      <div
        className={`settings-usage-rail__track ${railToneClass}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={accessProfile.windowLimit ?? 100}
        aria-valuenow={accessProfile.remainingInWindow ?? accessProfile.windowLimit ?? 0}
      >
        <div className="settings-usage-rail__fill" style={{ width: `${progressRatio * 100}%` }} />
        <div className="settings-usage-rail__labels">
          <span>{windowLimit ? `${remainingWindow}/${windowLimit} left` : 'Not limited'}</span>
          {windowLimit ? <strong>{usedInWindow} used</strong> : null}
        </div>
      </div>

      <div className="settings-usage-rail__metrics">
        <div className="settings-usage-rail__metric">
          <span>Credits left</span>
          <strong>{accessProfile.creditsRemaining ?? 'n/a'}</strong>
        </div>
        <div className="settings-usage-rail__metric">
          <span>Window usage</span>
          <strong>
            {accessProfile.windowLimit === null ? 'Not limited' : `${usedInWindow}/${windowLimit}`}
          </strong>
        </div>
        <div className="settings-usage-rail__metric">
          <span>Reset countdown</span>
          <strong>
            {accessProfile.windowLimit === null
              ? 'No countdown'
              : formatCountdown(accessProfile.resetsAt, nowMs)}
          </strong>
        </div>
      </div>
    </section>
  );
}

export function SettingsIndexPage() {
  return (
    <section className="settings-shell">
      <header className="settings-page-header">
        <div>
          <p className="settings-page-header__eyebrow">Settings</p>
          <h1 className="settings-page-header__title">Manage your StudyClaw account, agent, and connected tools.</h1>
          <p className="settings-page-header__description">
            Open each category to adjust the part of StudyClaw you want to change, without wading through one long utility screen.
          </p>
        </div>
        <div className="settings-page-header__meta">
          <div className="settings-page-header__meta-card">
            <span>Categories</span>
            <strong>{settingsSections.length}</strong>
          </div>
          <div className="settings-page-header__meta-card">
            <span>Core areas</span>
            <strong>Model, usage, notifications</strong>
          </div>
        </div>
      </header>

      <section className="settings-spotlight-grid" aria-label="Settings overview">
        {settingsSections.slice(0, 3).map((section) => {
          const Icon = section.icon;
          return (
            <article key={section.slug} className="settings-spotlight-card">
              <div className="settings-spotlight-card__icon">
                <Icon className="h-5 w-5" />
              </div>
              <div>
                <strong>{section.title}</strong>
                <p>{section.description}</p>
              </div>
            </article>
          );
        })}
      </section>

      <SettingsUsageRail />

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
    </section>
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
    <section className="settings-shell settings-shell--detail">
      <header className="settings-page-header settings-page-header--detail">
        <div>
          <p className="settings-page-header__eyebrow">{badge}</p>
          <h1 className="settings-page-header__title">{title}</h1>
          <p className="settings-page-header__description">{description}</p>
        </div>
        <div className="settings-page-header__actions">
          <Link href="/settings" className="settings-back-link">
            <ChevronLeft className="h-4 w-4" />
            Back to Settings
          </Link>
        </div>
      </header>
      <SettingsUsageRail />
      <div className="settings-detail-stack">{children}</div>
    </section>
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
          {modelSettings?.accessProfile ? (
            <div className="settings-stack compact" style={{ marginTop: 16 }}>
              <div className="settings-row">
                <span className="muted-copy">Billing mode</span>
                <strong>{modelSettings.accessProfile.billingMode}</strong>
              </div>
              <div className="settings-row">
                <span className="muted-copy">Tier</span>
                <strong>{modelSettings.accessProfile.tier ?? 'n/a'}</strong>
              </div>
              <div className="settings-row">
                <span className="muted-copy">Managed usage</span>
                <strong>{modelSettings.accessProfile.isManaged ? 'Active' : modelSettings.accessProfile.isByok ? 'BYOK' : 'Not managed'}</strong>
              </div>
              <div className="settings-row">
                <span className="muted-copy">Rolling window</span>
                <strong>
                  {modelSettings.accessProfile.windowLimit === null
                    ? 'Not limited'
                    : `${modelSettings.accessProfile.usedInWindow}/${modelSettings.accessProfile.windowLimit} used`}
                </strong>
              </div>
              {modelSettings.accessProfile.remainingInWindow !== null ? (
                <div className="settings-row">
                  <span className="muted-copy">Remaining</span>
                  <strong>{modelSettings.accessProfile.remainingInWindow}</strong>
                </div>
              ) : null}
              {modelSettings.accessProfile.creditsRemaining !== null ? (
                <div className="settings-row">
                  <span className="muted-copy">Credits remaining</span>
                  <strong>{modelSettings.accessProfile.creditsRemaining}</strong>
                </div>
              ) : null}
              {modelSettings.accessProfile.internalUsageIdentity ? (
                <div className="settings-row">
                  <span className="muted-copy">Internal identity</span>
                  <strong>{modelSettings.accessProfile.internalUsageIdentity}</strong>
                </div>
              ) : null}
            </div>
          ) : null}
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
  const [accessProfile, setAccessProfile] = useState<UsageAccessProfile | null>(null);
  const [adminAccounts, setAdminAccounts] = useState<ManagedUsageAccountSummary[]>([]);
  const [selectedAdminAccount, setSelectedAdminAccount] = useState<string>('');
  const [selectedAdminEvents, setSelectedAdminEvents] = useState<ManagedUsageEventItem[]>([]);
  const [adminStatus, setAdminStatus] = useState('');
  const [updatingTierFor, setUpdatingTierFor] = useState('');
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const nextIsAdmin = readStoredSession()?.user?.role === 'admin';
    setIsAdmin(nextIsAdmin);
    void loadUsageState(nextIsAdmin);
  }, []);

  async function loadUsageState(adminOverride = isAdmin) {
    const modelResponse = await apiFetch('/api/openclaw/model-settings');
    const modelData = await modelResponse.json().catch(() => ({}));
    if (modelResponse.ok) {
      setAccessProfile(modelData.accessProfile ?? null);
    }

    if (!adminOverride) {
      return;
    }

    const adminResponse = await apiFetch('/api/admin/managed-usage');
    const adminData = await adminResponse.json().catch(() => ({}));
    if (!adminResponse.ok) {
      setAdminStatus(adminData.message || 'Failed to load managed usage accounts');
      return;
    }

    setAdminAccounts(adminData.accounts ?? []);
    setAdminStatus('');
  }

  async function updateTier(userId: string, tier: 'tier_1' | 'tier_2' | 'tier_3') {
    setUpdatingTierFor(userId);
    const response = await apiFetch(`/api/admin/managed-usage/${encodeURIComponent(userId)}/tier`, {
      method: 'PATCH',
      body: JSON.stringify({ tier }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setAdminStatus(data.message || 'Failed to update tier');
      setUpdatingTierFor('');
      return;
    }

    await loadUsageState();
    setUpdatingTierFor('');
  }

  async function inspectManagedUsageUser(userId: string) {
    setSelectedAdminAccount(userId);
    const response = await apiFetch(`/api/admin/managed-usage/${encodeURIComponent(userId)}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      setAdminStatus(data.message || 'Failed to load managed usage events');
      return;
    }

    setSelectedAdminEvents(data.events ?? []);
    setAdminStatus('');
  }

  return (
    <SettingsDetailShell
      badge="Usage Overview"
      title="Review token usage and session activity."
      description="This page keeps the account-wide usage numbers and session history together as a dedicated detail view."
    >
      <SettingsStatus status={status} probe={snapshot?.diagnostics.channelsProbe} />
      {adminStatus ? <StatusBanner tone="danger">{adminStatus}</StatusBanner> : null}

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
        {accessProfile ? (
          <div className="settings-stack compact" style={{ marginTop: 16 }}>
            <div className="settings-row">
              <span className="muted-copy">Billing mode</span>
              <strong>{accessProfile.billingMode}</strong>
            </div>
            <div className="settings-row">
              <span className="muted-copy">Provider selection</span>
              <strong>{accessProfile.providerSelection ?? 'n/a'}</strong>
            </div>
            <div className="settings-row">
              <span className="muted-copy">Model selection</span>
              <strong>{accessProfile.modelSelection ?? 'n/a'}</strong>
            </div>
            <div className="settings-row">
              <span className="muted-copy">Tier</span>
              <strong>{accessProfile.tier ?? 'n/a'}</strong>
            </div>
            <div className="settings-row">
              <span className="muted-copy">Rolling 5-hour usage</span>
              <strong>
                {accessProfile.windowLimit === null
                  ? 'Not limited'
                  : `${accessProfile.usedInWindow}/${accessProfile.windowLimit}`}
              </strong>
            </div>
            {accessProfile.remainingInWindow !== null ? (
              <div className="settings-row">
                <span className="muted-copy">Remaining quota</span>
                <strong>{accessProfile.remainingInWindow}</strong>
              </div>
            ) : null}
            {accessProfile.creditsRemaining !== null ? (
              <div className="settings-row">
                <span className="muted-copy">Remaining credits</span>
                <strong>{accessProfile.creditsRemaining}</strong>
              </div>
            ) : null}
            {accessProfile.resetsAt ? (
              <div className="settings-row">
                <span className="muted-copy">Window resets</span>
                <strong>{formatTime(new Date(accessProfile.resetsAt).getTime())}</strong>
              </div>
            ) : null}
          </div>
        ) : null}
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

      {isAdmin ? (
        <section className="secondary-card">
          <p className="eyebrow">Managed account inspection</p>
          <div className="settings-stack" style={{ marginTop: 14 }}>
            {adminAccounts.length ? (
              adminAccounts.map((account) => (
                <div className="settings-row session-row" key={account.userId}>
                  <div>
                    <strong>{account.email}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                      {account.billingMode}
                      {' · '}
                      {account.modelSelection ?? 'No model'}
                      {' · '}
                      {account.internalUsageIdentity ?? 'No identity'}
                      {' · '}
                      {account.creditsRemaining} credits
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <strong>
                      {account.windowLimit === null
                        ? 'Not limited'
                        : `${account.usedInWindow}/${account.windowLimit}`}
                    </strong>
                    <div style={{ marginTop: 8, display: 'flex', gap: 8, justifyContent: 'flex-end', alignItems: 'center' }}>
                      <select
                        value={account.tier ?? 'tier_1'}
                        onChange={(event) => void updateTier(account.userId, event.target.value as 'tier_1' | 'tier_2' | 'tier_3')}
                        disabled={updatingTierFor === account.userId}
                      >
                        <option value="tier_1">tier_1</option>
                        <option value="tier_2">tier_2</option>
                        <option value="tier_3">tier_3</option>
                      </select>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void inspectManagedUsageUser(account.userId)}
                      >
                        Inspect events
                      </button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted-copy">No managed usage accounts found yet.</p>
            )}
          </div>
        </section>
      ) : null}

      {isAdmin && selectedAdminAccount ? (
        <section className="secondary-card">
          <p className="eyebrow">Recent usage events</p>
          <div className="settings-stack" style={{ marginTop: 14 }}>
            {selectedAdminEvents.length ? (
              selectedAdminEvents.map((event) => (
                <div className="settings-row session-row" key={event.id}>
                  <div>
                    <strong>{event.feature}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                      {event.modelKey}
                      {' · '}
                      {event.status}
                      {' · '}
                      {event.requestUnits} unit{event.requestUnits === 1 ? '' : 's'}
                    </p>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <strong>{formatTime(new Date(event.reservedAt).getTime())}</strong>
                    <p className="muted-copy" style={{ margin: '4px 0 0' }}>
                      {event.finalizedAt ? `Finalized ${formatTime(new Date(event.finalizedAt).getTime())}` : 'Pending finalization'}
                    </p>
                  </div>
                </div>
              ))
            ) : (
              <p className="muted-copy">No recent usage events found for this account.</p>
            )}
          </div>
        </section>
      ) : null}
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
