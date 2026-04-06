'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Bell, Bot, BrainCircuit, ChartColumn, Clock3 } from 'lucide-react';
import StatusBanner from '../components/status-banner';
import { apiFetch, beginGoogleConnect } from '../../lib/api';
import { readStoredSession } from '../../lib/session';
import {
  findPreset,
  GOOGLE_AI_STUDIO_URL,
  isGoogleAiStudioApiKey,
  PROVIDER_PRESETS,
} from '../../lib/model-setup';

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
    items: Array<{ status: string; name: string; displayName?: string; description: string; source: string; enabled: boolean }>;
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

export type SavedModelConfig = {
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

export type ModelSettingsPayload = {
  currentModelKey: string | null;
  activeConfigId: string | null;
  selectedConfigId?: string | null;
  configs: SavedModelConfig[];
  accessProfile?: UsageAccessProfile;
  managedMiniMaxModelKeys?: string[];
};

export type UsageAccessProfile = {
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

export type GoogleIntegrationSummary = {
  status?: 'not_connected' | 'connected' | 'reconnect_required';
  connected?: boolean;
  needsReconnect?: boolean;
  googleEmail?: string | null;
  account?: string | null;
  error?: string | null;
};

export type ManagedUsageAccountSummary = {
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

export type ManagedUsageEventItem = {
  id: string;
  feature: string;
  modelKey: string;
  status: 'reserved' | 'consumed' | 'failed';
  requestUnits: number;
  reservedAt: string;
  finalizedAt: string | null;
  metadata: Record<string, unknown>;
};

export type TelegramSettingsPayload = {
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

export type CronJobItem = {
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

export function formatCountdown(targetIso: string | null, nowMs: number) {
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

export function SettingsUsageRail() {
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

export function SettingsDetailShell({
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

export function useSettingsSnapshot() {
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

export function SettingsStatus({
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
