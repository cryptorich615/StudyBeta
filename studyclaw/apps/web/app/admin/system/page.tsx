'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { AdminEmptyState, AdminPageHeader, AdminSavedViewsPanel, AdminStatCard, StatusPill } from '../admin-shared';

type SystemPayload = {
  dependencies: {
    database: { status: string; checkedAt: string };
    minimax: { status: string };
    googleOAuth: { status: string };
    openclaw: { status: string; sessionsOk: boolean; skillsOk: boolean; channelsProbe: string };
  };
  featureFlags: Record<string, boolean>;
  incidentTimeline: Array<{
    day: string;
    failedRequests: number;
    totalRequests: number;
    auditEvents: number;
  }>;
  recentFailures: Array<{
    id: string;
    userId: string;
    email: string;
    providerId: string;
    modelKey: string;
    feature: string;
    reservedAt: string;
    failureSummary: string;
  }>;
  notices: Array<{ level: 'info' | 'warning' | 'critical'; message: string }>;
};

type SystemPresetState = {
  failureFilter: string;
};

export default function AdminSystemPage() {
  const [data, setData] = useState<SystemPayload | null>(null);
  const [error, setError] = useState('');
  const [failureFilter, setFailureFilter] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      const response = await apiFetch('/api/admin/system');
      const payload = await response.json().catch(() => null);
      if (!active) return;

      if (!response.ok || !payload) {
        setError(payload?.message || 'Failed to load system status.');
        return;
      }

      setData(payload as SystemPayload);
      setError('');
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const degradedDependencies = useMemo(() => {
    if (!data) return [];

    return [
      { key: 'Database', status: data.dependencies.database.status, tone: data.dependencies.database.status === 'healthy' ? 'success' : 'warning' },
      { key: 'MiniMax', status: data.dependencies.minimax.status, tone: data.dependencies.minimax.status === 'configured' ? 'success' : 'danger' },
      { key: 'Google OAuth', status: data.dependencies.googleOAuth.status, tone: data.dependencies.googleOAuth.status === 'configured' ? 'success' : 'warning' },
      { key: 'OpenClaw', status: data.dependencies.openclaw.status, tone: data.dependencies.openclaw.status === 'healthy' ? 'success' : 'warning' },
    ].filter((item) => item.tone !== 'success');
  }, [data]);
  const failureCauseOptions = useMemo(() => {
    const options = new Set<string>();
    for (const item of data?.recentFailures ?? []) {
      const normalized = normalizeFailureCause(item.failureSummary);
      if (normalized) options.add(normalized);
    }
    return [...options];
  }, [data?.recentFailures]);
  const filteredFailures = useMemo(() => {
    if (!failureFilter) return data?.recentFailures ?? [];
    return (data?.recentFailures ?? []).filter(
      (item) => normalizeFailureCause(item.failureSummary) === failureFilter
    );
  }, [data?.recentFailures, failureFilter]);
  const defaultSavedViews = useMemo(
    () => [
      {
        id: 'system-all',
        label: 'All failing requests',
        description: 'Show every recent system failure',
        state: { failureFilter: '' },
        readonly: true,
      },
      {
        id: 'system-quota',
        label: 'Quota exhaustion',
        description: 'Focus on credit and quota failures',
        state: { failureFilter: 'quota / credits' },
        readonly: true,
      },
      {
        id: 'system-auth',
        label: 'Auth failures',
        description: 'Review authorization and credential issues',
        state: { failureFilter: 'auth error' },
        readonly: true,
      },
      {
        id: 'system-gateway',
        label: 'Gateway errors',
        description: 'Inspect OpenClaw delivery problems',
        state: { failureFilter: 'gateway error' },
        readonly: true,
      },
    ] satisfies Array<{
      id: string;
      label: string;
      description: string;
      state: SystemPresetState;
      readonly: true;
    }>,
    []
  );

  return (
    <div className="admin-page-stack">
      <AdminPageHeader
        eyebrow="System"
        title="Platform health and configuration"
        description="Dependency status, configuration visibility, feature flags, and operational warnings."
      />

      {!error && data ? (
        <section className="admin-stats-grid">
          <AdminStatCard label="Dependency alerts" value={degradedDependencies.length} detail="Non-healthy dependency states" tone={degradedDependencies.length ? 'warning' : 'default'} />
          <AdminStatCard label="Feature flags" value={Object.keys(data.featureFlags).length} detail="Runtime feature toggles exposed to ops" />
          <AdminStatCard label="System notices" value={data.notices.length} detail="Warnings and missing configuration items" tone={data.notices.length ? 'warning' : 'default'} />
          <AdminStatCard label="Database" value={data.dependencies.database.status} detail="Primary persistence layer" tone={data.dependencies.database.status === 'healthy' ? 'default' : 'warning'} />
          <AdminStatCard label="MiniMax" value={data.dependencies.minimax.status} detail="Managed provider key state" tone={data.dependencies.minimax.status === 'configured' ? 'default' : 'danger'} />
          <AdminStatCard label="OpenClaw" value={data.dependencies.openclaw.status} detail="Gateway health state" tone={data.dependencies.openclaw.status === 'healthy' ? 'default' : 'warning'} />
        </section>
      ) : null}

      {error ? (
        <Card className="admin-alert-card is-danger">
          <CardContent className="admin-alert-card__content">{error}</CardContent>
        </Card>
      ) : null}

      <Card className="admin-panel">
        <CardHeader className="admin-panel__header">
          <CardTitle>Quick investigations</CardTitle>
          <div className="admin-panel__summary">
            <span>Fast entry points for recurring platform incidents</span>
          </div>
        </CardHeader>
        <CardContent className="admin-panel__content admin-quick-grid">
          <button type="button" className="admin-quick-card" onClick={() => setFailureFilter('quota / credits')}>
            <span>Quota exhaustion</span>
            <small>Show credit and quota-related failures only</small>
          </button>
          <button type="button" className="admin-quick-card" onClick={() => setFailureFilter('auth error')}>
            <span>Auth failures</span>
            <small>Focus on credential and authorization errors</small>
          </button>
          <button type="button" className="admin-quick-card" onClick={() => setFailureFilter('gateway error')}>
            <span>Gateway errors</span>
            <small>Review OpenClaw-related delivery problems</small>
          </button>
          <Link href="/admin/audit" className="admin-quick-card">
            <span>Open audit log</span>
            <small>Cross-check current incidents against admin actions</small>
          </Link>
        </CardContent>
      </Card>

      <AdminSavedViewsPanel
        title="Saved investigations"
        description="Reopen recurring platform incident slices without rebuilding filters."
        storageKey="studyclaw.admin.system.savedViews"
        defaults={defaultSavedViews}
        currentState={{ failureFilter }}
        suggestedLabel={failureFilter ? `${failureFilter} failures` : 'All system failures'}
        stateSummary={(state) => (state.failureFilter ? `Cause filter: ${state.failureFilter}` : 'All recent failing requests')}
        onApply={(state) => setFailureFilter(state.failureFilter)}
      />

      <Card className="admin-panel">
        <CardHeader className="admin-panel__header">
          <CardTitle>7-day incident timeline</CardTitle>
          <div className="admin-panel__summary">
            <span>Failed managed requests and admin activity by day</span>
          </div>
        </CardHeader>
        <CardContent className="admin-panel__content admin-trend-list">
          {data?.incidentTimeline?.length ? (
            data.incidentTimeline.map((point) => (
              <div key={point.day} className="admin-trend-row">
                <div className="admin-trend-row__meta">
                  <strong>{point.day}</strong>
                  <span>{point.failedRequests} failed requests · {point.auditEvents} audit events</span>
                </div>
                <div className="admin-trend-row__bars">
                  <div className="admin-trend-row__track is-danger">
                    <div
                      className="admin-trend-row__fill is-danger"
                      style={{ width: `${point.totalRequests > 0 ? (point.failedRequests / point.totalRequests) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="admin-trend-row__track is-info">
                    <div
                      className="admin-trend-row__fill is-info"
                      style={{ width: `${Math.min(point.auditEvents * 20, 100)}%` }}
                    />
                  </div>
                </div>
                <div className="admin-trend-row__value">{point.totalRequests} requests</div>
              </div>
            ))
          ) : (
            <AdminEmptyState title="No incident trend yet" description="Recent request failures and admin activity will accumulate here as platform activity grows." />
          )}
        </CardContent>
      </Card>

      <Card className="admin-panel">
        <CardHeader className="admin-panel__header">
          <CardTitle>Recent failing requests</CardTitle>
          <div className="admin-panel__summary">
            <span>Latest managed failures behind current incidents</span>
          </div>
        </CardHeader>
        <CardContent className="admin-panel__content admin-feed-list">
          {failureCauseOptions.length ? (
            <div className="admin-selection-strip">
              <button
                type="button"
                className={`admin-selection-pill admin-filter-chip${failureFilter === '' ? ' is-active' : ''}`}
                onClick={() => setFailureFilter('')}
              >
                All causes
              </button>
              {failureCauseOptions.map((option) => (
                <button
                  key={option}
                  type="button"
                  className={`admin-selection-pill admin-filter-chip${failureFilter === option ? ' is-active' : ''}`}
                  onClick={() => setFailureFilter(option)}
                >
                  {option}
                </button>
              ))}
            </div>
          ) : null}
          {filteredFailures.length ? (
            filteredFailures.map((failure) => (
              <div key={failure.id} className="admin-feed-row admin-feed-row--stack">
                <div className="admin-feed-row__topline">
                  <p className="admin-feed-row__title">{failure.modelKey}</p>
                  <StatusPill label={normalizeFailureCause(failure.failureSummary)} tone="warning" />
                </div>
                <p className="admin-feed-row__meta">
                  {failure.email} · {failure.providerId} · {new Date(failure.reservedAt).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </p>
                <p className="admin-feed-row__meta">{failure.failureSummary}</p>
                <div className="admin-inline-actions">
                  <Link href={`/admin/users/${failure.userId}`} className="admin-table__link">
                    Open user
                  </Link>
                  <Link
                    href={`/admin/users?providerSelection=${encodeURIComponent(failure.providerId)}&modelSelection=${encodeURIComponent(failure.modelKey)}`}
                    className="admin-table__link"
                  >
                    View model users
                  </Link>
                </div>
              </div>
            ))
          ) : (
            <AdminEmptyState title="No matching request failures" description="Try clearing the current cause filter or wait for more failure telemetry." />
          )}
        </CardContent>
      </Card>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Incident summary</CardTitle>
            <div className="admin-panel__summary">
              <span>Immediate degraded states</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {degradedDependencies.length ? (
              degradedDependencies.map((dependency) => (
                <div key={dependency.key} className="admin-feed-row">
                  <div>
                    <p className="admin-feed-row__title">{dependency.key}</p>
                    <p className="admin-feed-row__meta">Current status: {dependency.status}</p>
                  </div>
                  <StatusPill label="Needs attention" tone={dependency.tone as 'warning' | 'danger'} />
                </div>
              ))
            ) : (
              <AdminEmptyState title="No degraded dependencies" description="Dependency incidents will appear here when platform services drift out of healthy state." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>OpenClaw gateway watch</CardTitle>
            <div className="admin-panel__summary">
              <span>Sessions, skills, and channel probe status</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-detail-grid">
            <div>
              <p className="admin-detail-grid__label">Sessions</p>
              <StatusPill label={data?.dependencies.openclaw.sessionsOk ? 'OK' : 'Degraded'} tone={data?.dependencies.openclaw.sessionsOk ? 'success' : 'warning'} />
            </div>
            <div>
              <p className="admin-detail-grid__label">Skills</p>
              <StatusPill label={data?.dependencies.openclaw.skillsOk ? 'OK' : 'Degraded'} tone={data?.dependencies.openclaw.skillsOk ? 'success' : 'warning'} />
            </div>
            <div className="admin-detail-grid__span">
              <p className="admin-detail-grid__label">Channel probe</p>
              <p className="admin-detail-grid__value">{data?.dependencies.openclaw.channelsProbe || 'Unavailable'}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Dependencies</CardTitle>
            <div className="admin-panel__summary">
              <span>Configuration and runtime health</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-detail-grid">
            <div>
              <p className="admin-detail-grid__label">Database</p>
              <StatusPill label={data?.dependencies.database.status || 'unknown'} tone={data?.dependencies.database.status === 'healthy' ? 'success' : 'warning'} />
            </div>
            <div>
              <p className="admin-detail-grid__label">MiniMax</p>
              <StatusPill label={data?.dependencies.minimax.status || 'unknown'} tone={data?.dependencies.minimax.status === 'configured' ? 'success' : 'danger'} />
            </div>
            <div>
              <p className="admin-detail-grid__label">Google OAuth</p>
              <StatusPill label={data?.dependencies.googleOAuth.status || 'unknown'} tone={data?.dependencies.googleOAuth.status === 'configured' ? 'success' : 'warning'} />
            </div>
            <div>
              <p className="admin-detail-grid__label">OpenClaw</p>
              <StatusPill label={data?.dependencies.openclaw.status || 'unknown'} tone={data?.dependencies.openclaw.status === 'healthy' ? 'success' : 'warning'} />
            </div>
            <div className="admin-detail-grid__span">
              <p className="admin-detail-grid__label">Channel probe</p>
              <p className="admin-detail-grid__value">{data?.dependencies.openclaw.channelsProbe || 'Unavailable'}</p>
            </div>
          </CardContent>
        </Card>

        <Card className="admin-panel">
        <CardHeader className="admin-panel__header">
          <CardTitle>Feature flags</CardTitle>
          <div className="admin-panel__summary">
            <span>Current runtime toggles</span>
          </div>
        </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data?.featureFlags ? (
              Object.entries(data.featureFlags).map(([key, enabled]) => (
                <div key={key} className="admin-feed-row">
                  <div>
                    <p className="admin-feed-row__title">{key}</p>
                  </div>
                  <StatusPill label={enabled ? 'Enabled' : 'Disabled'} tone={enabled ? 'success' : 'default'} />
                </div>
              ))
            ) : (
              <AdminEmptyState title="No feature flags" description="Flags will appear here if the system exposes them." />
            )}
          </CardContent>
        </Card>
      </section>

      <Card className="admin-panel">
        <CardHeader className="admin-panel__header">
          <CardTitle>Notices</CardTitle>
          <div className="admin-panel__summary">
            <span>Configuration gaps and system warnings</span>
          </div>
        </CardHeader>
        <CardContent className="admin-panel__content admin-feed-list">
          {data?.notices.length ? (
            data.notices.map((notice) => (
              <div key={`${notice.level}-${notice.message}`} className={`admin-notice-row is-${notice.level}`}>
                <span>{notice.message}</span>
              </div>
            ))
          ) : (
            <AdminEmptyState title="No notices" description="Warnings and missing configuration will surface here." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function normalizeFailureCause(summary: string) {
  const text = summary.toLowerCase();
  if (text.includes('quota') || text.includes('credit') || text.includes('limit')) return 'quota / credits';
  if (text.includes('parse')) return 'parse error';
  if (text.includes('timeout')) return 'timeout';
  if (text.includes('unauthorized') || text.includes('auth')) return 'auth error';
  if (text.includes('openclaw')) return 'gateway error';
  if (text.includes('provider')) return 'provider error';
  if (text.includes('generation')) return 'generation failed';
  return 'other';
}
