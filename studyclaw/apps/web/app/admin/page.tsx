'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Coins, UserPlus, Users } from 'lucide-react';
import { apiFetch } from '../../lib/api';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { AdminEmptyState, AdminPageHeader, AdminStatCard, StatusPill, formatDateTime, formatRelativePercent } from './admin-shared';

type OverviewPayload = {
  metrics: {
    totalUsers: number;
    activeUsers: number;
    newSignups: number;
    paidUsers: number;
    freeUsers: number;
    conversionRate: number;
    onboardedUsers: number;
    creditsConsumed30d: number;
    providerSpend30d: number | null;
    failedRequests30d: number;
    failedRequests24h: number;
  };
  recentActivity: Array<{
    id: string;
    summary: string;
    eventType: string;
    createdAt: string;
    actorEmail: string | null;
    targetEmail: string | null;
  }>;
  recentUsers: Array<{
    id: string;
    email: string;
    fullName: string | null;
    role: string;
    createdAt: string;
  }>;
  heavyUsageAccounts: Array<{
    userId: string;
    email: string;
    tier: string | null;
    usedInWindow: number;
    windowLimit: number | null;
    creditsRemaining: number;
  }>;
  quickActions: Array<{ label: string; href: string }>;
  notices: Array<{ level: 'info' | 'warning' | 'critical'; message: string }>;
};

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;

    async function load() {
      setLoading(true);
      const response = await apiFetch('/api/admin/overview');
      const payload = await response.json().catch(() => null);
      if (!active) {
        return;
      }

      if (!response.ok || !payload) {
        setError(payload?.message || 'Failed to load the admin overview.');
        setLoading(false);
        return;
      }

      setData(payload as OverviewPayload);
      setError('');
      setLoading(false);
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="admin-page-stack">
      <AdminPageHeader
        eyebrow="Overview"
        title="Operations at a glance"
        description="Live account, usage, and system visibility for the StudyBeta platform."
        actions={
          <div className="admin-inline-actions">
            <Button size="sm" className="admin-primary-button" asChild>
              <Link href="/admin/users">Open users</Link>
            </Button>
            <Button variant="outline" size="sm" className="admin-secondary-button" asChild>
              <Link href="/admin/system">Check system</Link>
            </Button>
          </div>
        }
      />

      {error ? (
        <Card className="admin-alert-card is-danger">
          <CardContent className="admin-alert-card__content">{error}</CardContent>
        </Card>
      ) : null}

      <section className="admin-stats-grid">
        <AdminStatCard label="Total users" value={loading ? '...' : data?.metrics.totalUsers ?? 0} detail="All accounts across admin and student roles." />
        <AdminStatCard label="Active users" value={loading ? '...' : data?.metrics.activeUsers ?? 0} detail="Users with activity in the last 7 days." tone="accent" />
        <AdminStatCard label="New signups" value={loading ? '...' : data?.metrics.newSignups ?? 0} detail="Accounts created in the last 7 days." />
        <AdminStatCard label="Paid users" value={loading ? '...' : data?.metrics.paidUsers ?? 0} detail={`Conversion ${loading ? '...' : formatRelativePercent(data?.metrics.conversionRate)}`} />
        <AdminStatCard label="Free users" value={loading ? '...' : data?.metrics.freeUsers ?? 0} detail={`Onboarded ${loading ? '...' : data?.metrics.onboardedUsers ?? 0}`} />
        <AdminStatCard
          label="Credits consumed"
          value={loading ? '...' : data?.metrics.creditsConsumed30d ?? 0}
          detail={`Failed requests ${loading ? '...' : data?.metrics.failedRequests30d ?? 0} in 30d`}
          tone={(data?.metrics.failedRequests24h ?? 0) > 0 ? 'warning' : 'default'}
        />
      </section>

      <section className="admin-two-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>System notices</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data?.notices?.length ? (
              data.notices.map((notice) => (
                <div key={`${notice.level}-${notice.message}`} className={`admin-notice-row is-${notice.level}`}>
                  <AlertTriangle className="h-4 w-4" />
                  <span>{notice.message}</span>
                </div>
              ))
            ) : (
              <AdminEmptyState title="No current notices" description="Operational notices and config warnings will appear here." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Quick actions</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-quick-grid">
            {data?.quickActions?.map((action) => (
              <Link key={action.href} href={action.href} className="admin-quick-card">
                <span>{action.label}</span>
                <ArrowRight className="h-4 w-4" />
              </Link>
            ))}
          </CardContent>
        </Card>
      </section>

      <section className="admin-three-column-grid">
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data?.recentActivity?.length ? (
              data.recentActivity.map((entry) => (
                <div key={entry.id} className="admin-feed-row">
                  <div>
                    <p className="admin-feed-row__title">{entry.summary}</p>
                    <p className="admin-feed-row__meta">
                      {entry.actorEmail || 'System'} · {formatDateTime(entry.createdAt)}
                    </p>
                  </div>
                  <StatusPill label={entry.eventType.replace(/_/g, ' ')} tone="info" />
                </div>
              ))
            ) : (
              <AdminEmptyState title="No activity yet" description="Admin audit events will appear here once actions are recorded." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Recent users</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data?.recentUsers?.length ? (
              data.recentUsers.map((user) => (
                <Link key={user.id} href={`/admin/users/${user.id}`} className="admin-feed-row admin-feed-row--link">
                  <div>
                    <p className="admin-feed-row__title">{user.fullName || user.email}</p>
                    <p className="admin-feed-row__meta">
                      {user.email} · {formatDateTime(user.createdAt)}
                    </p>
                  </div>
                  <StatusPill label={user.role} tone={user.role === 'admin' ? 'warning' : 'default'} />
                </Link>
              ))
            ) : (
              <AdminEmptyState title="No user data" description="New signups will appear here." />
            )}
          </CardContent>
        </Card>

        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Heavy usage</CardTitle>
          </CardHeader>
          <CardContent className="admin-panel__content admin-feed-list">
            {data?.heavyUsageAccounts?.length ? (
              data.heavyUsageAccounts.map((account) => (
                <Link key={account.userId} href={`/admin/users/${account.userId}`} className="admin-feed-row admin-feed-row--link">
                  <div>
                    <p className="admin-feed-row__title">{account.email}</p>
                    <p className="admin-feed-row__meta">
                      {account.usedInWindow}/{account.windowLimit ?? '∞'} used · {account.creditsRemaining} credits left
                    </p>
                  </div>
                  <StatusPill label={account.tier?.replace('_', ' ') || 'unassigned'} tone="warning" />
                </Link>
              ))
            ) : (
              <AdminEmptyState title="No managed usage" description="Managed quota activity will surface here as users consume credits." />
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  );
}
