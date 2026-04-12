'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Search } from 'lucide-react';
import { apiFetch } from '../../../lib/api';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card';
import { AdminEmptyState, AdminPageHeader, AdminSavedViewsPanel, AdminStatCard, AdminUsageMeter, StatusPill, formatDateTime, formatTierLabel } from '../admin-shared';

type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  role: string;
  tier: string | null;
  billingMode: string;
  creditsTotal: number;
  creditsRemaining: number;
  usageInWindow: number;
  providerSelection: string | null;
  modelSelection: string | null;
  onboardingComplete: boolean;
  createdAt: string;
  lastActiveAt: string | null;
};

type UserPresetState = {
  query: string;
  role: string;
  billingMode: string;
  providerSelection: string;
  modelSelection: string;
};

export default function AdminUsersPage() {
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(searchParams.get('q') ?? '');
  const [role, setRole] = useState(searchParams.get('role') ?? '');
  const [billingMode, setBillingMode] = useState(searchParams.get('billingMode') ?? '');
  const [providerSelection, setProviderSelection] = useState(searchParams.get('providerSelection') ?? '');
  const [modelSelection, setModelSelection] = useState(searchParams.get('modelSelection') ?? '');
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [bulkTier, setBulkTier] = useState('tier_1');
  const [bulkCreditDelta, setBulkCreditDelta] = useState('100');
  const [bulkMessage, setBulkMessage] = useState('');
  const [bulkTone, setBulkTone] = useState<'neutral' | 'success' | 'danger'>('neutral');
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const apiPath = useMemo(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (role) params.set('role', role);
    if (billingMode) params.set('billingMode', billingMode);
    if (providerSelection) params.set('providerSelection', providerSelection);
    if (modelSelection) params.set('modelSelection', modelSelection);
    const suffix = params.toString();
    return suffix ? `/api/admin/users?${suffix}` : '/api/admin/users';
  }, [billingMode, modelSelection, providerSelection, query, role]);
  const defaultSavedViews = useMemo(
    () => [
      {
        id: 'users-managed-minimax',
        label: 'Managed MiniMax users',
        description: 'Managed billing on MiniMax routes',
        state: {
          query: '',
          role: '',
          billingMode: 'managed',
          providerSelection: 'minimax',
          modelSelection: '',
        },
        readonly: true,
      },
      {
        id: 'users-byok',
        label: 'BYOK accounts',
        description: 'Accounts bypassing the StudyClaw credit pool',
        state: {
          query: '',
          role: '',
          billingMode: 'byok',
          providerSelection: '',
          modelSelection: '',
        },
        readonly: true,
      },
      {
        id: 'users-admins',
        label: 'Admin accounts',
        description: 'Operator accounts only',
        state: {
          query: '',
          role: 'admin',
          billingMode: '',
          providerSelection: '',
          modelSelection: '',
        },
        readonly: true,
      },
    ] satisfies Array<{
      id: string;
      label: string;
      description: string;
      state: UserPresetState;
      readonly: true;
    }>,
    []
  );

  async function loadUsers(path = apiPath) {
    setLoading(true);
    const response = await apiFetch(path);
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload) {
      setError(payload?.message || 'Failed to load users.');
      setLoading(false);
      return;
    }

    setUsers(payload.users ?? []);
    setError('');
    setLoading(false);
  }

  useEffect(() => {
    void loadUsers();
  }, [apiPath]);

  useEffect(() => {
    setSelectedIds((current) => current.filter((id) => users.some((user) => user.id === id)));
  }, [users]);

  const selectedUsers = useMemo(
    () => users.filter((user) => selectedIds.includes(user.id)),
    [selectedIds, users]
  );
  const actionableUsers = useMemo(
    () => selectedUsers.filter((user) => user.role !== 'admin'),
    [selectedUsers]
  );
  const blockedSelectionCount = selectedUsers.length - actionableUsers.length;
  const allVisibleSelected = users.length > 0 && selectedIds.length === users.length;

  function toggleSelectAll() {
    setSelectedIds((current) => (current.length === users.length ? [] : users.map((user) => user.id)));
  }

  function toggleSelected(userId: string) {
    setSelectedIds((current) =>
      current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]
    );
  }

  async function handleBulkTier(resetCredits: boolean) {
    if (!actionableUsers.length) {
      setBulkMessage('Select at least one non-admin account to change tiers.');
      setBulkTone('danger');
      return;
    }

    setBulkSubmitting(true);
    setBulkMessage('');
    const failures: string[] = [];

    for (const user of actionableUsers) {
      const response = await apiFetch(`/api/admin/users/${user.id}/tier`, {
        method: 'PATCH',
        body: JSON.stringify({ tier: bulkTier, resetCredits }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        failures.push(payload?.message || user.email);
      }
    }

    if (failures.length) {
      setBulkMessage(`Some tier updates failed: ${failures.slice(0, 3).join(' · ')}`);
      setBulkTone('danger');
    } else {
      setBulkMessage(
        `${actionableUsers.length} account${actionableUsers.length === 1 ? '' : 's'} moved to ${formatTierLabel(bulkTier)}${resetCredits ? ' and credit pools reset' : ''}.`
      );
      setBulkTone('success');
      setSelectedIds([]);
    }

    await loadUsers();
    setBulkSubmitting(false);
  }

  async function handleBulkCredits() {
    const delta = Number(bulkCreditDelta);
    if (!Number.isFinite(delta) || delta === 0) {
      setBulkMessage('Enter a non-zero credit delta for the selected accounts.');
      setBulkTone('danger');
      return;
    }

    if (!actionableUsers.length) {
      setBulkMessage('Select at least one non-admin account to adjust credits.');
      setBulkTone('danger');
      return;
    }

    setBulkSubmitting(true);
    setBulkMessage('');
    const failures: string[] = [];

    for (const user of actionableUsers) {
      const response = await apiFetch(`/api/admin/users/${user.id}/credits`, {
        method: 'PATCH',
        body: JSON.stringify({
          delta,
          reason: 'Bulk admin console adjustment',
        }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        failures.push(payload?.message || user.email);
      }
    }

    if (failures.length) {
      setBulkMessage(`Some credit updates failed: ${failures.slice(0, 3).join(' · ')}`);
      setBulkTone('danger');
    } else {
      setBulkMessage(
        `${delta > 0 ? 'Granted' : 'Removed'} ${Math.abs(delta)} credits ${delta > 0 ? 'to' : 'from'} ${actionableUsers.length} account${actionableUsers.length === 1 ? '' : 's'}.`
      );
      setBulkTone('success');
      setSelectedIds([]);
    }

    await loadUsers();
    setBulkSubmitting(false);
  }

  return (
    <div className="admin-page-stack">
      <AdminPageHeader
        eyebrow="Users"
        title="Account operations"
        description="Search, filter, and inspect user accounts, quotas, onboarding state, and active model configuration."
      />

      {!loading && !error ? (
        <section className="admin-stats-grid">
          <AdminStatCard label="Visible users" value={users.length} detail="Current filtered result set" />
          <AdminStatCard
            label="Admins"
            value={users.filter((user) => user.role === 'admin').length}
            detail="Protected operator accounts"
          />
          <AdminStatCard
            label="Managed billing"
            value={users.filter((user) => user.billingMode === 'managed').length}
            detail="Using StudyClaw pooled credits"
          />
          <AdminStatCard
            label="Needs onboarding"
            value={users.filter((user) => !user.onboardingComplete).length}
            detail="Accounts blocked from workspace access"
            tone="warning"
          />
          <AdminStatCard
            label="Credits exposed"
            value={users.reduce((sum, user) => sum + user.creditsRemaining, 0)}
            detail="Remaining credits in current result set"
          />
          <AdminStatCard
            label="Window activity"
            value={users.reduce((sum, user) => sum + user.usageInWindow, 0)}
            detail="Tracked usage across current result set"
          />
        </section>
      ) : null}

      <Card className="admin-panel">
        <CardContent className="admin-filter-bar">
          <label className="admin-filter admin-filter--search">
            <Search className="h-4 w-4 text-[var(--admin-text-muted)]" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name or email" />
          </label>

          <label className="admin-filter">
            <span>Role</span>
            <select value={role} onChange={(event) => setRole(event.target.value)}>
              <option value="">All</option>
              <option value="student">Student</option>
              <option value="admin">Admin</option>
            </select>
          </label>

          <label className="admin-filter">
            <span>Billing mode</span>
            <select value={billingMode} onChange={(event) => setBillingMode(event.target.value)}>
              <option value="">All</option>
              <option value="managed">Managed</option>
              <option value="byok">BYOK</option>
              <option value="local">Local</option>
              <option value="unknown">Unknown</option>
            </select>
          </label>

          <label className="admin-filter">
            <span>Provider</span>
            <input value={providerSelection} onChange={(event) => setProviderSelection(event.target.value)} placeholder="minimax" />
          </label>

          <label className="admin-filter">
            <span>Model key</span>
            <input value={modelSelection} onChange={(event) => setModelSelection(event.target.value)} placeholder="minimax/MiniMax-M2.7" />
          </label>

          <Button variant="outline" className="admin-secondary-button" onClick={() => {
            setQuery('');
            setRole('');
            setBillingMode('');
            setProviderSelection('');
            setModelSelection('');
          }}>
            Reset filters
          </Button>
        </CardContent>
      </Card>

      <AdminSavedViewsPanel
        title="Saved views"
        description="Keep the user cohorts you revisit most often one click away."
        storageKey="studyclaw.admin.users.savedViews"
        defaults={defaultSavedViews}
        currentState={{ query, role, billingMode, providerSelection, modelSelection }}
        suggestedLabel={
          providerSelection
            ? `${providerSelection} cohort`
            : billingMode
              ? `${billingMode} accounts`
              : role
                ? `${role} accounts`
                : 'Current user view'
        }
        stateSummary={(state) => {
          const parts = [
            state.query ? `query: ${state.query}` : '',
            state.role ? `role: ${state.role}` : '',
            state.billingMode ? `billing: ${state.billingMode}` : '',
            state.providerSelection ? `provider: ${state.providerSelection}` : '',
            state.modelSelection ? `model: ${state.modelSelection}` : '',
          ].filter(Boolean);
          return parts.length ? parts.join(' · ') : 'All users';
        }}
        onApply={(state) => {
          setQuery(state.query);
          setRole(state.role);
          setBillingMode(state.billingMode);
          setProviderSelection(state.providerSelection);
          setModelSelection(state.modelSelection);
        }}
      />

      {selectedUsers.length ? (
        <Card className="admin-panel">
          <CardHeader className="admin-panel__header">
            <CardTitle>Batch actions</CardTitle>
            <div className="admin-panel__summary">
              <span>{selectedUsers.length} selected</span>
              <span>{blockedSelectionCount ? `${blockedSelectionCount} admin account${blockedSelectionCount === 1 ? '' : 's'} will be skipped` : 'Only non-admin accounts will be updated'}</span>
            </div>
          </CardHeader>
          <CardContent className="admin-panel__content admin-control-stack">
            <div className="admin-bulk-toolbar">
              <label className="admin-form-field">
                <span>Bulk tier</span>
                <select value={bulkTier} onChange={(event) => setBulkTier(event.target.value)}>
                  <option value="tier_1">Tier 1</option>
                  <option value="tier_2">Tier 2</option>
                  <option value="tier_3">Tier 3</option>
                </select>
              </label>

              <div className="admin-inline-actions">
                <Button className="admin-primary-button" disabled={bulkSubmitting} onClick={() => void handleBulkTier(false)}>
                  Apply tier
                </Button>
                <Button variant="outline" className="admin-secondary-button" disabled={bulkSubmitting} onClick={() => void handleBulkTier(true)}>
                  Apply tier + reset credits
                </Button>
              </div>
            </div>

            <div className="admin-bulk-toolbar">
              <label className="admin-form-field">
                <span>Bulk credit delta</span>
                <input value={bulkCreditDelta} onChange={(event) => setBulkCreditDelta(event.target.value)} placeholder="100 or -50" />
              </label>

              <div className="admin-inline-actions">
                <Button className="admin-primary-button" disabled={bulkSubmitting} onClick={() => void handleBulkCredits()}>
                  Apply credit change
                </Button>
                <Button variant="outline" className="admin-secondary-button" disabled={bulkSubmitting} onClick={() => setSelectedIds([])}>
                  Clear selection
                </Button>
              </div>
            </div>

            <div className="admin-selection-strip">
              {selectedUsers.slice(0, 8).map((user) => (
                <span key={user.id} className="admin-selection-pill">
                  {user.name || user.email}
                </span>
              ))}
              {selectedUsers.length > 8 ? (
                <span className="admin-selection-pill">+{selectedUsers.length - 8} more</span>
              ) : null}
            </div>
          </CardContent>
        </Card>
      ) : null}

      {error ? (
        <Card className="admin-alert-card is-danger">
          <CardContent className="admin-alert-card__content">{error}</CardContent>
        </Card>
      ) : null}

      {bulkMessage ? (
        <Card className={`admin-alert-card${bulkTone === 'danger' ? ' is-danger' : bulkTone === 'success' ? ' is-success' : ''}`}>
          <CardContent className="admin-alert-card__content">{bulkMessage}</CardContent>
        </Card>
      ) : null}

      <Card className="admin-panel">
        <CardHeader className="admin-panel__header">
          <CardTitle>Users</CardTitle>
          <div className="admin-panel__summary">
            <span>{loading ? 'Refreshing account list…' : `${users.length} accounts in view`}</span>
            <span>
              {role || 'All roles'} · {billingMode || 'All billing modes'}
              {providerSelection ? ` · ${providerSelection}` : ''}
              {modelSelection ? ` · ${modelSelection}` : ''}
            </span>
          </div>
        </CardHeader>
        <CardContent className="admin-panel__content">
          {loading ? (
            <div className="admin-loading-grid">
              <div className="admin-skeleton-row" />
              <div className="admin-skeleton-row" />
              <div className="admin-skeleton-row" />
            </div>
          ) : users.length ? (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th className="admin-table__checkbox-cell">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAll}
                        aria-label="Select all visible users"
                      />
                    </th>
                    <th>User</th>
                    <th>Role</th>
                    <th>Tier</th>
                    <th>Credits</th>
                    <th>Window usage</th>
                    <th>Onboarding</th>
                    <th>Last active</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td className="admin-table__checkbox-cell">
                        <input
                          type="checkbox"
                          checked={selectedIds.includes(user.id)}
                          onChange={() => toggleSelected(user.id)}
                          aria-label={`Select ${user.name || user.email}`}
                        />
                      </td>
                      <td>
                        <div className="admin-table__primary">{user.name || user.email}</div>
                        <div className="admin-table__secondary">{user.email}</div>
                      </td>
                      <td>
                        <StatusPill label={user.role} tone={user.role === 'admin' ? 'warning' : 'default'} />
                      </td>
                      <td>
                        <div className="admin-table__primary">{formatTierLabel(user.tier)}</div>
                        <div className="admin-table__secondary">{user.billingMode}</div>
                      </td>
                      <td>
                        <div className="admin-table__primary">{user.creditsRemaining}</div>
                        <div className="admin-table__secondary">of {user.creditsTotal}</div>
                        <AdminUsageMeter
                          value={Math.max(0, user.creditsTotal - user.creditsRemaining)}
                          total={user.creditsTotal || 0}
                          label="Credits used"
                          tone={user.creditsRemaining === 0 ? 'danger' : user.creditsRemaining < Math.max(200, user.creditsTotal * 0.2) ? 'warning' : 'success'}
                        />
                      </td>
                      <td>
                        <div className="admin-table__primary">{user.usageInWindow}</div>
                        <div className="admin-table__secondary">{user.modelSelection || user.providerSelection || 'No model'}</div>
                        <AdminUsageMeter value={user.usageInWindow} total={user.tier === 'tier_1' ? 100 : user.tier === 'tier_2' ? 300 : user.tier === 'tier_3' ? 500 : null} label="5h window" tone={user.usageInWindow > 400 ? 'danger' : user.usageInWindow > 150 ? 'warning' : 'default'} />
                      </td>
                      <td>
                        <StatusPill
                          label={user.onboardingComplete ? 'Complete' : 'Pending'}
                          tone={user.onboardingComplete ? 'success' : 'warning'}
                        />
                      </td>
                      <td>
                        <div className="admin-table__primary">{formatDateTime(user.lastActiveAt)}</div>
                        <div className="admin-table__secondary">{formatDateTime(user.createdAt)} created</div>
                      </td>
                      <td className="text-right">
                        <Button variant="outline" size="sm" className="admin-secondary-button" asChild>
                          <Link href={`/admin/users/${user.id}`}>Inspect</Link>
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <AdminEmptyState title="No users match these filters" description="Try clearing the current filters or broadening the search query." />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
