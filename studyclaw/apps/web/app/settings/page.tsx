'use client';

import { useEffect, useState } from 'react';
import PageHero from '../components/page-hero';
import StatusBanner from '../components/status-banner';
import { apiFetch } from '../../lib/api';

type ChannelItem = {
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

type SessionItem = {
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

type SettingsSnapshot = {
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
    jobs: Array<Record<string, unknown>>;
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

function formatTime(value?: number) {
  if (!value) {
    return 'Unknown';
  }

  return new Date(value).toLocaleString();
}

function formatNumber(value?: number | null) {
  return new Intl.NumberFormat().format(value ?? 0);
}

export default function SettingsPage() {
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);
  const [snapshot, setSnapshot] = useState<SettingsSnapshot | null>(null);
  const [skillQuery, setSkillQuery] = useState('');
  const [updatingSkill, setUpdatingSkill] = useState('');

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

  const filteredSkills = (snapshot?.skills.items ?? []).filter((skill) => {
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

  return (
    <>
      <PageHero
        badge="OpenClaw control"
        title="Gateway-style controls for channels, sessions, usage, cron, skills, and logs."
        description="This mirrors the OpenClaw dashboard surface inside StudyClaw using the same local config and CLI data where available."
        meta={
          <>
            <span className="insight-chip">Telegram</span>
            <span className="insight-chip">Discord</span>
            <span className="insight-chip">Personal agent only</span>
          </>
        }
      />

      {status ? <StatusBanner tone="danger">{status}</StatusBanner> : null}
      {snapshot && snapshot.diagnostics.channelsProbe !== 'Not configured' ? (
        <StatusBanner tone={snapshot.diagnostics.channelsProbe.toLowerCase().includes('failed') ? 'warning' : 'neutral'}>
          Channel probe: {snapshot.diagnostics.channelsProbe}
        </StatusBanner>
      ) : null}

      <div className="card-grid">
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
          <p className="eyebrow">Model usage</p>
          <div className="settings-stack">
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
      </div>

      <section className="secondary-card">
        <p className="eyebrow">Access and channels</p>
        <p className="muted-copy" style={{ marginTop: 10 }}>
          Use onboarding to add or change your model provider and API key. Telegram and Discord are the only messaging channels shown here.
        </p>
        <div className="actions" style={{ marginTop: 14 }}>
          <a href="/onboarding" className="ghost-button">Change model or API key</a>
        </div>
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

      <div className="card-grid">
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
                <strong>Cron jobs</strong>
                <p className="muted-copy" style={{ margin: '4px 0 0' }}>{snapshot?.cron.status ?? 'Loading...'}</p>
              </div>
              <span className="settings-badge">{snapshot?.cron.jobs?.length ?? 0}</span>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
