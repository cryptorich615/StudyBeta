'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '../../../lib/api';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { AdminEmptyState, AdminPageHeader, AdminStatCard, AdminUsageMeter, StatusPill, formatTierLabel } from '../admin-shared';

type UsageAccount = {
  userId: string;
  email: string;
  role: string;
  tier: string | null;
  billingMode: string;
  usesManagedCredits: boolean;
  creditsTotal: number;
  creditsRemaining: number;
  usedInWindow: number;
  windowLimit: number | null;
  remainingInWindow: number | null;
  internalUsageIdentity: string | null;
  providerSelection: string | null;
  modelSelection: string | null;
};

export default function AdminUsagePage() {
  const [accounts, setAccounts] = useState<UsageAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await apiFetch('/api/admin/managed-usage');
      const payload = await response.json().catch(() => null);
      if (!active) return;

      if (!response.ok || !payload) {
        setError(payload?.message || 'Failed to load managed usage accounts.');
        setLoading(false);
        return;
      }

      setAccounts(payload.accounts ?? []);
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
        eyebrow="Plans & credits"
        title="Managed billing controls"
        description="Inspect quota enforcement, remaining credits, BYOK separation, and high-usage accounts."
      />

      {!loading && !error ? (
        <section className="admin-stats-grid">
          <AdminStatCard label="Usage accounts" value={accounts.length} detail="Accounts with visible usage profiles" />
          <AdminStatCard
            label="Managed"
            value={accounts.filter((account) => account.billingMode === 'managed').length}
            detail="Routed through StudyClaw quotas"
            tone="accent"
          />
          <AdminStatCard
            label="BYOK"
            value={accounts.filter((account) => account.billingMode === 'byok').length}
            detail="External provider usage"
          />
          <AdminStatCard
            label="Credits left"
            value={accounts.reduce((sum, account) => sum + account.creditsRemaining, 0)}
            detail="Aggregate remaining credits"
          />
          <AdminStatCard
            label="Window usage"
            value={accounts.reduce((sum, account) => sum + account.usedInWindow, 0)}
            detail="Aggregate current 5-hour usage"
          />
          <AdminStatCard
            label="Near cap"
            value={accounts.filter((account) => account.windowLimit && account.usedInWindow / account.windowLimit >= 0.8).length}
            detail="Accounts at 80% or higher"
            tone="warning"
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
          <CardTitle>Managed usage accounts</CardTitle>
          <div className="admin-panel__summary">
            <span>{loading ? 'Refreshing usage ledger…' : `${accounts.length} accounts in view`}</span>
            <span>Managed, BYOK, and local billing visibility</span>
          </div>
        </CardHeader>
        <CardContent className="admin-panel__content">
          {loading ? (
            <div className="admin-loading-grid">
              <div className="admin-skeleton-row" />
              <div className="admin-skeleton-row" />
              <div className="admin-skeleton-row" />
            </div>
          ) : accounts.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Account</th>
                    <th>Tier</th>
                    <th>Credits</th>
                    <th>5h window</th>
                    <th>Provider</th>
                    <th>Mode</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((account) => (
                    <tr key={account.userId}>
                      <td>
                        <div className="admin-table__primary">{account.email}</div>
                        <div className="admin-table__secondary">{account.internalUsageIdentity || 'No usage identity'}</div>
                      </td>
                      <td>
                        <div className="admin-table__primary">{formatTierLabel(account.tier)}</div>
                        <div className="admin-table__secondary">{account.role}</div>
                      </td>
                      <td>
                        <div className="admin-table__primary">{account.creditsRemaining}</div>
                        <div className="admin-table__secondary">of {account.creditsTotal}</div>
                        <AdminUsageMeter
                          value={Math.max(0, account.creditsTotal - account.creditsRemaining)}
                          total={account.creditsTotal || 0}
                          label="Credits used"
                          tone={account.creditsRemaining === 0 ? 'danger' : account.creditsRemaining < Math.max(200, account.creditsTotal * 0.2) ? 'warning' : 'success'}
                        />
                      </td>
                      <td>
                        <div className="admin-table__primary">
                          {account.usedInWindow}/{account.windowLimit ?? '∞'}
                        </div>
                        <div className="admin-table__secondary">{account.remainingInWindow ?? '∞'} remaining</div>
                        <AdminUsageMeter
                          value={account.usedInWindow}
                          total={account.windowLimit}
                          label="5h window"
                          tone={account.windowLimit && account.usedInWindow / account.windowLimit >= 0.95 ? 'danger' : account.windowLimit && account.usedInWindow / account.windowLimit >= 0.8 ? 'warning' : 'default'}
                        />
                      </td>
                      <td>
                        <div className="admin-table__primary">{account.providerSelection || 'None'}</div>
                        <div className="admin-table__secondary">{account.modelSelection || 'No model'}</div>
                      </td>
                      <td>
                        <StatusPill
                          label={account.billingMode}
                          tone={account.billingMode === 'managed' ? 'success' : account.billingMode === 'byok' ? 'info' : 'default'}
                        />
                      </td>
                      <td className="text-right">
                        <Link className="admin-table__link" href={`/admin/users/${account.userId}`}>
                          Inspect
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <AdminEmptyState title="No usage profiles found" description="Managed usage accounts will appear here after users choose a managed StudyClaw model." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
