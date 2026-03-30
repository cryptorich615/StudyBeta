'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { apiFetch } from '../../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { AdminEmptyState, AdminPageHeader, AdminSavedViewsPanel, AdminStatCard, AdminUsageMeter, StatusPill, formatDateTime } from '../admin-shared';

type ProviderPayload = {
  providers: Array<{
    providerId: string;
    providerName: string;
    serviceBaseUrl: string;
    savedConfigs: number;
    activeConfigs: number;
  }>;
  activeModels: Array<{
    providerId: string;
    modelKey: string;
    usersOnModel: number;
  }>;
  requestStats: Array<{
    providerId: string;
    modelKey: string;
    completed: number;
    failed: number;
    total: number;
    fallbackCount: number | null;
    latencyMsP95: number | null;
  }>;
  requestTrend: Array<{
    day: string;
    completed: number;
    failed: number;
    total: number;
  }>;
  providerTrend: Array<{
    providerId: string;
    day: string;
    completed: number;
    failed: number;
    total: number;
  }>;
  modelWatch: Array<{
    providerId: string;
    modelKey: string;
    lastSeenAt: string | null;
    lastFailedAt: string | null;
    failed24h: number;
    completed24h: number;
    total7d: number;
  }>;
  affectedUsers: Array<{
    providerId: string;
    userId: string;
    email: string;
    failed24h: number;
    completed24h: number;
    lastEventAt: string | null;
  }>;
  recentFailures: Array<{
    id: string;
    userId: string;
    email: string;
    providerId: string;
    modelKey: string;
    feature: string;
    requestUnits: number;
    reservedAt: string;
    finalizedAt: string | null;
    failureSummary: string;
  }>;
  diagnostics: {
    sessionsOk: boolean;
    skillsOk: boolean;
    channelsProbe: string;
  } | null;
};

type ProviderPresetState = {
  failureFilter: string;
};

export default function AdminProvidersPage() {
  const [data, setData] = useState<ProviderPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [failureFilter, setFailureFilter] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      const response = await apiFetch('/api/admin/providers');
      const payload = await response.json().catch(() => null);
      if (!active) return;

      if (!response.ok || !payload) {
        setError(payload?.message || 'Failed to load provider operations.');
        setLoading(false);
        return;
      }

      setData(payload as ProviderPayload);
      setError('');
      setLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  const providerOutages = useMemo(
    () => (data?.requestStats ?? []).filter((stat) => stat.failed > 0).sort((left, right) => right.failed - left.failed),
    [data?.requestStats]
  );
  const fallbackHotspots = useMemo(
    () =>
      (data?.requestStats ?? [])
        .filter((stat) => (stat.fallbackCount ?? 0) > 0)
        .sort((left, right) => (right.fallbackCount ?? 0) - (left.fallbackCount ?? 0)),
    [data?.requestStats]
  );
  const p95Hotspots = useMemo(
    () =>
      (data?.requestStats ?? [])
        .filter((stat) => stat.latencyMsP95 !== null)
        .sort((left, right) => (right.latencyMsP95 ?? 0) - (left.latencyMsP95 ?? 0))
        .slice(0, 5),
    [data?.requestStats]
  );
  const providerTrendGroups = useMemo(() => {
    const grouped = new Map<string, ProviderPayload['providerTrend']>();
    for (const point of data?.providerTrend ?? []) {
      const current = grouped.get(point.providerId) ?? [];
      current.push(point);
      grouped.set(point.providerId, current);
    }
    return [...grouped.entries()].map(([providerId, points]) => ({
      providerId,
      points,
      failed: points.reduce((sum, point) => sum + point.failed, 0),
      total: points.reduce((sum, point) => sum + point.total, 0),
    })).sort((left, right) => right.failed - left.failed || right.total - left.total);
  }, [data?.providerTrend]);
  const failureCauseOptions = useMemo(() => {
    const options = new Set<string>();
    for (const item of data?.recentFailures ?? []) {
      const normalized = normalizeFailureCause(item.failureSummary);
      if (normalized) options.add(normalized);
    }
    return [...options];
  }, [data?.recentFailures]);
  const filteredRecentFailures = useMemo(() => {
    if (!failureFilter) return data?.recentFailures ?? [];
    return (data?.recentFailures ?? []).filter(
      (item) => normalizeFailureCause(item.failureSummary) === failureFilter
    );
  }, [data?.recentFailures, failureFilter]);
  const filteredAffectedUsers = useMemo(() => {
    if (!failureFilter) return data?.affectedUsers ?? [];
    const failedUserIds = new Set(
      filteredRecentFailures.map((item) => item.userId)
    );
    return (data?.affectedUsers ?? []).filter((item) => failedUserIds.has(item.userId));
  }, [data?.affectedUsers, failureFilter, filteredRecentFailures]);
  const defaultSavedViews = useMemo(
    () => [
      {
        id: 'providers-all',
        label: 'All failures',
        description: 'Show every recent provider failure',
        state: { failureFilter: '' },
        readonly: true,
      },
      {
        id: 'providers-provider-errors',
        label: 'Provider errors',
        description: 'Focus on upstream provider issues',
        state: { failureFilter: 'provider error' },
        readonly: true,
      },
      {
        id: 'providers-parse-failures',
        label: 'Parse failures',
        description: 'Review malformed structured-output runs',
        state: { failureFilter: 'parse error' },
        readonly: true,
      },
      {
        id: 'providers-quota',
        label: 'Quota issues',
        description: 'Inspect credit and quota exhaustion',
        state: { failureFilter: 'quota / credits' },
        readonly: true,
      },
    ] satisfies Array<{
      id: string;
      label: string;
      description: string;
      state: ProviderPresetState;
      readonly: true;
    }>,
    []
  );

  return (
    <div className="admin-page-stack">
      <AdminPageHeader
        eyebrow="Tutors & models"
        title="Provider operations"
        description="Inspect active model routing, saved provider configs, and recent managed request outcomes."
      />

      {!loading && !error ? (
        <section className="admin-stats-grid">
          <AdminStatCard label="Providers" value={data?.providers.length ?? 0} detail="Configured provider entries" />
          <AdminStatCard label="Active models" value={data?.activeModels.length ?? 0} detail="Models with routed users" tone="accent" />
          <AdminStatCard
            label="Failing routes"
            value={providerOutages.length}
            detail="Model routes with failed managed requests"
            tone={providerOutages.length ? 'warning' : 'default'}
          />
          <AdminStatCard
            label="Fallback routes"
            value={fallbackHotspots.length}
            detail="Routes reporting fallback activity"
            tone={fallbackHotspots.length ? 'warning' : 'default'}
          />
          <AdminStatCard
            label="Gateway sessions"
            value={data?.diagnostics?.sessionsOk ? 'OK' : 'Issue'}
            detail="OpenClaw session health"
            tone={data?.diagnostics?.sessionsOk ? 'default' : 'warning'}
          />
          <AdminStatCard
            label="Gateway skills"
            value={data?.diagnostics?.skillsOk ? 'OK' : 'Issue'}
            detail="OpenClaw skill health"
            tone={data?.diagnostics?.skillsOk ? 'default' : 'warning'}
          />
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
            <span>One-click slices for the most common provider issues</span>
          </div>
        </CardHeader>
        <CardContent className="admin-panel__content admin-quick-grid">
          <button type="button" className="admin-quick-card" onClick={() => setFailureFilter('provider error')}>
            <span>Provider errors</span>
            <small>Focus the failure list on upstream provider failures</small>
          </button>
          <button type="button" className="admin-quick-card" onClick={() => setFailureFilter('parse error')}>
            <span>Parse failures</span>
            <small>Review malformed structured-output runs</small>
          </button>
          <button type="button" className="admin-quick-card" onClick={() => setFailureFilter('quota / credits')}>
            <span>Quota issues</span>
            <small>Inspect managed credit and quota exhaustion</small>
          </button>
          <Link href="/admin/users?billingMode=managed&providerSelection=minimax" className="admin-quick-card">
            <span>MiniMax users</span>
            <small>Open the managed MiniMax user cohort</small>
          </Link>
        </CardContent>
      </Card>

      <AdminSavedViewsPanel
        title="Saved investigations"
        description="Pin the provider slices you reopen most often."
        storageKey="studyclaw.admin.providers.savedViews"
        defaults={defaultSavedViews}
        currentState={{ failureFilter }}
        suggestedLabel={failureFilter ? `${failureFilter} incidents` : 'All provider incidents'}
        stateSummary={(state) => (state.failureFilter ? `Cause filter: ${state.failureFilter}` : 'All recent provider failures')}
        onApply={(state) => setFailureFilter(state.failureFilter)}
      />

      <Card className="admin-panel">
        <CardHeader className="admin-panel__header">
          <CardTitle>7-day managed traffic trend</CardTitle>
          <div className="admin-panel__summary">
            <span>Daily managed request volume and failures</span>
          </div>
        </CardHeader>
        <CardContent className="admin-panel__content admin-trend-list">
          {data?.requestTrend?.length ? (
            data.requestTrend.map((point) => (
              <div key={point.day} className="admin-trend-row">
                <div className="admin-trend-row__meta">
                  <strong>{point.day}</strong>
                  <span>{point.completed} completed · {point.failed} failed</span>
                </div>
                <div className="admin-trend-row__bars">
                  <div className="admin-trend-row__track">
                    <div
                      className="admin-trend-row__fill"
                      style={{ width: `${point.total > 0 ? (point.completed / point.total) * 100 : 0}%` }}
                    />
                  </div>
                  <div className="admin-trend-row__track is-danger">
                    <div
                      className="admin-trend-row__fill is-danger"
                      style={{ width: `${point.total > 0 ? (point.failed / point.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                <div className="admin-trend-row__value">{point.total} total</div>
              </div>
            ))
          ) : (
            <AdminEmptyState title="No traffic trend yet" description="Daily managed provider traffic will appear here after routed usage events accumulate." />
          )}
        </CardContent>
      </Card>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Provider day breakdown</CardTitle>
            <div className="admin-panel__summary">
              <span>7-day volume by provider</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {providerTrendGroups.length ? (
              providerTrendGroups.map((group) => (
                <div key={group.providerId} className="admin-feed-row admin-feed-row--stack">
                  <div className="admin-feed-row__topline">
                    <p className="admin-feed-row__title">{group.providerId}</p>
                    <StatusPill label={`${group.failed} failed`} tone={group.failed > 0 ? 'warning' : 'success'} />
                  </div>
                  <p className="admin-feed-row__meta">{group.total} total requests in the last 7 days</p>
                  <div className="admin-selection-strip">
                    {group.points.map((point) => (
                      <span key={`${group.providerId}-${point.day}`} className="admin-selection-pill">
                        {point.day.slice(5)} · {point.total}
                      </span>
                    ))}
                  </div>
                  <div className="admin-inline-actions">
                    <Link
                      href={`/admin/users?providerSelection=${encodeURIComponent(group.providerId)}`}
                      className="admin-table__link"
                    >
                      Show provider users
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <AdminEmptyState title="No provider breakdown yet" description="Per-provider daily traffic appears here after managed requests accumulate." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Model failure watch</CardTitle>
            <div className="admin-panel__summary">
              <span>Most recently failing model routes</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data?.modelWatch?.length ? (
              data.modelWatch.map((model) => (
                <div key={`${model.providerId}-${model.modelKey}-watch`} className="admin-feed-row admin-feed-row--stack">
                  <div className="admin-feed-row__topline">
                    <p className="admin-feed-row__title">{model.modelKey}</p>
                    <StatusPill label={model.failed24h > 0 ? `${model.failed24h} failed in 24h` : 'No recent failures'} tone={model.failed24h > 0 ? 'warning' : 'success'} />
                  </div>
                  <p className="admin-feed-row__meta">
                    {model.providerId} · last seen {formatDateTime(model.lastSeenAt)}{model.lastFailedAt ? ` · last failed ${formatDateTime(model.lastFailedAt)}` : ''}
                  </p>
                  <AdminUsageMeter value={model.completed24h} total={Math.max(model.completed24h + model.failed24h, 1)} label="24h success mix" tone={model.failed24h > 0 ? 'warning' : 'success'} />
                  <div className="admin-inline-actions">
                    <Link
                      href={`/admin/users?providerSelection=${encodeURIComponent(model.providerId)}&modelSelection=${encodeURIComponent(model.modelKey)}`}
                      className="admin-table__link"
                    >
                      Show model users
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <AdminEmptyState title="No model watch data" description="Recent per-model route history will appear here once managed request traffic is present." />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Affected users</CardTitle>
            <div className="admin-panel__summary">
              <span>Accounts with provider failures in the last 24 hours</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {filteredAffectedUsers.length ? (
              filteredAffectedUsers.map((user) => (
                <div key={`${user.providerId}-${user.userId}`} className="admin-feed-row admin-feed-row--stack">
                  <div>
                    <p className="admin-feed-row__title">{user.email}</p>
                    <p className="admin-feed-row__meta">
                      {user.providerId} · {user.failed24h} failed · {user.completed24h} completed · last event {formatDateTime(user.lastEventAt)}
                    </p>
                  </div>
                  <div className="admin-inline-actions">
                    <Link href={`/admin/users/${user.userId}`} className="admin-table__link">
                      Open user
                    </Link>
                    <Link
                      href={`/admin/users?providerSelection=${encodeURIComponent(user.providerId)}&q=${encodeURIComponent(user.email)}`}
                      className="admin-table__link"
                    >
                      Filter impacted users
                    </Link>
                  </div>
                </div>
              ))
            ) : (
              <AdminEmptyState title="No affected users" description="Accounts hit by provider failures will appear here for direct follow-up." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Recent failed events</CardTitle>
            <div className="admin-panel__summary">
              <span>Latest failing managed provider calls</span>
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
            {filteredRecentFailures.length ? (
              filteredRecentFailures.map((failure) => (
                <div key={failure.id} className="admin-feed-row admin-feed-row--stack">
                  <div className="admin-feed-row__topline">
                    <p className="admin-feed-row__title">{failure.modelKey}</p>
                    <StatusPill label={normalizeFailureCause(failure.failureSummary)} tone="warning" />
                  </div>
                  <p className="admin-feed-row__meta">
                    {failure.email} · {failure.providerId} · {failure.requestUnits} units · {formatDateTime(failure.reservedAt)}
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
              <AdminEmptyState title="No matching failed events" description="Try clearing the current cause filter or wait for more failure telemetry." />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Incident hotspots</CardTitle>
            <div className="admin-panel__summary">
              <span>Failed or degraded provider routes</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {providerOutages.length ? (
              providerOutages.slice(0, 6).map((stat) => (
                <div key={`${stat.providerId}-${stat.modelKey}-incident`} className="admin-feed-row admin-feed-row--stack">
                  <div className="admin-feed-row__topline">
                    <p className="admin-feed-row__title">{stat.modelKey}</p>
                    <StatusPill label={`${stat.failed} failed`} tone="warning" />
                  </div>
                  <p className="admin-feed-row__meta">
                    {stat.providerId} · {stat.completed} completed · {stat.total} total
                  </p>
                  <AdminUsageMeter value={stat.failed} total={stat.total || 0} label="Failure rate" tone={stat.failed > 5 ? 'danger' : 'warning'} />
                </div>
              ))
            ) : (
              <AdminEmptyState title="No provider incidents" description="Managed request routes with failures will surface here for quick triage." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Latency and fallback watch</CardTitle>
            <div className="admin-panel__summary">
              <span>Slowest and fallback-prone routes</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {p95Hotspots.length || fallbackHotspots.length ? (
              <>
                {p95Hotspots.map((stat) => (
                  <div key={`${stat.providerId}-${stat.modelKey}-latency`} className="admin-feed-row">
                    <div>
                      <p className="admin-feed-row__title">{stat.modelKey}</p>
                      <p className="admin-feed-row__meta">{stat.providerId} · p95 {stat.latencyMsP95 ?? 'n/a'} ms</p>
                    </div>
                    <StatusPill label="Latency" tone={(stat.latencyMsP95 ?? 0) > 5000 ? 'danger' : 'warning'} />
                  </div>
                ))}
                {fallbackHotspots.slice(0, 4).map((stat) => (
                  <div key={`${stat.providerId}-${stat.modelKey}-fallback`} className="admin-feed-row">
                    <div>
                      <p className="admin-feed-row__title">{stat.modelKey}</p>
                      <p className="admin-feed-row__meta">{stat.providerId} · {stat.fallbackCount ?? 0} fallback events</p>
                    </div>
                    <StatusPill label="Fallbacks" tone="warning" />
                  </div>
                ))}
              </>
            ) : (
              <AdminEmptyState title="No latency or fallback issues" description="Slow routes and fallback-prone models will show up here once telemetry indicates trouble." />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Configured providers</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {loading ? (
              <div className="admin-loading-grid">
                <div className="admin-skeleton-row" />
                <div className="admin-skeleton-row" />
              </div>
            ) : data?.providers.length ? (
              data.providers.map((provider) => (
                <div key={`${provider.providerId}-${provider.serviceBaseUrl}`} className="admin-feed-row">
                  <div>
                    <p className="admin-feed-row__title">{provider.providerName}</p>
                    <p className="admin-feed-row__meta">
                      {provider.providerId} · {provider.savedConfigs} saved · {provider.serviceBaseUrl}
                    </p>
                  </div>
                  <StatusPill label={`${provider.activeConfigs} active`} tone={provider.activeConfigs > 0 ? 'success' : 'default'} />
                </div>
              ))
            ) : (
              <AdminEmptyState title="No saved providers" description="Saved provider configurations will appear here once users add or activate them." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Gateway diagnostics</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-detail-grid">
            <div>
              <p className="admin-detail-grid__label">Sessions</p>
              <StatusPill label={data?.diagnostics?.sessionsOk ? 'OK' : 'Degraded'} tone={data?.diagnostics?.sessionsOk ? 'success' : 'warning'} />
            </div>
            <div>
              <p className="admin-detail-grid__label">Skills</p>
              <StatusPill label={data?.diagnostics?.skillsOk ? 'OK' : 'Degraded'} tone={data?.diagnostics?.skillsOk ? 'success' : 'warning'} />
            </div>
            <div className="admin-detail-grid__span">
              <p className="admin-detail-grid__label">Channel probe</p>
              <p className="admin-detail-grid__value">{data?.diagnostics?.channelsProbe || 'Unavailable'}</p>
            </div>
          </CardContent>
        </Card>
      </section>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Active model distribution</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data?.activeModels.length ? (
              data.activeModels.map((model) => (
                <div key={model.modelKey} className="admin-feed-row">
                  <div>
                    <p className="admin-feed-row__title">{model.modelKey}</p>
                    <p className="admin-feed-row__meta">{model.providerId}</p>
                  </div>
                  <StatusPill label={`${model.usersOnModel} users`} tone="info" />
                </div>
              ))
            ) : (
              <AdminEmptyState title="No active models" description="User routing data will populate here once agents are configured." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Managed request outcomes</CardTitle>
            <div className="admin-panel__summary">
              <span>Recent route health from managed traffic</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data?.requestStats.length ? (
              data.requestStats.map((stat) => (
                <div key={`${stat.providerId}-${stat.modelKey}`} className="admin-feed-row admin-feed-row--stack">
                  <div>
                    <p className="admin-feed-row__title">{stat.modelKey}</p>
                    <p className="admin-feed-row__meta">
                      {stat.providerId} · {stat.completed} completed · {stat.failed} failed · {stat.total} total
                    </p>
                  </div>
                  <div className="admin-feed-row__topline">
                    <AdminUsageMeter value={stat.completed} total={stat.total || 0} label="Success mix" tone={stat.failed > 0 ? 'warning' : 'success'} />
                    <StatusPill label={stat.failed > 0 ? 'Needs review' : 'Healthy'} tone={stat.failed > 0 ? 'warning' : 'success'} />
                  </div>
                </div>
              ))
            ) : (
              <AdminEmptyState title="No request telemetry yet" description="Managed usage requests will appear here after tracked provider traffic flows through the proxy." />
            )}
          </CardContent>
        </Card>
      </section>
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
